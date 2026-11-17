import { randomBytes } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { all, get, newId, now, run, transaction } from '../db.js';
import type { Deps } from '../deps.js';
import { badRequest, conflict, forbidden, notFound, parse } from '../lib/http.js';
import { createSession, hashPassword, publicUser, verifyPassword, type Role, type UserRow } from '../services/auth.js';
import { normalizeEmail } from '../services/contacts.js';

const INVITE_DAYS = 7;

const ROLE_LABELS: Record<Role, string> = { owner: 'Propriétaire', admin: 'Administrateur', editor: 'Éditeur' };

const inviteSchema = z.object({
  email: z.email('Adresse email invalide').max(254),
  role: z.enum(['admin', 'editor']),
});

const roleSchema = z.object({ role: z.enum(['admin', 'editor']) });

const acceptSchema = z.object({
  name: z.string().trim().min(1, 'Votre nom est requis').max(120),
  password: z.string().min(8, 'Le mot de passe doit contenir au moins 8 caractères').max(200),
});

interface InvitationRow {
  id: string;
  account_id: string;
  email: string;
  role: 'admin' | 'editor';
  token: string;
  invited_by: string | null;
  created_at: string;
  expires_at: string;
}

const isExpired = (inv: InvitationRow) => Date.parse(inv.expires_at) < Date.now();

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/** Where the web app lives: the calling page's origin (already vetted by CORS), else the configured URL. */
function webOrigin(request: FastifyRequest, fallback: string): string {
  const origin = request.headers.origin;
  return typeof origin === 'string' && /^https?:\/\//.test(origin) ? origin.replace(/\/+$/, '') : fallback;
}

