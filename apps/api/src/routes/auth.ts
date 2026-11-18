import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { get, newId, now, run, transaction } from '../db.js';
import type { Deps } from '../deps.js';
import { badRequest, conflict, notFound, parse, unauthorized, zmsg } from '../lib/http.js';
import { currentLang, t } from '../i18n.js';
import { bearerToken, createSession, hashPassword, publicAccount, publicUser, verifyPassword, type UserRow } from '../services/auth.js';
import { normalizeEmail } from '../services/contacts.js';
import { renderSystemEmail } from '../services/systemEmail.js';
import { monthlyUsage } from '../services/stats.js';
import { createPasswordReset, findResetUser, resetPassword, RESET_TTL_MINUTES } from '../services/passwordReset.js';

const passwordSchema = z.string().min(8, zmsg('Le mot de passe doit contenir au moins 8 caractères', 'Password must be at least 8 characters')).max(200);

const registerSchema = z.object({
  name: z.string().trim().min(1, zmsg('Le nom est requis', 'Name is required')).max(120),
  email: z.email(zmsg('Adresse email invalide', 'Invalid email address')).max(254),
  password: passwordSchema,
});

const loginSchema = z.object({
  email: z.string().trim().min(1, zmsg("L'email est requis", 'Email is required')),
  password: z.string().min(1, zmsg('Le mot de passe est requis', 'Password is required')),
});

const profileSchema = z.object({
  name: z.string().trim().min(1, zmsg('Le nom est requis', 'Name is required')).max(120).optional(),
  email: z.email(zmsg('Adresse email invalide', 'Invalid email address')).max(254).optional(),
});

const passwordChangeSchema = z.object({
  current: z.string().min(1, zmsg('Saisissez votre mot de passe actuel', 'Enter your current password')),
  next: passwordSchema,
});

const forgotSchema = z.object({ email: z.string().trim().min(1, zmsg("L'email est requis", 'Email is required')).max(254) });
const resetSchema = z.object({ token: z.string().min(20).max(200), password: passwordSchema });

interface AccountRow {
  id: string;
  name: string;
  email: string;
  created_at: string;
}

