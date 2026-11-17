import { escapeHtml } from './render.js';

export interface GenerateEmailInput {
  prompt: string;
  tone?: string;
  brand?: string;
}

export interface GeneratedEmail {
  subject: string;
  preheader: string;
  html: string;
  source: 'template';
}

/** Builds a ready-to-edit email from a short brief using the local template library (no external service). */
export function generateEmail(input: GenerateEmailInput): GeneratedEmail {
  return generateFromTemplate(input);
}

/* -------------------------------------------------------------------------- */
/* Deterministic template generator (no API key needed)                       */
/* -------------------------------------------------------------------------- */

interface Theme {
  key: string;
  match: RegExp;
  eyebrow: string;
  headline: (ctx: TemplateContext) => string;
  intro: (ctx: TemplateContext) => string;
  bullets: string[];
  cta: string;
  subject: (ctx: TemplateContext) => string;
  preheader: (ctx: TemplateContext) => string;
  accent: string;
  emoji: string;
}

interface TemplateContext {
  brand: string;
  discount?: string;
  topic: string;
  tone: 'amical' | 'professionnel' | 'enthousiaste' | 'premium';
}

const THEMES: Theme[] = [
  {
    key: 'black_friday',
    match: /black\s*friday|cyber\s*monday/i,
    eyebrow: 'Black Friday',
    headline: (c) => (c.discount ? `Jusqu'à ${c.discount} sur tout le site` : 'Nos plus belles offres de l’année'),
    intro: (c) =>
      `Le Black Friday est arrivé chez ${c.brand}. Pendant quelques jours seulement, profitez de remises exceptionnelles sur nos best-sellers — les stocks partent vite.`,
    bullets: ['Remises sur une sélection de best-sellers', 'Livraison offerte dès 50 €', 'Retours gratuits sous 30 jours'],
    cta: 'J’en profite',
    subject: (c) => (c.discount ? `${c.discount} pour le Black Friday, {{first_name|}} 🖤` : 'Black Friday : c’est parti 🖤'),
    preheader: () => 'Offres limitées, stocks limités. Ne tardez pas.',
    accent: '#111827',
    emoji: '🖤',
  },
  {
    key: 'christmas',
    match: /no[eë]l|f[eê]tes|christmas|cadeau/i,
    eyebrow: 'Les fêtes approchent',
    headline: () => 'Des cadeaux qui font vraiment plaisir',
    intro: (c) =>
      `Cette année, ${c.brand} vous simplifie les fêtes : une sélection de cadeaux pensés pour chacun, emballés avec soin et livrés à temps.`,
    bullets: ['Sélection cadeaux par budget', 'Emballage cadeau offert', 'Livraison garantie avant Noël'],
    cta: 'Découvrir la sélection',
    subject: () => '🎁 Vos cadeaux de Noël, sans stress',
    preheader: () => 'Idées cadeaux, emballage offert et livraison garantie.',
    accent: '#B91C1C',
    emoji: '🎁',
  },
  {
    key: 'cart',
    match: /panier|abandon|oubli[ée]|cart/i,
    eyebrow: 'Votre panier vous attend',
    headline: () => 'Vous avez oublié quelque chose…',
    intro: (c) =>
      `Les articles de votre panier ${c.brand} sont toujours disponibles, mais nous ne pouvons pas les réserver éternellement. Finalisez votre commande en un clic.`,
    bullets: ['Paiement 100 % sécurisé', 'Livraison rapide', 'Service client à votre écoute'],
    cta: 'Finaliser ma commande',
    subject: (c) => (c.discount ? `{{first_name|Votre}} panier + ${c.discount} offerts` : '{{first_name|}}, votre panier vous attend'),
    preheader: () => 'Vos articles sont encore disponibles — pour le moment.',
    accent: '#0E0E0C',
    emoji: '🛒',
  },
  {
    key: 'welcome',
    match: /bienvenue|welcome|inscription|nouvel?\s+abonn/i,
    eyebrow: 'Bienvenue',
    headline: (c) => `Bienvenue chez ${c.brand} !`,
    intro: (c) =>
      `Merci de nous avoir rejoints. Chez ${c.brand}, nous sélectionnons chaque produit avec exigence. Voici ce qui vous attend en tant que membre de la communauté.`,
    bullets: ['Accès en avant-première aux nouveautés', 'Offres réservées aux abonnés', 'Conseils et inspirations chaque mois'],
    cta: 'Découvrir la boutique',
    subject: (c) => (c.discount ? `Bienvenue {{first_name|}} : ${c.discount} sur votre 1re commande` : `Bienvenue chez ${c.brand}, {{first_name|}} 👋`),
    preheader: () => 'Ravi de vous compter parmi nous. Voici votre cadeau de bienvenue.',
    accent: '#0E0E0C',
    emoji: '👋',
  },
  {
    key: 'launch',
    match: /nouveaut[ée]|lancement|nouvelle?\s+collection|launch|d[ée]couvr/i,
    eyebrow: 'Nouveauté',
    headline: (c) => `La nouvelle collection ${c.brand} est là`,
    intro: () =>
      'Des pièces pensées pour durer, des matières sélectionnées avec soin et des finitions irréprochables. Soyez parmi les premiers à la découvrir.',
    bullets: ['Édition limitée', 'Fabrication responsable', 'Disponible dès aujourd’hui'],
    cta: 'Voir la collection',
    subject: () => '✨ Nouveauté : découvrez-la en avant-première',
    preheader: () => 'Une collection inédite, disponible en quantité limitée.',
    accent: '#0E0E0C',
    emoji: '✨',
  },
  {
    key: 'winback',
    match: /reconqu|r[ée]activ|vous nous manquez|inactif|win.?back/i,
    eyebrow: 'Vous nous manquez',
    headline: () => 'Ça fait longtemps !',
    intro: (c) =>
      `Beaucoup de nouveautés sont arrivées chez ${c.brand} depuis votre dernière visite. Pour fêter vos retrouvailles, nous vous avons réservé une attention particulière.`,
    bullets: ['Nouveautés de la saison', 'Avantage réservé pour votre retour', 'Livraison offerte'],
    cta: 'Revenir faire un tour',
    subject: (c) => (c.discount ? `{{first_name|}}, ${c.discount} pour votre retour` : '{{first_name|}}, vous nous manquez 💜'),
    preheader: () => 'Une petite attention vous attend.',
    accent: '#0E0E0C',
    emoji: '💜',
  },
  {
    key: 'sale',
    match: /solde|promo|r[ée]duction|remise|offre|vente priv[ée]e|%|code/i,
    eyebrow: 'Offre limitée',
    headline: (c) => (c.discount ? `${c.discount} sur votre prochaine commande` : 'Une offre rien que pour vous'),
    intro: (c) =>
      `Pour vous remercier de votre fidélité, ${c.brand} vous offre un avantage exclusif. L’offre est valable quelques jours seulement : c’est le moment de vous faire plaisir.`,
    bullets: ['Valable sur une large sélection', 'Cumulable avec la livraison offerte', 'Offre limitée dans le temps'],
    cta: 'J’en profite',
    subject: (c) => (c.discount ? `{{first_name|}}, ${c.discount} rien que pour vous` : 'Une offre exclusive vous attend'),
    preheader: () => 'Offre exclusive, valable quelques jours seulement.',
    accent: '#0E0E0C',
    emoji: '🎉',
  },
];

