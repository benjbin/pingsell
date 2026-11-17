import { escapeHtml } from './render.js';
import { currentLang, t } from '../i18n.js';

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

/** Themes in the current language (texts are resolved per call: the language depends on the request). */
function themes(): Theme[] {
  return [
  {
    key: 'black_friday',
    match: /black\s*friday|cyber\s*monday/i,
    eyebrow: 'Black Friday',
    headline: (c) =>
      c.discount
        ? t(`Jusqu'à ${c.discount} sur tout le site`, `Up to ${c.discount} off sitewide`)
        : t('Nos plus belles offres de l’année', 'Our best deals of the year'),
    intro: (c) =>
      t(
        `Le Black Friday est arrivé chez ${c.brand}. Pendant quelques jours seulement, profitez de remises exceptionnelles sur nos best-sellers — les stocks partent vite.`,
        `Black Friday is here at ${c.brand}. For a few days only, enjoy exceptional discounts on our best-sellers — stock is going fast.`,
      ),
    bullets: t(
      ['Remises sur une sélection de best-sellers', 'Livraison offerte dès 50 €', 'Retours gratuits sous 30 jours'],
      ['Discounts on a selection of best-sellers', 'Free shipping on orders over €50', 'Free returns within 30 days'],
    ),
    cta: t('J’en profite', 'Shop the deals'),
    subject: (c) =>
      c.discount
        ? t(`${c.discount} pour le Black Friday, {{first_name|}} 🖤`, `${c.discount} off for Black Friday, {{first_name|}} 🖤`)
        : t('Black Friday : c’est parti 🖤', 'Black Friday starts now 🖤'),
    preheader: () => t('Offres limitées, stocks limités. Ne tardez pas.', 'Limited offers, limited stock. Don’t wait.'),
    accent: '#111827',
    emoji: '🖤',
  },
  {
    key: 'christmas',
    match: t(/no[eë]l|f[eê]tes|christmas|cadeau/i, /no[eë]l|f[eê]tes|christmas|cadeau|holiday|gift/i),
    eyebrow: t('Les fêtes approchent', 'The holidays are coming'),
    headline: () => t('Des cadeaux qui font vraiment plaisir', 'Gifts they’ll actually love'),
    intro: (c) =>
      t(
        `Cette année, ${c.brand} vous simplifie les fêtes : une sélection de cadeaux pensés pour chacun, emballés avec soin et livrés à temps.`,
        `This year, ${c.brand} makes the holidays easy: a curated gift selection for everyone, carefully wrapped and delivered on time.`,
      ),
    bullets: t(
      ['Sélection cadeaux par budget', 'Emballage cadeau offert', 'Livraison garantie avant Noël'],
      ['Gift picks for every budget', 'Free gift wrapping', 'Guaranteed delivery before Christmas'],
    ),
    cta: t('Découvrir la sélection', 'Explore the gift guide'),
    subject: () => t('🎁 Vos cadeaux de Noël, sans stress', '🎁 Stress-free Christmas gifts'),
    preheader: () =>
      t('Idées cadeaux, emballage offert et livraison garantie.', 'Gift ideas, free wrapping and guaranteed delivery.'),
    accent: '#B91C1C',
    emoji: '🎁',
  },
  {
    key: 'cart',
    match: t(/panier|abandon|oubli[ée]|cart/i, /panier|abandon|oubli[ée]|cart|forgot/i),
    eyebrow: t('Votre panier vous attend', 'Your cart is waiting'),
    headline: () => t('Vous avez oublié quelque chose…', 'You forgot something…'),
    intro: (c) =>
      t(
        `Les articles de votre panier ${c.brand} sont toujours disponibles, mais nous ne pouvons pas les réserver éternellement. Finalisez votre commande en un clic.`,
        `The items in your ${c.brand} cart are still available, but we can’t hold them forever. Complete your order in one click.`,
      ),
    bullets: t(
      ['Paiement 100 % sécurisé', 'Livraison rapide', 'Service client à votre écoute'],
      ['100% secure checkout', 'Fast shipping', 'Friendly customer support'],
    ),
    cta: t('Finaliser ma commande', 'Complete my order'),
    subject: (c) =>
      c.discount
        ? t(`{{first_name|Votre}} panier + ${c.discount} offerts`, `Your cart + ${c.discount} off, {{first_name|}}`)
        : t('{{first_name|}}, votre panier vous attend', '{{first_name|}}, your cart is waiting'),
    preheader: () =>
      t('Vos articles sont encore disponibles — pour le moment.', 'Your items are still available — for now.'),
    accent: '#0E0E0C',
    emoji: '🛒',
  },
  {
    key: 'welcome',
    match: t(/bienvenue|welcome|inscription|nouvel?\s+abonn/i, /bienvenue|welcome|inscription|nouvel?\s+abonn|sign.?up|new\s+subscriber/i),
    eyebrow: t('Bienvenue', 'Welcome'),
    headline: (c) => t(`Bienvenue chez ${c.brand} !`, `Welcome to ${c.brand}!`),
    intro: (c) =>
      t(
        `Merci de nous avoir rejoints. Chez ${c.brand}, nous sélectionnons chaque produit avec exigence. Voici ce qui vous attend en tant que membre de la communauté.`,
        `Thanks for joining us. At ${c.brand}, every product is carefully selected. Here’s what you can look forward to as a member of the community.`,
      ),
    bullets: t(
      ['Accès en avant-première aux nouveautés', 'Offres réservées aux abonnés', 'Conseils et inspirations chaque mois'],
      ['Early access to new arrivals', 'Subscriber-only offers', 'Tips and inspiration every month'],
    ),
    cta: t('Découvrir la boutique', 'Visit the store'),
    subject: (c) =>
      c.discount
        ? t(`Bienvenue {{first_name|}} : ${c.discount} sur votre 1re commande`, `Welcome {{first_name|}}: ${c.discount} off your first order`)
        : t(`Bienvenue chez ${c.brand}, {{first_name|}} 👋`, `Welcome to ${c.brand}, {{first_name|}} 👋`),
    preheader: () =>
      t('Ravi de vous compter parmi nous. Voici votre cadeau de bienvenue.', 'We’re glad you’re here. Here’s your welcome gift.'),
    accent: '#0E0E0C',
    emoji: '👋',
  },
  {
    key: 'launch',
    match: t(/nouveaut[ée]|lancement|nouvelle?\s+collection|launch|d[ée]couvr/i, /nouveaut[ée]|lancement|nouvelle?\s+collection|launch|d[ée]couvr|new\s+(arrival|collection|product)/i),
    eyebrow: t('Nouveauté', 'New arrival'),
    headline: (c) => t(`La nouvelle collection ${c.brand} est là`, `The new ${c.brand} collection is here`),
    intro: () =>
      t(
        'Des pièces pensées pour durer, des matières sélectionnées avec soin et des finitions irréprochables. Soyez parmi les premiers à la découvrir.',
        'Pieces made to last, carefully selected materials and flawless finishes. Be among the first to discover it.',
      ),
    bullets: t(
      ['Édition limitée', 'Fabrication responsable', 'Disponible dès aujourd’hui'],
      ['Limited edition', 'Responsibly made', 'Available today'],
    ),
    cta: t('Voir la collection', 'See the collection'),
    subject: () => t('✨ Nouveauté : découvrez-la en avant-première', '✨ New: get an exclusive first look'),
    preheader: () =>
      t('Une collection inédite, disponible en quantité limitée.', 'A brand-new collection, available in limited quantities.'),
    accent: '#0E0E0C',
    emoji: '✨',
  },
  {
    key: 'winback',
    match: t(/reconqu|r[ée]activ|vous nous manquez|inactif|win.?back/i, /reconqu|r[ée]activ|vous nous manquez|inactif|win.?back|miss\s+you|inactive|re.?engage/i),
    eyebrow: t('Vous nous manquez', 'We miss you'),
    headline: () => t('Ça fait longtemps !', 'It’s been a while!'),
    intro: (c) =>
      t(
        `Beaucoup de nouveautés sont arrivées chez ${c.brand} depuis votre dernière visite. Pour fêter vos retrouvailles, nous vous avons réservé une attention particulière.`,
        `Lots of new things have arrived at ${c.brand} since your last visit. To celebrate your return, we’ve saved a little something for you.`,
      ),
    bullets: t(
      ['Nouveautés de la saison', 'Avantage réservé pour votre retour', 'Livraison offerte'],
      ['This season’s new arrivals', 'A special perk for your return', 'Free shipping'],
    ),
    cta: t('Revenir faire un tour', 'Come take a look'),
    subject: (c) =>
      c.discount
        ? t(`{{first_name|}}, ${c.discount} pour votre retour`, `{{first_name|}}, ${c.discount} off to welcome you back`)
        : t('{{first_name|}}, vous nous manquez 💜', '{{first_name|}}, we miss you 💜'),
    preheader: () => t('Une petite attention vous attend.', 'A little something is waiting for you.'),
    accent: '#0E0E0C',
    emoji: '💜',
  },
  {
    key: 'sale',
    match: t(
      /solde|promo|r[ée]duction|remise|offre|vente priv[ée]e|%|code/i,
      /solde|promo|r[ée]duction|remise|offre|vente priv[ée]e|%|code|\bsale\b|discount|\boff\b|offer|deal/i,
    ),
    eyebrow: t('Offre limitée', 'Limited-time offer'),
    headline: (c) =>
      c.discount
        ? t(`${c.discount} sur votre prochaine commande`, `${c.discount} off your next order`)
        : t('Une offre rien que pour vous', 'An offer just for you'),
    intro: (c) =>
      t(
        `Pour vous remercier de votre fidélité, ${c.brand} vous offre un avantage exclusif. L’offre est valable quelques jours seulement : c’est le moment de vous faire plaisir.`,
        `To thank you for your loyalty, ${c.brand} has an exclusive perk for you. The offer is only valid for a few days: it’s the perfect time to treat yourself.`,
      ),
    bullets: t(
      ['Valable sur une large sélection', 'Cumulable avec la livraison offerte', 'Offre limitée dans le temps'],
      ['Valid on a wide selection', 'Combines with free shipping', 'For a limited time only'],
    ),
    cta: t('J’en profite', 'Claim my offer'),
    subject: (c) =>
      c.discount
        ? t(`{{first_name|}}, ${c.discount} rien que pour vous`, `{{first_name|}}, ${c.discount} off just for you`)
        : t('Une offre exclusive vous attend', 'An exclusive offer is waiting for you'),
    preheader: () =>
      t('Offre exclusive, valable quelques jours seulement.', 'Exclusive offer, valid for a few days only.'),
    accent: '#0E0E0C',
    emoji: '🎉',
  },
  ];
}