/** Public auth routes (no requireAuth). */
export async function authRoutes(app: FastifyInstance, { db, config, provider }: Deps) {
  /**
   * Base URL of the web app for links in emails. The calling page's origin is only trusted when it is
   * one of the configured web URLs: otherwise anyone could request a reset link pointing to their site.
   */
  const appUrl = (request: FastifyRequest) => {
    const origin = typeof request.headers.origin === 'string' ? request.headers.origin.replace(/\/+$/, '') : '';
    return config.webUrls.includes(origin) ? origin : (config.webUrls[0] ?? config.publicUrl);
  };

  async function sendResetEmail(user: UserRow, link: string) {
    const subject = t('Réinitialisez votre mot de passe Pingsell', 'Reset your Pingsell password');
    const firstName = user.name.trim().split(/\s+/)[0] || user.name;
    const { html, text } = renderSystemEmail({
      appUrl: new URL(link).origin,
      preheader: t(
        `Choisissez un nouveau mot de passe en un clic. Lien valable ${RESET_TTL_MINUTES} minutes.`,
        `Choose a new password in one click. Link valid for ${RESET_TTL_MINUTES} minutes.`,
      ),
      eyebrow: t('Sécurité du compte', 'Account security'),
      title: t(['Nouveau', 'mot de passe.'], ['New', 'password.']),
      paragraphs: [
        t(`Bonjour ${firstName},`, `Hi ${firstName},`),
        t(
          `Vous avez demandé à réinitialiser le mot de passe du compte **${user.email}**. Cliquez sur le bouton ci-dessous pour en choisir un nouveau : vous serez connecté directement.`,
          `You asked to reset the password of the account **${user.email}**. Click the button below to choose a new one: you'll be signed in right away.`,
        ),
      ],
      cta: { label: t('Choisir mon mot de passe', 'Choose my password'), url: link },
      facts: [
        t(`Valable ${RESET_TTL_MINUTES} minutes`, `Valid for ${RESET_TTL_MINUTES} minutes`),
        t('Utilisable une seule fois', 'Works only once'),
        t('Déconnecte vos autres appareils', 'Signs out other devices'),
      ],
      note: t(
        '**Vous n’êtes pas à l’origine de cette demande ?** Ignorez simplement cet email : votre mot de passe reste inchangé et personne ne peut accéder à votre compte sans ce lien.',
        '**Didn’t ask for this?** Just ignore this email: your password stays the same and nobody can access your account without this link.',
      ),
      reason: t(
        'Vous recevez cet email car une réinitialisation a été demandée pour votre compte Pingsell.',
        'You receive this email because a password reset was requested for your Pingsell account.',
      ),
    });
    try {
      await provider.send({ messageId: `reset_${user.id}_${Date.now()}`, to: user.email, fromName: 'Pingsell', fromEmail: config.defaultFromEmail, subject, html, text });
    } catch (err) {
      app.log.warn({ err }, 'password reset email failed');
    }
  }

  /** Always answers 204, whether the address exists or not (no account enumeration). */
  app.post('/auth/forgot-password', async (request, reply) => {
    const body = parse(forgotSchema, request.body);
    const user = get<UserRow>(db, 'SELECT * FROM users WHERE email = ?', normalizeEmail(body.email));
    if (user) {
      const token = createPasswordReset(db, user.id);
      // Not awaited: the response time must not reveal whether the account exists.
      if (token) void sendResetEmail(user, `${appUrl(request)}/reinitialiser-mot-de-passe/${token}`);
    }
    return reply.code(204).send();
  });

  /** Lets the reset page say early that a link is expired, before the user types a password. */
  app.get<{ Params: { token: string } }>('/auth/reset-password/:token', async (request) => {
    const user = findResetUser(db, request.params.token);
    if (!user) throw notFound(t('Ce lien a expiré ou a déjà été utilisé', 'This link has expired or was already used'));
    return { email: user.email };
  });

  /** Sets the new password, signs every session out, then signs the user in. */
  app.post('/auth/reset-password', async (request) => {
    const body = parse(resetSchema, request.body);
    const user = resetPassword(db, body.token, body.password);
    if (!user) throw badRequest(t('Ce lien a expiré ou a déjà été utilisé. Demandez-en un nouveau.', 'This link has expired or was already used. Ask for a new one.'));
    const account = get<AccountRow>(db, 'SELECT * FROM accounts WHERE id = ?', user.account_id)!;
    return { token: createSession(db, user.account_id, user.id), account: publicAccount(account), user: publicUser(user) };
  });

  app.post('/auth/register', async (request, reply) => {
    const body = parse(registerSchema, request.body);
    const email = normalizeEmail(body.email);
    if (get(db, 'SELECT id FROM users WHERE email = ?', email) || get(db, 'SELECT id FROM accounts WHERE email = ?', email)) {
      throw conflict(t('Un compte existe déjà avec cette adresse email', 'An account already exists with this email address'));
    }
    const account = { id: newId(), name: body.name, email, created_at: now() };
    const hash = hashPassword(body.password);
    transaction(db, () => {
      run(db, 'INSERT INTO accounts (id, name, email, password_hash, created_at, language) VALUES (?, ?, ?, ?, ?, ?)', account.id, account.name, email, hash, account.created_at, currentLang());
      // The creator is the account's owner; same id as the account by convention.
      run(db, "INSERT INTO users (id, account_id, email, name, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?, 'owner', ?)", account.id, account.id, email, body.name, hash, account.created_at);
    });
    const user = get<UserRow>(db, 'SELECT * FROM users WHERE id = ?', account.id)!;
    const token = createSession(db, account.id, user.id);
    return reply.code(201).send({ token, account, user: publicUser(user) });
  });

  app.post('/auth/login', async (request) => {
    const body = parse(loginSchema, request.body);
    const user = get<UserRow>(db, 'SELECT * FROM users WHERE email = ?', normalizeEmail(body.email));
    if (!user || !verifyPassword(body.password, user.password_hash)) {
      throw unauthorized(t('Email ou mot de passe incorrect', 'Incorrect email or password'));
    }
    // Remember the language of the last sign-in for texts generated outside a request (worker, emails).
    run(db, 'UPDATE accounts SET language = ? WHERE id = ?', currentLang(), user.account_id);
    const account = get<AccountRow>(db, 'SELECT * FROM accounts WHERE id = ?', user.account_id)!;
    return { token: createSession(db, user.account_id, user.id), account: publicAccount(account), user: publicUser(user) };
  });
}

