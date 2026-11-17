/**
 * Demo seed (test values only — see SPEC.md "Demo seed").
 * Idempotent: the demo account is deleted (cascade) and recreated on each run.
 *
 *   npm run seed                 (French demo)
 *   SEED_LANG=en npm run seed    (English demo)
 */
import { config } from './config.js';
import { get, newId, openDatabase, run, transaction, type DatabaseSync } from './db.js';
import { createApiKey, hashPassword } from './services/auth.js';
import { recordEvent } from './services/contacts.js';
import { createMessage } from './services/messages.js';
import { generateFromTemplate } from './services/templates.js';
import { audienceFilter } from './services/campaigns.js';
import type { AutomationStep } from './services/automations.js';
import { currentLang, normalizeLang, t, withLang } from './i18n.js';

const DEMO = {
  get name() {
    return t('Boutique Démo', 'Demo Store');
  },
  email: 'demo@missive.local',
  password: 'demo1234',
  apiKey: 'msv_dev_key_123',
};

/* Deterministic PRNG so the demo looks the same on every machine. */
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let x = Math.imul(a ^ (a >>> 15), 1 | a);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20261117);
const pick = <T>(items: readonly T[]): T => items[Math.floor(rand() * items.length)];
const chance = (p: number) => rand() < p;

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const NOW = Date.now();
const iso = (ts: number) => new Date(Math.min(ts, NOW)).toISOString();

const FIRST_NAMES = [
  'Camille', 'Léa', 'Manon', 'Chloé', 'Inès', 'Jade', 'Louise', 'Emma', 'Alice', 'Juliette', 'Zoé', 'Clara',
  'Sarah', 'Margaux', 'Pauline', 'Élodie', 'Lucas', 'Hugo', 'Louis', 'Gabriel', 'Arthur', 'Jules', 'Adam',
  'Raphaël', 'Thomas', 'Nathan', 'Théo', 'Maxime', 'Antoine', 'Julien', 'Nicolas', 'Mathis',
];
const LAST_NAMES = [
  'Martin', 'Bernard', 'Dubois', 'Thomas', 'Robert', 'Richard', 'Petit', 'Durand', 'Leroy', 'Moreau', 'Simon',
  'Laurent', 'Lefebvre', 'Michel', 'Garcia', 'David', 'Bertrand', 'Roux', 'Vincent', 'Fournier', 'Morel',
  'Girard', 'André', 'Mercier', 'Dupont', 'Lambert', 'Bonnet', 'François', 'Martinez', 'Legrand', 'Garnier',
];
const DOMAINS = ['example.com', 'example.org', 'example.net'];
const CITIES = ['paris', 'lyon', 'marseille', 'bordeaux', 'lille', 'nantes', 'toulouse'];

function slug(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z]/g, '');
}

interface SeedContact {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  status: string;
  created: number;
}

function resetDemoAccount(db: DatabaseSync) {
  const existing = get<{ id: string }>(db, 'SELECT id FROM accounts WHERE email = ?', DEMO.email);
  if (existing) {
    // automation_runs reference automations/contacts (cascade); everything else cascades from accounts.
    run(db, 'DELETE FROM automation_runs WHERE automation_id IN (SELECT id FROM automations WHERE account_id = ?)', existing.id);
    run(db, 'DELETE FROM accounts WHERE id = ?', existing.id);
  }
  run(db, 'DELETE FROM api_keys WHERE key = ?', DEMO.apiKey);
}

