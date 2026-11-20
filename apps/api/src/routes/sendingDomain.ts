import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { get, run } from '../db.js';
import type { Deps } from '../deps.js';
import { badRequest, forbidden, notFound, parse, zmsg } from '../lib/http.js';
import { t } from '../i18n.js';
import {
  accountFromEmail,
  createSendingDomain,
  deleteSendingDomain,
  detectDnsProvider,
  getSendingDomain,
  isFreemail,
  normalizeDomain,
  refreshDmarc,
  onDomain,
  serializeSendingDomain,
  verifySendingDomain,
} from '../services/sendingDomains.js';

const createSchema = z.object({ domain: z.string().trim().min(1, zmsg('Le domaine est requis', 'Domain is required')).max(260) });
const fromSchema = z.object({ from_email: z.email(zmsg('Adresse invalide', 'Invalid address')).max(254).nullable() });

/** Settings → Sending domain: send from the merchant's own address (hello@shop.com), signed with DKIM. */
export async function sendingDomainRoutes(app: FastifyInstance, { db, config }: Deps) {
  function requireManager(request: FastifyRequest) {
    if (!request.userId) return;
    const role = get<{ role: string }>(db, 'SELECT role FROM users WHERE id = ?', request.userId)?.role;
    if (role === 'editor') throw forbidden(t('Seuls le propriétaire et les administrateurs peuvent régler le domaine d’envoi', 'Only the owner and admins can manage the sending domain'));
  }

  const current = (accountId: string) => {
    const row = getSendingDomain(db, accountId);
    if (!row) return null;
    const own = get<{ from_email: string | null }>(db, 'SELECT from_email FROM accounts WHERE id = ?', accountId)?.from_email ?? null;
    return serializeSendingDomain(row, own);
  };

  app.get('/sending-domain', async (request) => {
    const domain = current(request.accountId);
    return {
      domain: domain && { ...domain, dns_provider: domain.status === 'verified' ? null : await detectDnsProvider(domain.domain) },
      default_from_email: config.defaultFromEmail,
      from_email: accountFromEmail(db, config, request.accountId),
    };
  });

  app.post('/sending-domain', async (request, reply) => {
    requireManager(request);
    const { domain: input } = parse(createSchema, request.body);
    const domain = normalizeDomain(input);
    if (!domain) throw badRequest(t('Nom de domaine invalide, ex. : ma-boutique.fr', 'Invalid domain name, e.g. my-shop.com'));
    if (isFreemail(domain)) {
      throw badRequest(t(
        `Une adresse ${domain} ne peut pas servir d’expéditeur : il faut une adresse sur votre propre nom de domaine, comme contact@votre-entreprise.fr. Sans adresse pro, vos emails partent de ${config.defaultFromEmail} avec votre nom, et les réponses vous arrivent quand même.`,
        `A ${domain} address can't be used as the sender: you need an address on your own domain, such as contact@your-company.com. Without one, your emails go out from ${config.defaultFromEmail} with your name, and replies still reach you.`,
      ));
    }
    const ours = config.smtp.mailDomain;
    if (ours && (domain === ours || domain.endsWith(`.${ours}`))) throw badRequest(t('Ce domaine est déjà celui de Pingsell', 'This is already Pingsell’s domain'));
    await refreshDmarc(db, createSendingDomain(db, request.accountId, domain));
    // « contact@shop.com » typed instead of « shop.com »: that address becomes the sender as soon as the domain is verified.
    const wanted = input.trim().toLowerCase();
    if (z.email().safeParse(wanted).success && onDomain(getSendingDomain(db, request.accountId), wanted)) {
      run(db, 'UPDATE accounts SET from_email = ? WHERE id = ?', wanted, request.accountId);
    }
    const created = current(request.accountId)!;
    return reply.code(201).send({ domain: { ...created, dns_provider: await detectDnsProvider(domain) }, from_email: accountFromEmail(db, config, request.accountId) });
  });

  app.post('/sending-domain/verify', async (request) => {
    requireManager(request);
    const row = getSendingDomain(db, request.accountId);
    if (!row) throw notFound(t('Aucun domaine d’envoi', 'No sending domain'));
    const checked = await verifySendingDomain(db, row);
    const domain = current(request.accountId)!;
    return {
      domain: { ...domain, dns_provider: checked.status === 'verified' ? null : await detectDnsProvider(checked.domain) },
      from_email: accountFromEmail(db, config, request.accountId),
    };
  });

  /** The default sender address for new campaigns and automations; must be on the verified domain. */
  app.put('/sending-domain/from', async (request) => {
    requireManager(request);
    const { from_email } = parse(fromSchema, request.body);
    const email = from_email?.trim().toLowerCase() ?? null;
    // Allowed while the domain is still pending: it is only used once the domain is verified.
    if (email && !onDomain(getSendingDomain(db, request.accountId), email)) {
      throw badRequest(t('L’adresse doit être sur votre domaine d’envoi', 'The address must be on your sending domain'));
    }
    run(db, 'UPDATE accounts SET from_email = ? WHERE id = ?', email, request.accountId);
    return { domain: current(request.accountId), from_email: accountFromEmail(db, config, request.accountId) };
  });

  app.delete('/sending-domain', async (request, reply) => {
    requireManager(request);
    if (!deleteSendingDomain(db, request.accountId)) throw notFound(t('Aucun domaine d’envoi', 'No sending domain'));
    return reply.code(204).send();
  });
}
