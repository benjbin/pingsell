/**
 * Email rendering: merge tags, unsubscribe footer, click-tracking link rewriting
 * and the open pixel. Pure functions — no database access.
 */

import { currentLang, t } from '../i18n.js';

export interface MergeContact {
  email: string;
  first_name?: string | null;
  last_name?: string | null;
}

export interface RenderInput {
  messageId: string;
  publicUrl: string;
  subject: string;
  html: string;
  preheader?: string | null;
  contact: MergeContact;
  senderName: string;
  /** Disable tracking (pixel + link rewriting), e.g. for previews. */
  tracking?: boolean;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
  unsubscribeUrl: string;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const MERGE_TAG_RE = /( ?)\{\{\s*([a-z_]+)\s*(?:\|\s*([^}]*?)\s*)?\}\}/gi;

/**
 * Replaces `{{first_name}}`, `{{last_name}}`, `{{email}}`, `{{unsubscribe_url}}`.
 * Supports a fallback: `{{first_name|cher client}}`. Unknown tags are left untouched.
 */
export function applyMergeTags(
  template: string,
  contact: MergeContact,
  unsubscribeUrl: string,
  mode: 'html' | 'text',
): string {
  return template.replace(MERGE_TAG_RE, (match, space: string, rawName: string, fallback: string | undefined) => {
    const name = rawName.toLowerCase();
    let value: string | null | undefined;
    switch (name) {
      case 'first_name':
        value = contact.first_name;
        break;
      case 'last_name':
        value = contact.last_name;
        break;
      case 'email':
        value = contact.email;
        break;
      case 'unsubscribe_url':
        return space + unsubscribeUrl;
      case 'countdown_days':
      case 'countdown_hours':
      case 'countdown_minutes':
      case 'countdown_seconds':
        // Countdown block: the fallback holds the target date, computed when the email is sent.
        return space + countdownPart(name.slice(10) as CountdownUnit, fallback ?? '', Date.now());
      default:
        return match;
    }
    const resolved = value && value.trim() ? value.trim() : (fallback ?? '');
    // An empty value also swallows the space before it: "Bonjour {{first_name|}}," → "Bonjour,".
    if (!resolved) return '';
    return space + (mode === 'html' ? escapeHtml(resolved) : resolved);
  });
}

type CountdownUnit = 'days' | 'hours' | 'minutes' | 'seconds';

export function countdownPart(unit: CountdownUnit, iso: string, now: number): string {
  const end = Date.parse(iso);
  let left = Number.isFinite(end) ? Math.max(0, Math.floor((end - now) / 1000)) : 0;
  const days = Math.floor(left / 86400);
  left -= days * 86400;
  const hours = Math.floor(left / 3600);
  left -= hours * 3600;
  const minutes = Math.floor(left / 60);
  const parts = { days, hours, minutes, seconds: left - minutes * 60 };
  return String(parts[unit]).padStart(2, '0');
}

export function hasUnsubscribeTag(html: string): boolean {
  return /\{\{\s*unsubscribe_url\s*\}\}/i.test(html);
}

export function unsubscribeFooter(senderName: string): string {
  return `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">
  <tr>
    <td align="center" style="padding:24px 16px 32px;font-family:Inter,Segoe UI,Helvetica,Arial,sans-serif;font-size:12px;line-height:18px;color:#64748b;">
      ${t(
        `Vous recevez cet email car vous êtes inscrit(e) à la liste de ${escapeHtml(senderName)}.`,
        `You’re receiving this email because you subscribed to ${escapeHtml(senderName)}’s list.`,
      )}<br />
      <a href="{{unsubscribe_url}}" style="color:#0E0E0C;text-decoration:underline;">${t('Se désinscrire', 'Unsubscribe')}</a>
    </td>
  </tr>
</table>`;
}

/** Wraps an HTML fragment in a minimal document if it is not already a full document. */
export function ensureDocument(html: string): string {
  if (/<html[\s>]/i.test(html)) return html;
  return `<!DOCTYPE html>
<html lang="${currentLang()}">
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /></head>
<body style="margin:0;padding:0;background-color:#f8fafc;">
${html}
</body>
</html>`;
}

function insertBeforeBodyEnd(html: string, snippet: string): string {
  const idx = html.search(/<\/body>/i);
  return idx === -1 ? html + snippet : html.slice(0, idx) + snippet + html.slice(idx);
}

function insertAfterBodyStart(html: string, snippet: string): string {
  const match = /<body[^>]*>/i.exec(html);
  if (!match) return snippet + html;
  const end = match.index + match[0].length;
  return html.slice(0, end) + snippet + html.slice(end);
}

export function trackedClickUrl(publicUrl: string, messageId: string, url: string): string {
  return `${publicUrl}/t/c/${messageId}?u=${encodeURIComponent(url)}`;
}

/** Rewrites absolute http(s) links for click tracking, except the unsubscribe/tracking links themselves. */
export function rewriteLinks(html: string, publicUrl: string, messageId: string): string {
  return html.replace(/(<a\b[^>]*?\shref\s*=\s*)(["'])(.*?)\2/gi, (match, prefix: string, quote: string, href: string) => {
    const url = decodeEntities(href.trim());
    if (!/^https?:\/\//i.test(url)) return match;
    if (url.startsWith(`${publicUrl}/u/`) || url.startsWith(`${publicUrl}/t/`)) return match;
    return `${prefix}${quote}${escapeHtml(trackedClickUrl(publicUrl, messageId, url))}${quote}`;
  });
}

function decodeEntities(value: string): string {
  return value.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

export function htmlToText(html: string): string {
  return html
    .replace(/<(style|script|head)[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, '$2 ($1)')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|h[1-6]|li|table)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n\s*\n+/g, '\n\n')
    .trim();
}

/** Full rendering pipeline for one recipient. */
export function renderEmail(input: RenderInput): RenderedEmail {
  const { messageId, publicUrl, contact } = input;
  const tracking = input.tracking ?? true;
  const unsubscribeUrl = `${publicUrl}/u/${messageId}`;

  let html = ensureDocument(input.html || '');
  if (!hasUnsubscribeTag(html)) html = insertBeforeBodyEnd(html, unsubscribeFooter(input.senderName));
  if (input.preheader) {
    const pre = escapeHtml(applyMergeTags(input.preheader, contact, unsubscribeUrl, 'text'));
    html = insertAfterBodyStart(
      html,
      `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:transparent;opacity:0;">${pre}&#8199;&#65279;&#847;&#8199;&#65279;&#847;</div>`,
    );
  }
  html = applyMergeTags(html, contact, unsubscribeUrl, 'html');
  if (tracking) {
    html = rewriteLinks(html, publicUrl, messageId);
    html = insertBeforeBodyEnd(
      html,
      `<img src="${publicUrl}/t/o/${messageId}.gif" width="1" height="1" alt="" style="display:block;border:0;outline:none;width:1px;height:1px;" />`,
    );
  }

  const subject = tidySubject(applyMergeTags(input.subject, contact, unsubscribeUrl, 'text'));
  return { subject, html, text: htmlToText(html), unsubscribeUrl };
}

/** Cleans a subject after merge: collapses spaces, drops punctuation left dangling by an empty tag. */
export function tidySubject(subject: string): string {
  const s = subject.replace(/\s+/g, ' ').replace(/^[\s,;:]+/, '').trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}