function newsletterTheme(): Theme {
  return {
    key: 'newsletter',
    match: /.*/,
    eyebrow: t('Les nouvelles du mois', 'This month’s news'),
    headline: (c) => capitalize(c.topic),
    intro: (c) =>
      t(
        `Voici l’essentiel de ce qui se passe chez ${c.brand} : nos coups de cœur, nos conseils et ce qui arrive bientôt. Bonne lecture !`,
        `Here’s what’s new at ${c.brand}: our favorites, our tips and what’s coming soon. Happy reading!`,
      ),
    bullets: t(
      ['Nos coups de cœur du moment', 'Le conseil de l’équipe', 'À venir très bientôt'],
      ['Our current favorites', 'A tip from the team', 'Coming very soon'],
    ),
    cta: t('Lire la suite', 'Read more'),
    subject: (c) => `${capitalize(c.topic).slice(0, 48)} — ${c.brand}`,
    preheader: () =>
      t('Nos nouveautés, conseils et coups de cœur du mois.', 'This month’s new arrivals, tips and favorites.'),
    accent: '#0E0E0C',
    emoji: '📬',
  };
}

function capitalize(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

function detectTone(tone?: string): TemplateContext['tone'] {
  const value = (tone ?? '').toLowerCase();
  // English keywords are only recognized for English requests (French behaviour unchanged).
  const en = currentLang() === 'en';
  if (/pro|formel|corporate|s[ée]rieux/.test(value) || (en && /formal|serious/.test(value))) return 'professionnel';
  if (/enthou|fun|dynamique|[ée]nergique|joyeux/.test(value) || (en && /enthu|energetic|upbeat|cheerful/.test(value))) return 'enthousiaste';
  if (/luxe|premium|[ée]l[ée]gant|haut de gamme|chic/.test(value) || (en && /luxury|high.?end|elegant/.test(value))) return 'premium';
  return 'amical';
}

function summarizeTopic(prompt: string): string {
  const firstSentence = prompt.split(/[.!?\n]/)[0]?.trim() ?? '';
  const stripped = firstSentence
    .replace(/^(r[ée]dige|[ée]cris|cr[ée]e|g[ée]n[èe]re|fais|pr[ée]pare)[- ]?(moi)?\s+(un|une)?\s*(e-?mail|mail|newsletter|campagne)?\s*(pour|sur|de|d'|à propos de|qui)?\s*/i, '')
    .trim();
  const cleaned =
    currentLang() === 'en'
      ? stripped.replace(/^(write|create|generate|make|draft|prepare)\s+(me\s+)?(an?\s+)?(e-?mail|mail|newsletter|campaign)?\s*(for|about|on|to|that)?\s*/i, '').trim()
      : stripped;
  const topic = cleaned || t('Les nouvelles du mois', 'This month’s news');
  return topic.length > 70 ? `${topic.slice(0, 67).trimEnd()}…` : topic;
}

function greeting(tone: TemplateContext['tone']): string {
  switch (tone) {
    case 'professionnel':
      return t('Bonjour {{first_name|}},', 'Hello {{first_name|}},');
    case 'premium':
      return t('Chère cliente, cher client,', 'Dear valued customer,');
    case 'enthousiaste':
      return t('Hello {{first_name|}} !', 'Hey {{first_name|}}!');
    default:
      return t('Bonjour {{first_name|}} !', 'Hi {{first_name|}}!');
  }
}

/** Builds a polished, responsive, table-based email from the prompt — fully deterministic. */
export function generateFromTemplate(input: GenerateEmailInput): GeneratedEmail {
  const prompt = input.prompt.trim();
  const discountMatch =
    /(\d{1,2})\s?%/.exec(prompt) ??
    /(\d{1,3})\s?(?:€|euros?)\s+(?:de\s+)?(?:r[ée]duction|offerts?|remise)/i.exec(prompt) ??
    (currentLang() === 'en' ? /€\s?(\d{1,3})\s+(?:off|discount)|(\d{1,3})\s?(?:€|euros?)\s+(?:off|discount)/i.exec(prompt) : null);
  const discountValue = discountMatch ? (discountMatch[1] ?? discountMatch[2]) : undefined;
  const defaultBrand = t('votre boutique', 'your store');
  const ctx: TemplateContext = {
    brand: input.brand?.trim() || defaultBrand,
    discount: discountMatch
      ? discountMatch[0].includes('%')
        ? t(`-${discountValue} %`, `${discountValue}%`)
        : t(`${discountValue} €`, `€${discountValue}`)
      : undefined,
    topic: summarizeTopic(prompt),
    tone: detectTone(input.tone),
  };
  const theme = themes().find((th) => th.match.test(prompt)) ?? newsletterTheme();
  const codeMatch = /code\s+(?:promo\s+)?[«"']?\s*([A-Z0-9]{3,20})/i.exec(prompt);
  const promoCode = codeMatch?.[1]?.toUpperCase();
  const urlMatch = /https?:\/\/[^\s"'<>]+/i.exec(prompt);
  const ctaUrl = urlMatch?.[0] ?? t('https://exemple.com', 'https://example.com');

  const accent = ctx.tone === 'premium' ? '#1F2937' : theme.accent;
  const headline = escapeHtml(theme.headline(ctx));
  let intro = theme.intro(ctx);
  if (ctx.tone === 'enthousiaste') intro = `${intro} ${theme.emoji}`;
  if (ctx.tone === 'premium') {
    intro = t(
      intro.replace(/c’est le moment de vous faire plaisir/, 'accordez-vous ce qui se fait de mieux'),
      intro.replace(/it’s the perfect time to treat yourself/, 'treat yourself to the very best'),
    );
  }
  const brandHtml = escapeHtml(ctx.brand === defaultBrand ? t('Votre boutique', 'Your store') : ctx.brand);

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
                    <div style="font-size:12px;letter-spacing:1px;text-transform:uppercase;color:#64748b;">${t('Votre code', 'Your code')}</div>
                    <div style="font-size:24px;font-weight:800;letter-spacing:3px;color:${accent};">${escapeHtml(promoCode)}</div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>`
    : '';

  const html = `<!DOCTYPE html>
<html lang="${currentLang()}">
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
              ${brandHtml} · ${t(
                'Vous recevez cet email car vous êtes inscrit(e) à notre newsletter.',
                'You’re receiving this email because you subscribed to our newsletter.',
              )}<br />
              <a href="{{unsubscribe_url}}" style="color:${accent};text-decoration:underline;">${t('Se désinscrire', 'Unsubscribe')}</a>
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
