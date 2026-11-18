import { randomBytes } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { all, get, newId, now, run, transaction } from '../db.js';
import type { Deps } from '../deps.js';
import { badRequest, conflict, forbidden, notFound, parse, zmsg } from '../lib/http.js';
import { t } from '../i18n.js';
import { createSession, hashPassword, publicUser, verifyPassword, type Role, type UserRow } from '../services/auth.js';
import { normalizeEmail } from '../services/contacts.js';
import { renderSystemEmail } from '../services/systemEmail.js';

const INVITE_DAYS = 7;

const roleLabels = (): Record<Role, string> =>
  t({ owner: 'Propriétaire', admin: 'Administrateur', editor: 'Éditeur' }, { owner: 'Owner', admin: 'Admin', editor: 'Editor' });

const inviteSchema = z.object({
  email: z.email(zmsg('Adresse email invalide', 'Invalid email address')).max(254),
  role: z.enum(['admin', 'editor']),
});

const roleSchema = z.object({ role: z.enum(['admin', 'editor']) });

const acceptSchema = z.object({
  name: z.string().trim().min(1, zmsg('Votre nom est requis', 'Your name is required')).max(120),
  password: z.string().min(8, zmsg('Le mot de passe doit contenir au moins 8 caractères', 'Password must be at least 8 characters')).max(200),
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
    if (user && user.role === 'editor') throw forbidden(t('Seuls le propriétaire et les administrateurs peuvent gérer l’équipe', 'Only the owner and admins can manage the team'));
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
    const roleLabel = roleLabels()[inv.role];
    const subject = t(
      `${inviterName} vous invite à rejoindre ${account.name} sur Pingsell`,
      `${inviterName} invited you to join ${account.name} on Pingsell`,
    );
    const { html, text } = renderSystemEmail({
      appUrl: origin,
      preheader: t(
        `${inviterName} vous attend sur Pingsell pour gérer les emails de ${account.name}.`,
        `${inviterName} is waiting for you on Pingsell to manage ${account.name}'s emails.`,
      ),
      eyebrow: t('Invitation', 'Invitation'),
      title: [t('Rejoignez', 'Join'), `${account.name}.`],
      paragraphs: [
        t('Bonjour,', 'Hi,'),
        t(
          `**${inviterName}** vous invite à gérer les campagnes email de **${account.name}** sur Pingsell, en tant que **${roleLabel.toLowerCase()}**.`,
          `**${inviterName}** invited you to manage email campaigns for **${account.name}** on Pingsell, as **${roleLabel.toLowerCase()}**.`,
        ),
        t(
          'Créez votre accès en une minute : il suffit de choisir un mot de passe.',
          'Set up your access in a minute: just choose a password.',
        ),
      ],
      cta: { label: t('Accepter l’invitation', 'Accept invitation'), url: link },
      facts: [t(`Valable ${INVITE_DAYS} jours`, `Valid for ${INVITE_DAYS} days`), roleLabel],
      note: t(
        '**Vous n’attendiez pas cette invitation ?** Ignorez simplement cet email, aucun compte ne sera créé.',
        '**Weren’t expecting this?** Just ignore this email, no account will be created.',
      ),
      reason: t(
        `Vous recevez cet email car ${inviterName} a saisi votre adresse sur Pingsell.`,
        `You receive this email because ${inviterName} entered your address on Pingsell.`,
      ),
    });
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
    if (existing?.account_id === request.accountId) throw conflict(t('Cette personne fait déjà partie de l’équipe', 'This person is already on the team'));
    if (existing) throw conflict(t('Cette adresse est déjà utilisée par un autre compte Pingsell', 'This address is already used by another Pingsell account'));

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
    if (!run(db, 'DELETE FROM invitations WHERE id = ? AND account_id = ?', id, request.accountId)) throw notFound(t('Invitation introuvable', 'Invitation not found'));
    return reply.code(204).send();
  });

  app.patch('/team/members/:id', async (request) => {
    const actor = requireManager(request);
    const { id } = request.params as { id: string };
    const body = parse(roleSchema, request.body);
    const target = get<UserRow>(db, 'SELECT * FROM users WHERE id = ? AND account_id = ?', id, request.accountId);
    if (!target) throw notFound(t('Membre introuvable', 'Member not found'));
    if (target.role === 'owner') throw badRequest(t('Le rôle du propriétaire ne peut pas être modifié', 'The owner’s role can’t be changed'));
    if (actor && actor.id === target.id) throw badRequest(t('Vous ne pouvez pas modifier votre propre rôle', 'You can’t change your own role'));
    run(db, 'UPDATE users SET role = ? WHERE id = ?', body.role, id);
    return { member: publicUser(get<UserRow>(db, 'SELECT * FROM users WHERE id = ?', id)!) };
  });

  app.delete('/team/members/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const actor = me(request);
    const target = get<UserRow>(db, 'SELECT * FROM users WHERE id = ? AND account_id = ?', id, request.accountId);
    if (!target) throw notFound(t('Membre introuvable', 'Member not found'));
    if (target.role === 'owner') throw badRequest(t('Le propriétaire ne peut pas être retiré du compte', 'The owner can’t be removed from the account'));
    // Anyone may leave; removing someone else needs a manager.
    if (!actor || actor.id !== target.id) requireManager(request);
    run(db, 'DELETE FROM users WHERE id = ?', id); // sessions follow (ON DELETE CASCADE)
    return reply.code(204).send();
  });

  /** Shop / company name shown in emails and in the app. */
  app.patch('/account', async (request) => {
    requireManager(request);
    const body = parse(z.object({ name: z.string().trim().min(1, zmsg('Le nom est requis', 'Name is required')).max(120) }), request.body);
    run(db, 'UPDATE accounts SET name = ? WHERE id = ?', body.name, request.accountId);
    const row = get<{ id: string; name: string; email: string; created_at: string }>(db, 'SELECT id, name, email, created_at FROM accounts WHERE id = ?', request.accountId)!;
    return { account: row };
  });
}