/** Authenticated: members and invitations of the current account. */
export async function teamRoutes(app: FastifyInstance, { db, config, provider }: Deps) {
  const me = (request: FastifyRequest) => (request.userId ? get<UserRow>(db, 'SELECT * FROM users WHERE id = ?', request.userId) : undefined);

  /** Owners and admins manage the team. API keys act as the account owner. */
  function requireManager(request: FastifyRequest): UserRow | undefined {
    const user = me(request);
    if (user && user.role === 'editor') throw forbidden('Seuls le propriétaire et les administrateurs peuvent gérer l’équipe');
    return user;
  }

  const serializeInvite = (inv: InvitationRow, origin: string) => {
    const inviter = inv.invited_by ? get<{ name: string }>(db, 'SELECT name FROM users WHERE id = ?', inv.invited_by) : undefined;
    return {
      id: inv.id,
      email: inv.email,
      role: inv.role,
      invited_by: inviter?.name ?? null,
      created_at: inv.created_at,
      expires_at: inv.expires_at,
      expired: isExpired(inv),
      link: `${origin}/invitation/${inv.token}`,
    };
  };

  async function sendInvite(inv: InvitationRow, origin: string, inviterName: string) {
    const account = get<{ name: string }>(db, 'SELECT name FROM accounts WHERE id = ?', inv.account_id)!;
    const link = `${origin}/invitation/${inv.token}`;
    const subject = `${inviterName} vous invite à rejoindre ${account.name} sur Pingsell`;
    const html = `<!DOCTYPE html><html lang="fr"><body style="margin:0;background:#EEF2F8;font-family:Helvetica,Arial,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:40px 12px;">
<table role="presentation" width="520" cellpadding="0" cellspacing="0" style="max-width:520px;background:#FFFFFF;border-radius:20px;"><tr><td style="padding:40px;">
<p style="margin:0 0 24px;font-size:20px;font-weight:800;letter-spacing:-0.02em;color:#0B214A;">pingsell</p>
<h1 style="margin:0 0 12px;font-size:24px;line-height:1.25;color:#0B214A;">Rejoignez ${escapeHtml(account.name)}</h1>
<p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#3d4d6a;">${escapeHtml(inviterName)} vous invite à gérer les campagnes email de <strong>${escapeHtml(account.name)}</strong> en tant que <strong>${ROLE_LABELS[inv.role].toLowerCase()}</strong>.</p>
<a href="${link}" style="display:inline-block;padding:14px 28px;background:#145CFF;color:#FFFFFF;border-radius:999px;font-size:15px;font-weight:bold;text-decoration:none;">Accepter l’invitation</a>
<p style="margin:24px 0 0;font-size:12px;line-height:1.6;color:#7a879e;">Ce lien est valable ${INVITE_DAYS} jours. Si vous n’attendiez pas cette invitation, ignorez simplement cet email.</p>
</td></tr></table></td></tr></table></body></html>`;
    const text = `${inviterName} vous invite à rejoindre ${account.name} sur Pingsell (${ROLE_LABELS[inv.role]}).\n\nAccepter l'invitation : ${link}\n\nLien valable ${INVITE_DAYS} jours.`;
    try {
      await provider.send({ messageId: `invite_${inv.id}_${Date.now()}`, to: inv.email, fromName: 'Pingsell', fromEmail: config.defaultFromEmail, subject, html, text });
      return true;
    } catch (err) {
      app.log.warn({ err }, 'invitation email failed');
      return false;
    }
  }

  app.get('/team', async (request) => {
    const origin = webOrigin(request, config.webUrls[0] ?? '');
    const members = all<UserRow>(db, "SELECT * FROM users WHERE account_id = ? ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, created_at", request.accountId);
    const invitations = all<InvitationRow>(db, 'SELECT * FROM invitations WHERE account_id = ? ORDER BY created_at DESC', request.accountId);
    const viewer = me(request);
    const canManage = !viewer || viewer.role !== 'editor';
    return {
      members: members.map(publicUser),
      // Links are only shown to people allowed to share them.
      invitations: invitations.map((i) => {
        const s = serializeInvite(i, origin);
        return canManage ? s : { ...s, link: null };
      }),
      can_manage: canManage,
    };
  });

  app.post('/team/invitations', async (request, reply) => {
    const inviter = requireManager(request);
    const body = parse(inviteSchema, request.body);
    const email = normalizeEmail(body.email);
    const existing = get<UserRow>(db, 'SELECT * FROM users WHERE email = ?', email);
    if (existing?.account_id === request.accountId) throw conflict('Cette personne fait déjà partie de l’équipe');
    if (existing) throw conflict('Cette adresse est déjà utilisée par un autre compte Pingsell');

    const created = now();
    const expires = new Date(Date.now() + INVITE_DAYS * 86400000).toISOString();
    const token = `inv_${randomBytes(24).toString('base64url')}`;
    const prior = get<InvitationRow>(db, 'SELECT * FROM invitations WHERE account_id = ? AND email = ?', request.accountId, email);
    // Inviting the same address again renews the invitation (new link, new expiry).
    const id = prior?.id ?? newId();
    if (prior) {
      run(db, 'UPDATE invitations SET role = ?, token = ?, invited_by = ?, created_at = ?, expires_at = ? WHERE id = ?', body.role, token, inviter?.id ?? null, created, expires, id);
    } else {
      run(
        db,
        'INSERT INTO invitations (id, account_id, email, role, token, invited_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        id,
        request.accountId,
        email,
        body.role,
        token,
        inviter?.id ?? null,
        created,
        expires,
      );
    }
    const inv = get<InvitationRow>(db, 'SELECT * FROM invitations WHERE id = ?', id)!;
    const origin = webOrigin(request, config.webUrls[0] ?? '');
    const accountName = get<{ name: string }>(db, 'SELECT name FROM accounts WHERE id = ?', request.accountId)!.name;
    const sent = await sendInvite(inv, origin, inviter?.name ?? accountName);
    reply.code(201);
    return { invitation: serializeInvite(inv, origin), email_sent: sent };
  });

  app.delete('/team/invitations/:id', async (request, reply) => {
    requireManager(request);
    const { id } = request.params as { id: string };
    if (!run(db, 'DELETE FROM invitations WHERE id = ? AND account_id = ?', id, request.accountId)) throw notFound('Invitation introuvable');
    return reply.code(204).send();
  });

  app.patch('/team/members/:id', async (request) => {
    const actor = requireManager(request);
    const { id } = request.params as { id: string };
    const body = parse(roleSchema, request.body);
    const target = get<UserRow>(db, 'SELECT * FROM users WHERE id = ? AND account_id = ?', id, request.accountId);
    if (!target) throw notFound('Membre introuvable');
    if (target.role === 'owner') throw badRequest('Le rôle du propriétaire ne peut pas être modifié');
    if (actor && actor.id === target.id) throw badRequest('Vous ne pouvez pas modifier votre propre rôle');
    run(db, 'UPDATE users SET role = ? WHERE id = ?', body.role, id);
    return { member: publicUser(get<UserRow>(db, 'SELECT * FROM users WHERE id = ?', id)!) };
  });

  app.delete('/team/members/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const actor = me(request);
    const target = get<UserRow>(db, 'SELECT * FROM users WHERE id = ? AND account_id = ?', id, request.accountId);
    if (!target) throw notFound('Membre introuvable');
    if (target.role === 'owner') throw badRequest('Le propriétaire ne peut pas être retiré du compte');
    // Anyone may leave; removing someone else needs a manager.
    if (!actor || actor.id !== target.id) requireManager(request);
    run(db, 'DELETE FROM users WHERE id = ?', id); // sessions follow (ON DELETE CASCADE)
    return reply.code(204).send();
  });

  /** Shop / company name shown in emails and in the app. */
  app.patch('/account', async (request) => {
    requireManager(request);
    const body = parse(z.object({ name: z.string().trim().min(1, 'Le nom est requis').max(120) }), request.body);
    run(db, 'UPDATE accounts SET name = ? WHERE id = ?', body.name, request.accountId);
    const row = get<{ id: string; name: string; email: string; created_at: string }>(db, 'SELECT id, name, email, created_at FROM accounts WHERE id = ?', request.accountId)!;
    return { account: row };
  });
}

