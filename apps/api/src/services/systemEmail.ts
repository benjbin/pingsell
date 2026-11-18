import { currentLang, t } from '../i18n.js';

/**
 * Pingsell's own transactional emails (password reset, team invitations): one branded layout.
 * Table-based with inline styles so it renders the same in Gmail, Outlook, Apple Mail and on mobile.
 * Images are served by the web app (apps/web/public/email).
 */
export interface SystemEmailInput {
  /** Base URL of the web app, where /email/*.png live. */
  appUrl: string;
  /** Hidden preview text shown next to the subject in the inbox. */
  preheader: string;
  /** Small label above the title (e.g. « Sécurité du compte »). */
  eyebrow: string;
  /** Title: first part in navy, second part in blue (the site's display style). */
  title: [string, string];
  /** Paragraphs of plain text (escaped here); `**bold**` is supported. */
  paragraphs: string[];
  cta: { label: string; url: string };
  /** Small facts shown under the button, e.g. « Valable 60 minutes ». */
  facts?: string[];
  /** Grey note at the bottom of the card (e.g. « Vous n'êtes pas à l'origine… »). */
  note?: string;
  /** Why this person receives the email (footer). */
  reason: string;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const rich = (s: string) => esc(s).replace(/\*\*(.+?)\*\*/g, '<strong style="color:#0B214A;">$1</strong>');

const NAVY = '#0B214A';
const BLUE = '#145CFF';
const INK = '#3D4D6A';
const MUTED = '#7A879E';
const BG = '#EEF2F8';
const FONT = "'Outfit','Manrope',-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";
const TEXT_FONT = "'Manrope',-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";

export function renderSystemEmail(input: SystemEmailInput): { html: string; text: string } {
  const base = input.appUrl.replace(/\/+$/, '');
  const year = new Date().getFullYear();
  const facts = (input.facts ?? [])
    .map((f) => `<span style="display:inline-block;margin:0 6px 8px 0;padding:7px 12px;border-radius:999px;background:#F1F5FD;color:${NAVY};font:600 12px/1 ${TEXT_FONT};white-space:nowrap;">${esc(f)}</span>`)
    .join(' ');

  const html = `<!DOCTYPE html>
<html lang="${currentLang()}" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${esc(input.title.join(' '))}</title>
<link href="https://fonts.googleapis.com/css2?family=Outfit:wght@700;800&family=Manrope:wght@400;600;700&display=swap" rel="stylesheet">
<style>
  @media (max-width:600px){
    .card{border-radius:20px!important}
    .pad{padding:32px 24px!important}
    .title{font-size:30px!important}
    .btn a{display:block!important;text-align:center!important}
  }
  a{color:${BLUE}}
</style>
</head>
<body style="margin:0;padding:0;background:${BG};-webkit-text-size-adjust:100%;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${esc(input.preheader)}&#8199;&#65279;&#847;&#8199;&#65279;&#847;&#8199;&#65279;&#847;&#8199;&#65279;&#847;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BG};">
<tr><td align="center" style="padding:40px 12px 32px;">

  <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="width:100%;max-width:560px;">
    <tr><td align="center" style="padding:0 0 28px;">
      <a href="${esc(base)}" style="text-decoration:none;"><img src="${esc(base)}/email/pingsell-logo.png" width="140" height="32" alt="Pingsell" style="display:block;width:140px;height:auto;border:0;"></a>
    </td></tr>
  </table>

  <table role="presentation" width="560" cellpadding="0" cellspacing="0" class="card" style="width:100%;max-width:560px;background:#FFFFFF;border-radius:28px;overflow:hidden;box-shadow:0 24px 48px -32px rgba(11,33,74,0.35);">
    <tr><td style="height:6px;line-height:6px;font-size:0;background:${BLUE};background-image:linear-gradient(90deg,${NAVY},${BLUE});">&nbsp;</td></tr>
    <tr><td class="pad" style="padding:44px 48px 40px;">

      <p style="margin:0 0 14px;font:700 11px/1 ${TEXT_FONT};letter-spacing:0.18em;text-transform:uppercase;color:${BLUE};">${esc(input.eyebrow)}</p>
      <h1 class="title" style="margin:0 0 22px;font:800 36px/0.98 ${FONT};letter-spacing:-0.02em;text-transform:uppercase;color:${NAVY};">${esc(input.title[0])}<br><span style="color:${BLUE};">${esc(input.title[1])}</span></h1>

      ${input.paragraphs.map((p) => `<p style="margin:0 0 16px;font:400 16px/1.65 ${TEXT_FONT};color:${INK};">${rich(p)}</p>`).join('\n      ')}

      <table role="presentation" cellpadding="0" cellspacing="0" class="btn" style="margin:30px 0 20px;">
        <tr><td style="border-radius:999px;background:${BLUE};">
          <a href="${esc(input.cta.url)}" style="display:inline-block;padding:17px 34px;border-radius:999px;background:${BLUE};color:#FFFFFF;font:700 16px/1 ${FONT};text-decoration:none;">${esc(input.cta.label)}&nbsp;&nbsp;&rarr;</a>
        </td></tr>
      </table>

      ${facts ? `<div style="margin:0 0 4px;">${facts}</div>` : ''}

      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:26px 0 0;border-top:1px solid #E6EBF3;">
        <tr><td style="padding:22px 0 0;">
          <p style="margin:0 0 8px;font:400 13px/1.6 ${TEXT_FONT};color:${MUTED};">${esc(t('Le bouton ne fonctionne pas ? Copiez ce lien dans votre navigateur :', 'Button not working? Paste this link into your browser:'))}</p>
          <p style="margin:0;font:400 13px/1.5 ${TEXT_FONT};word-break:break-all;"><a href="${esc(input.cta.url)}" style="color:${BLUE};text-decoration:underline;">${esc(input.cta.url)}</a></p>
          ${input.note ? `<p style="margin:18px 0 0;padding:14px 16px;border-radius:14px;background:#F7F9FC;font:400 13px/1.6 ${TEXT_FONT};color:${INK};">${rich(input.note)}</p>` : ''}
        </td></tr>
      </table>

    </td></tr>
  </table>

  <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="width:100%;max-width:560px;">
    <tr><td align="center" style="padding:28px 24px 0;">
      <img src="${esc(base)}/email/pingsell-mark.png" width="28" height="28" alt="" style="display:block;width:28px;height:28px;border:0;margin:0 auto 12px;">
      <p style="margin:0 0 6px;font:700 11px/1.4 ${FONT};letter-spacing:0.18em;text-transform:uppercase;color:${NAVY};">${esc(t('Chaque notif, une vente.', 'Every ping, a sale.'))}</p>
      <p style="margin:0;font:400 12px/1.6 ${TEXT_FONT};color:${MUTED};">${esc(input.reason)}<br>© ${year} Pingsell</p>
    </td></tr>
  </table>

</td></tr>
</table>
</body>
</html>`;

  const text = [
    input.title.join(' '),
    '',
    ...input.paragraphs.map((p) => p.replace(/\*\*(.+?)\*\*/g, '$1')),
    '',
    `${input.cta.label} : ${input.cta.url}`,
    ...(input.facts?.length ? ['', input.facts.join(' · ')] : []),
    ...(input.note ? ['', input.note.replace(/\*\*(.+?)\*\*/g, '$1')] : []),
    '',
    '—',
    `Pingsell · ${input.reason}`,
  ].join('\n');

  return { html, text };
}