const NEWSLETTER_THEME: Theme = {
  key: 'newsletter',
  match: /.*/,
  eyebrow: 'Les nouvelles du mois',
  headline: (c) => capitalize(c.topic),
  intro: (c) =>
    `Voici l’essentiel de ce qui se passe chez ${c.brand} : nos coups de cœur, nos conseils et ce qui arrive bientôt. Bonne lecture !`,
  bullets: ['Nos coups de cœur du moment', 'Le conseil de l’équipe', 'À venir très bientôt'],
  cta: 'Lire la suite',
  subject: (c) => `${capitalize(c.topic).slice(0, 48)} — ${c.brand}`,
  preheader: () => 'Nos nouveautés, conseils et coups de cœur du mois.',
  accent: '#0E0E0C',
  emoji: '📬',
};

function capitalize(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

function detectTone(tone?: string): TemplateContext['tone'] {
  const t = (tone ?? '').toLowerCase();
  if (/pro|formel|corporate|s[ée]rieux/.test(t)) return 'professionnel';
  if (/enthou|fun|dynamique|[ée]nergique|joyeux/.test(t)) return 'enthousiaste';
  if (/luxe|premium|[ée]l[ée]gant|haut de gamme|chic/.test(t)) return 'premium';
  return 'amical';
}

function summarizeTopic(prompt: string): string {
  const firstSentence = prompt.split(/[.!?\n]/)[0]?.trim() ?? '';
  const cleaned = firstSentence
    .replace(/^(r[ée]dige|[ée]cris|cr[ée]e|g[ée]n[èe]re|fais|pr[ée]pare)[- ]?(moi)?\s+(un|une)?\s*(e-?mail|mail|newsletter|campagne)?\s*(pour|sur|de|d'|à propos de|qui)?\s*/i, '')
    .trim();
  const topic = cleaned || 'Les nouvelles du mois';
  return topic.length > 70 ? `${topic.slice(0, 67).trimEnd()}…` : topic;
}

function greeting(tone: TemplateContext['tone']): string {
  switch (tone) {
    case 'professionnel':
      return 'Bonjour {{first_name|}},';
    case 'premium':
      return 'Chère cliente, cher client,';
    case 'enthousiaste':
      return 'Hello {{first_name|}} !';
    default:
      return 'Bonjour {{first_name|}} !';
  }
}

/** Builds a polished, responsive, table-based email from the prompt — fully deterministic. */
export function generateFromTemplate(input: GenerateEmailInput): GeneratedEmail {
  const prompt = input.prompt.trim();
  const discountMatch = /(\d{1,2})\s?%/.exec(prompt) ?? /(\d{1,3})\s?(?:€|euros?)\s+(?:de\s+)?(?:r[ée]duction|offerts?|remise)/i.exec(prompt);
  const ctx: TemplateContext = {
    brand: input.brand?.trim() || 'votre boutique',
    discount: discountMatch ? (discountMatch[0].includes('%') ? `-${discountMatch[1]} %` : `${discountMatch[1]} €`) : undefined,
    topic: summarizeTopic(prompt),
    tone: detectTone(input.tone),
  };
  const theme = THEMES.find((t) => t.match.test(prompt)) ?? NEWSLETTER_THEME;
  const codeMatch = /code\s+(?:promo\s+)?[«"']?\s*([A-Z0-9]{3,20})/i.exec(prompt);
  const promoCode = codeMatch?.[1]?.toUpperCase();
  const urlMatch = /https?:\/\/[^\s"'<>]+/i.exec(prompt);
  const ctaUrl = urlMatch?.[0] ?? 'https://exemple.com';

  const accent = ctx.tone === 'premium' ? '#1F2937' : theme.accent;
  const headline = escapeHtml(theme.headline(ctx));
  let intro = theme.intro(ctx);
  if (ctx.tone === 'enthousiaste') intro = `${intro} ${theme.emoji}`;
  if (ctx.tone === 'premium') intro = intro.replace(/c’est le moment de vous faire plaisir/, 'accordez-vous ce qui se fait de mieux');
  const brandHtml = escapeHtml(ctx.brand === 'votre boutique' ? 'Votre boutique' : ctx.brand);

  const bulletsHtml = theme.bullets
    .map(
      (b) => `
              <tr>
                <td width="28" valign="top" style="padding:6px 0;font-family:Inter,Segoe UI,Helvetica,Arial,sans-serif;font-size:15px;line-height:22px;color:${accent};font-weight:700;">✓</td>
                <td valign="top" style="padding:6px 0;font-family:Inter,Segoe UI,Helvetica,Arial,sans-serif;font-size:15px;line-height:22px;color:#334155;">${escapeHtml(b)}</td>
              </tr>`,
    )
    .join('');

  const codeBlock = promoCode
    ? `
          <tr>
            <td align="center" style="padding:8px 40px 8px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border:2px dashed ${accent};border-radius:12px;">
                <tr>
                  <td align="center" style="padding:14px 28px;font-family:Inter,Segoe UI,Helvetica,Arial,sans-serif;">
                    <div style="font-size:12px;letter-spacing:1px;text-transform:uppercase;color:#64748b;">Votre code</div>
                    <div style="font-size:24px;font-weight:800;letter-spacing:3px;color:${accent};">${escapeHtml(promoCode)}</div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>`
    : '';

  const html = `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="x-apple-disable-message-reformatting" />
  <title>${headline}</title>
  <style>
    @media only screen and (max-width: 620px) {
      .container { width: 100% !important; }
      .px { padding-left: 24px !important; padding-right: 24px !important; }
      .h1 { font-size: 26px !important; line-height: 32px !important; }
    }
  </style>
</head>
<body style="margin:0;padding:0;background-color:#f1f5f9;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f1f5f9;">
    <tr>
      <td align="center" style="padding:32px 12px;">
        <table role="presentation" class="container" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;background-color:#ffffff;border-radius:16px;overflow:hidden;">
          <tr>
            <td class="px" style="padding:28px 40px;border-bottom:1px solid #e2e8f0;font-family:Inter,Segoe UI,Helvetica,Arial,sans-serif;font-size:18px;font-weight:800;color:#0f172a;letter-spacing:-0.2px;">
              ${brandHtml}
            </td>
          </tr>
          <tr>
            <td class="px" style="padding:40px 40px 8px;font-family:Inter,Segoe UI,Helvetica,Arial,sans-serif;">
              <div style="display:inline-block;padding:6px 12px;border-radius:999px;background-color:${accent}14;color:${accent};font-size:12px;font-weight:700;letter-spacing:0.6px;text-transform:uppercase;">${escapeHtml(theme.eyebrow)}</div>
              <h1 class="h1" style="margin:20px 0 0;font-size:32px;line-height:38px;font-weight:800;color:#0f172a;letter-spacing:-0.6px;">${headline}</h1>
            </td>
          </tr>
          <tr>
            <td class="px" style="padding:20px 40px 8px;font-family:Inter,Segoe UI,Helvetica,Arial,sans-serif;font-size:16px;line-height:26px;color:#334155;">
              <p style="margin:0 0 14px;">${greeting(ctx.tone)}</p>
              <p style="margin:0;">${escapeHtml(intro)}</p>
            </td>
          </tr>
          <tr>
            <td class="px" style="padding:16px 40px 8px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0">${bulletsHtml}
              </table>
            </td>
          </tr>${codeBlock}
          <tr>
            <td align="center" class="px" style="padding:28px 40px 40px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td align="center" bgcolor="${accent}" style="border-radius:12px;">
                    <a href="${escapeHtml(ctaUrl)}" style="display:inline-block;padding:16px 32px;font-family:Inter,Segoe UI,Helvetica,Arial,sans-serif;font-size:16px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:12px;">${escapeHtml(theme.cta)} →</a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td class="px" style="padding:24px 40px;background-color:#f8fafc;border-top:1px solid #e2e8f0;font-family:Inter,Segoe UI,Helvetica,Arial,sans-serif;font-size:12px;line-height:18px;color:#64748b;" align="center">
              ${brandHtml} · Vous recevez cet email car vous êtes inscrit(e) à notre newsletter.<br />
              <a href="{{unsubscribe_url}}" style="color:${accent};text-decoration:underline;">Se désinscrire</a>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const subject = theme.subject(ctx).replace(/\s+,/g, ',').trim();
  return { subject, preheader: theme.preheader(ctx), html, source: 'template' };
}