/** Owner only: permanently delete the account and everything in it (contacts, campaigns, team…). */
export async function accountDeletionRoutes(app: FastifyInstance, { db }: Deps) {
  app.post('/account/delete', async (request, reply) => {
    if (!request.userId) throw forbidden('La suppression du compte se fait depuis une session, pas avec une clé API');
    const user = get<UserRow>(db, 'SELECT * FROM users WHERE id = ? AND account_id = ?', request.userId, request.accountId);
    if (user?.role !== 'owner') throw forbidden('Seul le propriétaire peut supprimer le compte');
    const body = parse(z.object({ password: z.string().min(1, 'Saisissez votre mot de passe') }), request.body);
    if (!verifyPassword(body.password, user.password_hash)) throw badRequest('Mot de passe incorrect');
    // Every table references accounts with ON DELETE CASCADE.
    run(db, 'DELETE FROM accounts WHERE id = ?', request.accountId);
    return reply.code(204).send();
  });
}

/** Public: look at and accept an invitation (the token is the credential). */
export async function invitationRoutes(app: FastifyInstance, { db }: Deps) {
  function load(token: string): InvitationRow {
    const inv = get<InvitationRow>(db, 'SELECT * FROM invitations WHERE token = ?', token);
    if (!inv) throw notFound('Cette invitation n’existe pas ou a été annulée');
    if (isExpired(inv)) throw badRequest('Cette invitation a expiré. Demandez à recevoir un nouveau lien.');
    return inv;
  }

  app.get('/invitations/:token', async (request) => {
    const inv = load((request.params as { token: string }).token);
    const account = get<{ name: string }>(db, 'SELECT name FROM accounts WHERE id = ?', inv.account_id)!;
    const inviter = inv.invited_by ? get<{ name: string }>(db, 'SELECT name FROM users WHERE id = ?', inv.invited_by) : undefined;
    return {
      email: inv.email,
      role: inv.role,
      account_name: account.name,
      invited_by: inviter?.name ?? null,
      email_taken: !!get(db, 'SELECT id FROM users WHERE email = ?', inv.email),
    };
  });

  app.post('/invitations/:token/accept', async (request, reply) => {
    const inv = load((request.params as { token: string }).token);
    const body = parse(acceptSchema, request.body);
    if (get(db, 'SELECT id FROM users WHERE email = ?', inv.email)) throw conflict('Un compte Pingsell existe déjà avec cette adresse email');
    const user: UserRow = {
      id: newId(),
      account_id: inv.account_id,
      email: inv.email,
      name: body.name,
      password_hash: hashPassword(body.password),
      role: inv.role,
      created_at: now(),
      last_seen_at: null,
    };
    transaction(db, () => {
      run(
        db,
        'INSERT INTO users (id, account_id, email, name, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        user.id,
        user.account_id,
        user.email,
        user.name,
        user.password_hash,
        user.role,
        user.created_at,
      );
      run(db, 'DELETE FROM invitations WHERE id = ?', inv.id);
    });
    const account = get<{ id: string; name: string; email: string; created_at: string }>(db, 'SELECT id, name, email, created_at FROM accounts WHERE id = ?', inv.account_id)!;
    reply.code(201);
    return { token: createSession(db, inv.account_id, user.id), account, user: publicUser(user) };
  });
}
