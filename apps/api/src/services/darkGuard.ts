/**
 * Keeps dark-designed emails dark in the Gmail apps' dark mode.
 *
 * Gmail on iPhone inverts every colour of an email in dark mode, even one that is already dark and says so
 * (`color-scheme: dark`): the dark background turns cream and the light text turns dark. Background images
 * and gradients are left alone, so a dark card drawn with a gradient ends up with dark text on a dark card.
 *
 * Two well-known counter-measures, applied at send time to emails whose background is dark:
 *  - solid dark backgrounds get the same colour as a one-colour gradient, which Gmail does not invert;
 *  - text lighter than its background is wrapped in two spans with a black background blended with
 *    `screen` / `difference`, which brings Gmail's inverted colour back to the original. The CSS only applies
 *    in Gmail (`u + .body`), and with no inversion the blend leaves the colours as they are.
 * Emails with a light background are returned unchanged: Gmail's inversion keeps them readable.
 */

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
const RAW = new Set(['style', 'script', 'title', 'textarea', 'xml']);
const MEDIA = new Set(['img', 'svg', 'table', 'video', 'picture', 'iframe', 'object', 'v:roundrect', 'v:rect', 'v:image']);
const INLINE = new Set(['a', 'span', 'strong', 'b', 'em', 'i', 'u', 'small', 'sup', 'sub', 'font', 'label', 's', 'del', 'ins', 'mark', 'code']);
const BLOCK = new Set(['div', 'td', 'th', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'center', 'blockquote']);

type Rgb = [number, number, number];

interface Node {
  tag: string;
  attrs: string;
  start: number;
  openEnd: number;
  /** Index where the element's content ends (its closing tag, or where it was implicitly closed). */
  close: number;
  parent: Node | null;
  children: Node[];
  text: boolean;
  media: boolean;
}

const NAMED: Record<string, Rgb> = { white: [255, 255, 255], black: [0, 0, 0] };

export function parseColor(raw: string): Rgb | null {
  const v = raw.trim().toLowerCase();
  if (NAMED[v]) return NAMED[v];
  let m = /^#([0-9a-f]{3})$/.exec(v);
  if (m) return m[1].split('').map((c) => parseInt(c + c, 16)) as Rgb;
  m = /^#([0-9a-f]{6})(?:[0-9a-f]{2})?$/.exec(v);
  if (m) return [0, 2, 4].map((i) => parseInt(m![1].slice(i, i + 2), 16)) as Rgb;
  m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/.exec(v);
  if (m) {
    let a = m[4] == null ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
    if (!Number.isFinite(a)) a = 1;
    // Seen over a dark background: a translucent colour reads darker.
    return [m[1], m[2], m[3]].map((x) => Math.round(parseFloat(x) * a)) as Rgb;
  }
  return null;
}

export function luminance([r, g, b]: Rgb): number {
  const ch = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
}

const isDark = (c: Rgb) => luminance(c) < 0.2;

function attr(attrs: string, name: string): string | null {
  const m = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(attrs);
  return m ? (m[1] ?? m[2] ?? m[3]) : null;
}