function seedContacts(db: DatabaseSync, accountId: string): SeedContact[] {
  const contacts: SeedContact[] = [];
  const used = new Set<string>();
  for (let i = 0; i < 62; i++) {
    const first = pick(FIRST_NAMES);
    const last = pick(LAST_NAMES);
    let email = `${slug(first)}.${slug(last)}@${pick(DOMAINS)}`;
    if (used.has(email)) email = email.replace('@', `${i}@`);
    used.add(email);

    // A third of the base joined during the last 30 days, the rest over the previous year.
    const created = i % 3 === 0 ? NOW - rand() * 29 * DAY : NOW - (30 + rand() * 330) * DAY;
    const source = pick(['shopify', 'shopify', 'shopify', 'manual', 'import', 'api'] as const);
    const isCustomer = source === 'shopify' ? chance(0.85) : chance(0.3);
    const orders = isCustomer ? 1 + Math.floor(rand() * rand() * 12) : 0;
    const spent = orders ? Math.round(orders * (35 + rand() * 90) * 100) / 100 : 0;
    const lastOrder = orders ? created + rand() * (NOW - created) : null;

    const tags = new Set<string>(['newsletter']);
    if (chance(0.5)) tags.add(pick(CITIES));
    if (spent > 400) tags.add('vip');
    if (orders >= 3) tags.add('fidele');
    if (NOW - created < 30 * DAY) tags.add('nouveau');
    if (chance(0.25)) tags.add('promo');
    if (chance(0.15)) tags.add('mode-homme');
    if (chance(0.2)) tags.add('mode-femme');

    let status = 'subscribed';
    if (i === 7 || i === 23 || i === 41) status = 'unsubscribed';
    if (i === 15) status = 'bounced';
    if (i === 52) status = 'complained';

    const id = newId();
    run(
      db,
      `INSERT INTO contacts (id, account_id, email, first_name, last_name, phone, tags, attributes, status, source,
         external_id, total_spent, orders_count, last_order_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      accountId,
      email,
      first,
      last,
      chance(0.6) ? `+33 6 ${String(Math.floor(rand() * 1e8)).padStart(8, '0').replace(/(\d{2})(?=\d)/g, '$1 ')}` : null,
      JSON.stringify([...tags]),
      JSON.stringify(chance(0.4) ? { ville: pick(CITIES), langue: 'fr' } : { langue: 'fr' }),
      status,
      source,
      source === 'shopify' ? String(7_000_000_000 + i) : null,
      spent,
      orders,
      lastOrder ? iso(lastOrder) : null,
      iso(created),
      iso(created),
    );
    recordEvent(db, accountId, id, 'contact_created', { source }, iso(created));

    // Shopify orders in the last 30 days feed `revenue_shopify`.
    if (source === 'shopify' && orders && lastOrder && NOW - lastOrder < 30 * DAY) {
      const total = Math.round((40 + rand() * 160) * 100) / 100;
      recordEvent(
        db,
        accountId,
        id,
        'order',
        { order_id: `#${1000 + i}`, total, currency: 'EUR', source: 'shopify' },
        iso(lastOrder),
      );
    }
    contacts.push({ id, email, first_name: first, last_name: last, status, created });
  }
  return contacts;
}

function insertSegment(db: DatabaseSync, accountId: string, name: string, rules: object, createdAt: number) {
  const id = newId();
  run(
    db,
    'INSERT INTO segments (id, account_id, name, rules, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    id,
    accountId,
    name,
    JSON.stringify(rules),
    iso(createdAt),
    iso(createdAt),
  );
  return id;
}

/** Simulates engagement on a delivered message: opens mostly within 48h, clicks after the open. */
function simulateEngagement(
  db: DatabaseSync,
  accountId: string,
  messageId: string,
  contactId: string,
  sentAt: number,
  extra: Record<string, string>,
  openRate: number,
  clickRate: number,
) {
  if (!chance(openRate)) return;
  const openedAt = sentAt + (chance(0.6) ? rand() * 6 * HOUR : rand() * 72 * HOUR) + 2 * 60_000;
  if (openedAt > NOW) return;
  run(db, 'UPDATE messages SET opened_at = ? WHERE id = ?', iso(openedAt), messageId);
  recordEvent(db, accountId, contactId, 'open', { message_id: messageId, ...extra }, iso(openedAt));
  if (!chance(clickRate)) return;
  const clickedAt = openedAt + rand() * 20 * 60_000 + 15_000;
  if (clickedAt > NOW) return;
  run(db, 'UPDATE messages SET clicked_at = ? WHERE id = ?', iso(clickedAt), messageId);
  recordEvent(db, accountId, contactId, 'click', { message_id: messageId, url: t('https://exemple.com', 'https://example.com'), ...extra }, iso(clickedAt));
}

