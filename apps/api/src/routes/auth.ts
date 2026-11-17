import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { get, newId, now, run } from '../db.js';
import type { Deps } from '../deps.js';
import { conflict, notFound, parse, unauthorized } from '../lib/http.js';
import { bearerToken, createSession, hashPassword, publicAccount, verifyPassword } from '../services/auth.js';
import { normalizeEmail } from '../services/contacts.js';
import { monthlyUsage } from '../services/stats.js';

const registerSchema = z.object({
  name: z.string().trim().min(1, 'Le nom est requis').max(120),
  email: z.email('Adresse email invalide').max(254),
  password: z.string().min(8, 'Le mot de passe doit contenir au moins 8 caractères').max(200),
});

const loginSchema = z.object({
  email: z.string().trim().min(1, "L'email est requis"),
  password: z.string().min(1, 'Le mot de passe est requis'),
});

interface AccountRow {
  id: string;
  name: string;
  email: string;
  password_hash: string;
  created_at: string;
}

/** Public auth routes (no requireAuth). */
export async function authRoutes(app: FastifyInstance, { db }: Deps) {
  app.post('/auth/register', async (request, reply) => {
    const body = parse(registerSchema, request.body);
    const email = normalizeEmail(body.email);
    if (get(db, 'SELECT id FROM accounts WHERE email = ?', email)) {
      throw conflict('Un compte existe déjà avec cette adresse email');
    }
    const account = { id: newId(), name: body.name, email, created_at: now() };
    run(
      db,
      'INSERT INTO accounts (id, name, email, password_hash, created_at) VALUES (?, ?, ?, ?, ?)',
      account.id,
      account.name,
      account.email,
      hashPassword(body.password),
      account.created_at,
    );
    const token = createSession(db, account.id);
    return reply.code(201).send({ token, account });
  });

  app.post('/auth/login', async (request) => {
    const body = parse(loginSchema, request.body);
    const row = get<AccountRow>(db, 'SELECT * FROM accounts WHERE email = ?', normalizeEmail(body.email));
    if (!row || !verifyPassword(body.password, row.password_hash)) {
      throw unauthorized('Email ou mot de passe incorrect');
    }
    return { token: createSession(db, row.id), account: publicAccount(row) };
  });
}

/** Authenticated account routes. */
export async function accountRoutes(app: FastifyInstance, { db }: Deps) {
  app.get('/me', async (request) => {
    const row = get<AccountRow>(db, 'SELECT * FROM accounts WHERE id = ?', request.accountId);
    if (!row) throw notFound('Compte introuvable');
    return { account: publicAccount(row), usage: monthlyUsage(db, row.id) };
  });

  app.post('/auth/logout', async (request, reply) => {
    const token = bearerToken(request);
    if (token && !token.startsWith('msv_')) run(db, 'DELETE FROM sessions WHERE token = ?', token);
    return reply.code(204).send();
  });
}