/** Value of a CSS property in an inline style ("background" is read for its colour). */
function styleProp(style: string, prop: string): string | null {
  const m = new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`, 'i').exec(style);
  return m ? m[1].replace(/!important/i, '').trim() : null;
}

function colorIn(value: string | null): Rgb | null {
  if (!value) return null;
  const m = /#[0-9a-f]{3,8}\b|rgba?\([^)]*\)|\b(?:white|black)\b/i.exec(value);
  return m ? parseColor(m[0]) : null;
}

function nodeBackground(n: Node): { color: Rgb | null; image: boolean } {
  const style = attr(n.attrs, 'style') ?? '';
  const bg = styleProp(style, 'background');
  const image = /url\(|gradient\(/i.test(bg ?? '') || !!styleProp(style, 'background-image');
  const color = colorIn(styleProp(style, 'background-color')) ?? colorIn(bg) ?? colorIn(attr(n.attrs, 'bgcolor'));
  return { color, image };
}

function nodeColor(n: Node): Rgb | null {
  const style = attr(n.attrs, 'style') ?? '';
  return colorIn(styleProp(style, 'color')) ?? (n.tag === 'font' ? colorIn(attr(n.attrs, 'color')) : null);
}

const TOKEN = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<![^>]*>|<\/?([a-zA-Z][\w:-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;

export function parseTree(html: string): Node {
  const root: Node = { tag: '#root', attrs: '', start: 0, openEnd: 0, close: html.length, parent: null, children: [], text: false, media: false };
  const stack: Node[] = [root];
  let last = 0;
  const markText = (from: number, to: number) => {
    if (to > from && /[^\s]/.test(html.slice(from, to).replace(/&nbsp;|&#160;|&zwnj;|&#847;/gi, ' '))) stack[stack.length - 1].text = true;
  };
  TOKEN.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TOKEN.exec(html))) {
    markText(last, m.index);
    last = TOKEN.lastIndex;
    if (!m[1]) continue; // comment, doctype, CDATA
    const tag = m[1].toLowerCase();
    const closing = m[0][1] === '/';
    if (closing) {
      let i = stack.length - 1;
      while (i > 0 && stack[i].tag !== tag) i--;
      if (i === 0) continue; // stray closing tag
      while (stack.length > i) stack.pop()!.close = m.index;
      continue;
    }
    const parent = stack[stack.length - 1];
    const node: Node = { tag, attrs: m[2], start: m.index, openEnd: TOKEN.lastIndex, close: TOKEN.lastIndex, parent, children: [], text: false, media: MEDIA.has(tag) };
    parent.children.push(node);
    if (VOID.has(tag) || /\/\s*$/.test(m[2])) continue;
    if (RAW.has(tag)) {
      const end = html.toLowerCase().indexOf(`</${tag}`, TOKEN.lastIndex);
      node.close = end === -1 ? html.length : end;
      TOKEN.lastIndex = node.close;
      last = node.close;
      continue;
    }
    stack.push(node);
  }
  markText(last, html.length);
  while (stack.length > 1) stack.pop()!.close = html.length;
  const settle = (n: Node): void => {
    for (const c of n.children) {
      settle(c);
      if (c.media) n.media = true;
    }
  };
  settle(root);
  return root;
}

const hasText = (n: Node): boolean => n.text || n.children.some((c) => !RAW.has(c.tag) && hasText(c));

/** The email's own background: the body's, or the `body { background }` rule of its stylesheet. */
function pageBackground(html: string, root: Node): Rgb | null {
  const find = (n: Node): Node | null => (n.tag === 'body' ? n : n.children.reduce<Node | null>((f, c) => f ?? find(c), null));
  const body = find(root);
  const fromBody = body ? nodeBackground(body).color : null;
  if (fromBody) return fromBody;
  const rule = /(?:^|[},\s])body\b[^{]*\{([^}]*)\}/i.exec(html.match(/<style[^>]*>([\s\S]*?)<\/style>/gi)?.join('\n') ?? '');
  return rule ? (colorIn(styleProp(rule[1], 'background-color')) ?? colorIn(styleProp(rule[1], 'background'))) : null;
}

export const DARK_GUARD_CSS =
  '<style>u + .body .gd-s{background:#000 !important;mix-blend-mode:screen !important;}u + .body .gd-d{background:#000 !important;mix-blend-mode:difference !important;}</style>';

/** Is this email designed on a dark background? */
export function isDarkEmail(html: string): boolean {
  const page = pageBackground(html, parseTree(html));
  return page ? isDark(page) : false;
}

/** Applies the Gmail dark-mode counter-measures to a dark email; any other email is returned as is. */
export function guardDarkEmail(html: string): string {
  const root = parseTree(html);
  const page = pageBackground(html, root);
  if (!page || !isDark(page)) return html;

  const edits: Array<{ at: number; text: string; order: number }> = [];
  const insert = (at: number, text: string, order: number) => edits.push({ at, text, order });
  let wraps = 0;

  const walk = (n: Node, bg: Rgb, color: Rgb | null, inWrap: boolean): void => {
    let nextBg = bg;
    let nextColor = color;
    if (n.tag !== '#root') {
      const { color: own, image } = nodeBackground(n);
      if (own) {
        nextBg = own;
        // Solid dark background → the same colour as an image, which Gmail does not invert.
        if (isDark(own) && !image && n.tag !== 'body' && n.tag !== 'html') {
          const hex = `#${own.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
          const style = attr(n.attrs, 'style');
          const tagEnd = n.openEnd - (n.attrs.trimEnd().endsWith('/') ? 2 : 1);
          if (style != null) {
            const m = /\sstyle\s*=\s*(["'])/i.exec(n.attrs)!;
            const at = n.start + 1 + n.tag.length + m.index + m[0].length + style.length;
            insert(at, `${style.trim() && !style.trim().endsWith(';') ? ';' : ''}background-image:linear-gradient(${hex},${hex});`, 0);
          } else {
            insert(tagEnd, ` style="background-image:linear-gradient(${hex},${hex});"`, 0);
          }
        }
      }
      nextColor = nodeColor(n) ?? color;
    }

    // Text lighter than what it sits on, with no image or table inside: protect its colour.
    if (!inWrap && n.tag !== '#root' && nextColor && isDark(nextBg) && luminance(nextColor) > luminance(nextBg) + 0.03 && !n.media && (BLOCK.has(n.tag) || INLINE.has(n.tag)) && hasText(n)) {
      const block = BLOCK.has(n.tag) ? ' style="display:block;"' : '';
      insert(n.openEnd, `<span class="gd-s"${block}><span class="gd-d"${block}>`, 1);
      insert(n.close, '</span></span>', -1);
      wraps++;
      inWrap = true;
    }
    for (const c of n.children) if (!RAW.has(c.tag)) walk(c, nextBg, nextColor, inWrap);
  };
  walk(root, page, null, false);

  // The page background itself, on a wrapper Gmail keeps (it drops the body's styles).
  const hex = `#${page.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
  const bodyOpen = /<body\b[^>]*>/i.exec(html);
  const bodyClose = html.search(/<\/body>/i);
  if (bodyOpen) {
    insert(bodyOpen.index + bodyOpen[0].length, `<div style="background-color:${hex};background-image:linear-gradient(${hex},${hex});">`, 2);
    insert(bodyClose === -1 ? html.length : bodyClose, '</div>', -2);
  }

  // Apply from the end so earlier positions stay valid. At one position: closings before openings.
  edits.sort((a, b) => b.at - a.at || b.order - a.order);
  let out = html;
  for (const e of edits) out = out.slice(0, e.at) + e.text + out.slice(e.at);

  if (wraps > 0) {
    // Gmail puts a <u> before the body wrapper, which only gets the "body" class if the body has it.
    out = out.replace(/<body\b([^>]*)>/i, (_m, a: string) => {
      const cls = /\sclass\s*=\s*(["'])(.*?)\1/i.exec(a);
      if (cls && /(^|\s)body(\s|$)/.test(cls[2])) return `<body${a}>`;
      return cls ? `<body${a.replace(cls[0], ` class=${cls[1]}${cls[2]} body${cls[1]}`)}>` : `<body${a} class="body">`;
    });
    const head = out.search(/<\/head>/i);
    out = head === -1 ? DARK_GUARD_CSS + out : out.slice(0, head) + DARK_GUARD_CSS + out.slice(head);
  }
  return out;
}