function insertCampaign(
  db: DatabaseSync,
  accountId: string,
  c: {
    name: string;
    subject: string;
    preheader: string;
    html: string;
    segmentId: string | null;
    status: string;
    createdAt: number;
    sentAt?: number;
    scheduledAt?: number;
  },
) {
  const id = newId();
  run(
    db,
    `INSERT INTO campaigns (id, account_id, name, subject, preheader, from_name, from_email, html, segment_id, status,
       scheduled_at, sent_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    accountId,
    c.name,
    c.subject,
    c.preheader,
    DEMO.name,
    config.defaultFromEmail,
    c.html,
    c.segmentId,
    c.status,
    c.scheduledAt ? new Date(c.scheduledAt).toISOString() : null,
    c.sentAt ? iso(c.sentAt) : null,
    iso(c.createdAt),
    iso(c.sentAt ?? c.createdAt),
  );
  return id;
}

function sendSeedCampaign(
  db: DatabaseSync,
  accountId: string,
  campaignId: string,
  segmentId: string | null,
  sentAt: number,
  openRate: number,
  clickRate: number,
) {
  const campaign = get<{ subject: string; html: string; preheader: string }>(
    db,
    'SELECT subject, html, preheader FROM campaigns WHERE id = ?',
    campaignId,
  )!;
  const filter = audienceFilter(db, accountId, segmentId)!;
  // Audience as it was at send time: contacts created before the send.
  const recipients = db
    .prepare(`SELECT id, email, first_name, last_name FROM contacts WHERE account_id = ? AND ${filter.sql} AND created_at <= ?`)
    .all(accountId, ...filter.params, iso(sentAt)) as { id: string; email: string; first_name: string; last_name: string }[];

  let unsubscribed = 0;
  recipients.forEach((contact, index) => {
    const at = sentAt + index * 1500;
    const { id } = createMessage(db, config, {
      accountId,
      campaignId,
      contactId: contact.id,
      contact,
      subject: campaign.subject,
      html: campaign.html,
      preheader: campaign.preheader,
      senderName: DEMO.name,
      status: 'sent',
      createdAt: iso(at),
    });
    run(db, 'UPDATE messages SET sent_at = ?, provider_id = ? WHERE id = ?', iso(at), `log_${id}`, id);
    simulateEngagement(db, accountId, id, contact.id, at, { campaign_id: campaignId }, openRate, clickRate);
    // A couple of unsubscribes, attributed to the campaign.
    if (unsubscribed < 2 && index % 17 === 5) {
      unsubscribed++;
      const when = iso(at + 3 * HOUR);
      run(db, "UPDATE contacts SET status = 'unsubscribed', updated_at = ? WHERE id = ?", when, contact.id);
      recordEvent(db, accountId, contact.id, 'unsubscribe', { message_id: id, campaign_id: campaignId, method: 'link' }, when);
    }
  });
  return recipients.length;
}

function insertAutomation(
  db: DatabaseSync,
  accountId: string,
  a: { name: string; trigger: string; config: object; steps: AutomationStep[]; createdAt: number },
) {
  const id = newId();
  run(
    db,
    `INSERT INTO automations (id, account_id, name, trigger, trigger_config, steps, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
    id,
    accountId,
    a.name,
    a.trigger,
    JSON.stringify(a.config),
    JSON.stringify(a.steps),
    iso(a.createdAt),
    iso(a.createdAt),
  );
  return id;
}

function main() {
  const db = openDatabase(config.databasePath);
  const summary = transaction(db, () => {
    resetDemoAccount(db);

    const accountId = newId();
    const accountCreated = NOW - 400 * DAY;
    run(
      db,
      'INSERT INTO accounts (id, name, email, password_hash, created_at, language) VALUES (?, ?, ?, ?, ?, ?)',
      accountId,
      DEMO.name,
      DEMO.email,
      hashPassword(DEMO.password),
      iso(accountCreated),
      currentLang(),
    );
    run(
      db,
      "INSERT INTO users (id, account_id, email, name, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?, 'owner', ?)",
      accountId,
      accountId,
      DEMO.email,
      DEMO.name,
      hashPassword(DEMO.password),
      iso(accountCreated),
    );
    createApiKey(db, accountId, t('Clé de développement', 'Development key'), DEMO.apiKey);

    const contacts = seedContacts(db, accountId);

    const vipSegment = insertSegment(
      db,
      accountId,
      t('Clients VIP', 'VIP customers'),
      { match: 'any', conditions: [{ field: 'tags', op: 'has_tag', value: 'vip' }, { field: 'total_spent', op: 'gt', value: 300 }] },
      NOW - 60 * DAY,
    );
    insertSegment(
      db,
      accountId,
      t('Nouveaux inscrits (30 jours)', 'New subscribers (30 days)'),
      { match: 'all', conditions: [{ field: 'created_at', op: 'within_days', value: 30 }] },
      NOW - 45 * DAY,
    );
    const inactiveSegment = insertSegment(
      db,
      accountId,
      t('Clients à réactiver', 'Customers to win back'),
      {
        match: 'all',
        conditions: [
          { field: 'orders_count', op: 'gt', value: 0 },
          { field: 'last_order_at', op: 'older_than_days', value: 60 },
        ],
      },
      NOW - 40 * DAY,
    );

    // --- Campaigns -------------------------------------------------------------------------
    const sale = generateFromTemplate({
      prompt: t("Soldes d'automne : -20 % sur toute la boutique avec le code AUTOMNE20", 'Fall sale: 20% off the whole store with code FALL20'),
      brand: DEMO.name,
    });
    const saleSentAt = NOW - 24 * DAY + 9 * HOUR;
    const saleId = insertCampaign(db, accountId, {
      name: t("Soldes d'automne -20 %", 'Fall sale 20% off'),
      subject: sale.subject,
      preheader: sale.preheader,
      html: sale.html,
      segmentId: null,
      status: 'sent',
      createdAt: saleSentAt - 3 * DAY,
      sentAt: saleSentAt,
    });
    const saleRecipients = sendSeedCampaign(db, accountId, saleId, null, saleSentAt, 0.46, 0.32);

    const launch = generateFromTemplate({
      prompt: t(
        'Lancement de la nouvelle collection hiver en avant-première pour nos meilleurs clients',
        'Launch of the new winter collection, early access for our best customers',
      ),
      brand: DEMO.name,
      tone: 'premium',
    });
    const launchSentAt = NOW - 8 * DAY + 10 * HOUR;
    const launchId = insertCampaign(db, accountId, {
      name: t('Avant-première collection hiver', 'Winter collection early access'),
      subject: launch.subject,
      preheader: launch.preheader,
      html: launch.html,
      segmentId: vipSegment,
      status: 'sent',
      createdAt: launchSentAt - 2 * DAY,
      sentAt: launchSentAt,
    });
    const launchRecipients = sendSeedCampaign(db, accountId, launchId, vipSegment, launchSentAt, 0.58, 0.38);

    const bf = generateFromTemplate({
      prompt: t('Black Friday : jusqu’à 40 % de réduction pendant 4 jours', 'Black Friday: up to 40% off for 4 days'),
      brand: DEMO.name,
    });
    insertCampaign(db, accountId, {
      name: 'Black Friday 2026',
      subject: bf.subject,
      preheader: bf.preheader,
      html: bf.html,
      segmentId: null,
      status: 'draft',
      createdAt: NOW - 2 * DAY,
    });

    const winback = generateFromTemplate({
      prompt: t(
        'Vous nous manquez : 15 % pour votre retour, réactivation des clients inactifs',
        'We miss you: 15% off to welcome back inactive customers',
      ),
      brand: DEMO.name,
      tone: 'amical',
    });
    insertCampaign(db, accountId, {
      name: t('Réactivation clients inactifs', 'Inactive customer win-back'),
      subject: winback.subject,
      preheader: winback.preheader,
      html: winback.html,
      segmentId: inactiveSegment,
      status: 'scheduled',
      createdAt: NOW - 1 * DAY,
      scheduledAt: NOW + 5 * DAY,
    });

    // --- Automations -----------------------------------------------------------------------
    const welcome = generateFromTemplate({
      prompt: t('Bienvenue : 10 % sur la première commande avec le code BIENVENUE10', 'Welcome: 10% off your first order with code WELCOME10'),
      brand: DEMO.name,
    });
    const welcomeTips = generateFromTemplate({
      prompt: t(
        'Newsletter : nos conseils pour bien choisir et entretenir vos vêtements',
        'Newsletter: our tips for choosing and caring for your clothes',
      ),
      brand: DEMO.name,
    });
    const welcomeTipsSubject = t('Nos conseils pour bien commencer, {{first_name|}}', 'Our tips to get started, {{first_name|}}');
    const welcomeId = insertAutomation(db, accountId, {
      name: t('Série de bienvenue', 'Welcome series'),
      trigger: 'contact_created',
      config: {},
      steps: [
        { type: 'email', subject: welcome.subject, html: welcome.html, preheader: welcome.preheader },
        { type: 'wait', hours: 48 },
        { type: 'email', subject: welcomeTipsSubject, html: welcomeTips.html },
      ],
      createdAt: NOW - 90 * DAY,
    });
    const cart = generateFromTemplate({ prompt: t('Relance panier abandonné', 'Abandoned cart reminder'), brand: DEMO.name });
    insertAutomation(db, accountId, {
      name: t('Relance panier abandonné', 'Abandoned cart reminder'),
      trigger: 'cart_abandoned',
      config: {},
      steps: [
        { type: 'wait', hours: 1 },
        { type: 'email', subject: cart.subject, html: cart.html, preheader: cart.preheader },
      ],
      createdAt: NOW - 80 * DAY,
    });

    // Welcome series history for contacts who joined in the last 30 days (spreads sends over the month).
    let automationEmails = 0;
    for (const contact of contacts.filter((c) => NOW - c.created < 30 * DAY)) {
      const steps = [
        { at: contact.created + 2 * 60_000, subject: welcome.subject, html: welcome.html },
        { at: contact.created + 48 * HOUR, subject: welcomeTipsSubject, html: welcomeTips.html },
      ].filter((s) => s.at < NOW);
      for (const step of steps) {
        const { id } = createMessage(db, config, {
          accountId,
          automationId: welcomeId,
          contactId: contact.id,
          contact,
          subject: step.subject,
          html: step.html,
          senderName: DEMO.name,
          status: 'sent',
          createdAt: iso(step.at),
        });
        run(db, 'UPDATE messages SET sent_at = ?, provider_id = ? WHERE id = ?', iso(step.at), `log_${id}`, id);
        simulateEngagement(db, accountId, id, contact.id, step.at, { automation_id: welcomeId }, 0.62, 0.3);
        automationEmails++;
      }
      const done = steps.length === 2;
      const status = done ? 'done' : contact.status === 'subscribed' ? 'pending' : 'cancelled';
      run(
        db,
        `INSERT INTO automation_runs (id, automation_id, contact_id, step_index, next_run_at, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        newId(),
        welcomeId,
        contact.id,
        done ? 3 : 2,
        new Date(contact.created + 48 * HOUR).toISOString(),
        status,
        iso(contact.created),
      );
    }

    return { contacts: contacts.length, saleRecipients, launchRecipients, automationEmails };
  });

  console.log(
    t(
      `✔ Seed terminé (${config.databasePath})
  Compte      : ${DEMO.name}
  Connexion   : ${DEMO.email} / ${DEMO.password}
  Clé API     : ${DEMO.apiKey}
  Contacts    : ${summary.contacts}
  Segments    : 3 · Campagnes : 4 (2 envoyées : ${summary.saleRecipients} + ${summary.launchRecipients} destinataires)
  Automations : 2 (${summary.automationEmails} emails de bienvenue historiques)`,
      `✔ Seed complete (${config.databasePath})
  Account     : ${DEMO.name}
  Sign-in     : ${DEMO.email} / ${DEMO.password}
  API key     : ${DEMO.apiKey}
  Contacts    : ${summary.contacts}
  Segments    : 3 · Campaigns: 4 (2 sent: ${summary.saleRecipients} + ${summary.launchRecipients} recipients)
  Automations : 2 (${summary.automationEmails} past welcome emails)`,
    ),
  );
  db.close();
}

// Demo language: SEED_LANG=en for an English demo account (French by default).
withLang(normalizeLang(process.env.SEED_LANG), main);