/** Authenticated account routes. */
export async function accountRoutes(app: FastifyInstance, { db }: Deps) {
  app.get('/me', async (request) => {
    const row = get<AccountRow>(db, 'SELECT * FROM accounts WHERE id = ?', request.accountId);
    if (!row) throw notFound(t('Compte introuvable', 'Account not found'));
    const user = request.userId ? get<UserRow>(db, 'SELECT * FROM users WHERE id = ?', request.userId) : undefined;
    if (user) run(db, 'UPDATE users SET last_seen_at = ? WHERE id = ?', now(), user.id);
    return { account: publicAccount(row), user: user ? publicUser(user) : null, usage: monthlyUsage(db, row.id) };
  });

  /** Own profile: name and login email. */
  app.patch('/me/profile', async (request) => {
    if (!request.userId) throw badRequest(t('Disponible uniquement avec une session utilisateur', 'Only available with a user session'));
    const body = parse(profileSchema, request.body);
    const user = get<UserRow>(db, 'SELECT * FROM users WHERE id = ?', request.userId)!;
    const email = body.email ? normalizeEmail(body.email) : user.email;
    if (email !== user.email && get(db, 'SELECT id FROM users WHERE email = ? AND id <> ?', email, user.id)) {
      throw conflict(t('Cette adresse email est déjà utilisée', 'This email address is already in use'));
    }
    run(db, 'UPDATE users SET name = ?, email = ? WHERE id = ?', body.name ?? user.name, email, user.id);
    // The owner's email is also the account's contact email.
    if (user.role === 'owner') run(db, 'UPDATE accounts SET email = ? WHERE id = ?', email, user.account_id);
    return { user: publicUser(get<UserRow>(db, 'SELECT * FROM users WHERE id = ?', user.id)!) };
  });

  /** Change password; every other session of this user is signed out. */
  app.post('/me/password', async (request, reply) => {
    if (!request.userId) throw badRequest(t('Disponible uniquement avec une session utilisateur', 'Only available with a user session'));
    const body = parse(passwordChangeSchema, request.body);
    const user = get<UserRow>(db, 'SELECT * FROM users WHERE id = ?', request.userId)!;
    if (!verifyPassword(body.current, user.password_hash)) throw badRequest(t('Mot de passe actuel incorrect', 'Current password is incorrect'));
    const hash = hashPassword(body.next);
    run(db, 'UPDATE users SET password_hash = ? WHERE id = ?', hash, user.id);
    if (user.role === 'owner') run(db, 'UPDATE accounts SET password_hash = ? WHERE id = ?', hash, user.account_id);
    run(db, 'DELETE FROM sessions WHERE user_id = ? AND token <> ?', user.id, bearerToken(request) ?? '');
    return reply.code(204).send();
  });

  app.post('/auth/logout', async (request, reply) => {
    const token = bearerToken(request);
    if (token && !token.startsWith('msv_')) run(db, 'DELETE FROM sessions WHERE token = ?', token);
    return reply.code(204).send();
  });
}