/** Owner only: permanently delete the account and everything in it (contacts, campaigns, team…). */
export async function accountDeletionRoutes(app: FastifyInstance, { db }: Deps) {
  app.post('/account/delete', async (request, reply) => {
    if (!request.userId) throw forbidden(t('La suppression du compte se fait depuis une session, pas avec une clé API', 'Account deletion requires a signed-in session, not an API key'));
    const user = get<UserRow>(db, 'SELECT * FROM users WHERE id = ? AND account_id = ?', request.userId, request.accountId);
    if (user?.role !== 'owner') throw forbidden(t('Seul le propriétaire peut supprimer le compte', 'Only the owner can delete the account'));
    const body = parse(z.object({ password: z.string().min(1, zmsg('Saisissez votre mot de passe', 'Enter your password')) }), request.body);
    if (!verifyPassword(body.password, user.password_hash)) throw badRequest(t('Mot de passe incorrect', 'Incorrect password'));
    // Every table references accounts with ON DELETE CASCADE.
    run(db, 'DELETE FROM accounts WHERE id = ?', request.accountId);
    return reply.code(204).send();
  });
}

/** Public: look at and accept an invitation (the token is the credential). */
export async function invitationRoutes(app: FastifyInstance, { db }: Deps) {
  function load(token: string): InvitationRow {
    const inv = get<InvitationRow>(db, 'SELECT * FROM invitations WHERE token = ?', token);
    if (!inv) throw notFound(t('Cette invitation n’existe pas ou a été annulée', 'This invitation doesn’t exist or has been canceled'));
    if (isExpired(inv)) throw badRequest(t('Cette invitation a expiré. Demandez à recevoir un nouveau lien.', 'This invitation has expired. Ask for a new link.'));
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
    if (get(db, 'SELECT id FROM users WHERE email = ?', inv.email)) throw conflict(t('Un compte Pingsell existe déjà avec cette adresse email', 'A Pingsell account already exists with this email address'));
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
