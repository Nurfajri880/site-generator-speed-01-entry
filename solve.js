// Fast drop-in for makefun-site 1.0.0 (site-generator-speed-01).
// Written from scratch in this session from the README and the reference
// code's observable behaviour. Same answers, byte for byte; much less work:
// a single-pass Markdown renderer (no per-line regexes), templates compiled
// to plain JS functions, slug/date caches, and no token objects.

const byCodeUnits = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

// ---------------------------------------------------------------- text

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const ESC_RE = /[&<>"']/g;

/** `text` with & < > " and ' escaped. Single pass, no per-match callback. */
export function escapeHtml(text) {
  let m;
  let out = '';
  let last = 0;
  ESC_RE.lastIndex = 0;
  while ((m = ESC_RE.exec(text)) !== null) {
    out += text.slice(last, m.index) + ESCAPES[m[0]];
    last = m.index + 1;
  }
  return last === 0 ? text : out + text.slice(last);
}

const SLUG_MAX = 64;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** A YYYY-MM-DD date in words, from the string alone. */
export function longDate(date) {
  const y = date.slice(0, 4);
  const m = Number(date.slice(5, 7));
  const d = Number(date.slice(8, 10));
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

/**
 * The slug of `text`: NFKD, combining marks dropped, A-Z lowered, every run
 * of characters other than a-z and 0-9 one "-", none at either end, at most
 * 64 characters (a "-" left at the cut dropped), "untitled" when nothing is
 * left. Pure-ASCII input takes a fast path (no normalize, no regex).
 */
export function slugify(text, cache) {
  if (cache !== undefined) {
    const hit = cache.get(text);
    if (hit !== undefined) return hit;
  }
  let out;
  let ascii = true;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) > 127) { ascii = false; break; }
  }
  if (ascii) {
    let s = '';
    let gap = false;
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i);
      let keep = 0;
      if (c >= 65 && c <= 90) keep = c + 32;
      else if ((c >= 97 && c <= 122) || (c >= 48 && c <= 57)) keep = c;
      if (keep === 0) {
        gap = s.length > 0;
        continue;
      }
      if (gap) s += '-';
      gap = false;
      s += String.fromCharCode(keep);
    }
    out = s.slice(0, SLUG_MAX).replace(/-+$/, '');
    if (out === '') out = 'untitled';
  } else {
    const plain = text.normalize('NFKD').replace(/\p{M}/gu, '');
    let s = '';
    let gap = false;
    for (const ch of plain) {
      let keep = null;
      if (ch >= 'A' && ch <= 'Z') keep = ch.toLowerCase();
      else if ((ch >= 'a' && ch <= 'z') || (ch >= '0' && ch <= '9')) keep = ch;
      if (keep === null) {
        gap = s.length > 0;
        continue;
      }
      if (gap) s += '-';
      gap = false;
      s += keep;
    }
    out = s.slice(0, SLUG_MAX).replace(/-+$/, '');
    if (out === '') out = 'untitled';
  }
  if (cache !== undefined) cache.set(text, out);
  return out;
}

/** `slug` made unique against `taken` (and added to it). */
export function uniqueSlug(slug, taken) {
  let out = slug;
  for (let n = 2; taken.has(out); n++) out = `${slug}-${n}`;
  taken.add(out);
  return out;
}

// ---------------------------------------------------------------- front matter

const KEYS = ['title', 'date', 'tags', 'draft', 'layout', 'slug', 'summary'];
const LINE = /^([a-z_]+):(?: (.*))?$/;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const NAME_RE = /^[a-z0-9-]+$/;
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const TAG_RE = /^[^"[\]]+$/;

function daysIn(y, m) {
  if (m === 2) return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28;
  return m === 4 || m === 6 || m === 9 || m === 11 ? 30 : 31;
}

function stringOf(raw) {
  if (raw.charCodeAt(0) === 34) {
    if (raw.length < 2 || raw.charCodeAt(raw.length - 1) !== 34) return { error: 'a quoted string is not closed' };
    let out = '';
    for (let i = 1; i < raw.length - 1; i++) {
      const c = raw[i];
      if (c === '\\') {
        const n = raw[i + 1];
        if ((n !== '"' && n !== '\\') || i + 1 === raw.length - 1) return { error: 'a quoted string holds an escape other than \\" or \\\\' };
        out += n;
        i++;
      } else if (c === '"') return { error: 'a quoted string holds a stray quote' };
      else out += c;
    }
    return { value: out };
  }
  if (raw.charCodeAt(0) === 91) return { error: 'a bare string opens on [' };
  return { value: raw };
}

function valueOf(key, raw) {
  switch (key) {
    case 'title':
    case 'summary': {
      const s = stringOf(raw);
      return 'error' in s ? { error: `key "${key}": ${s.error}` } : s;
    }
    case 'date': {
      const m = DATE_RE.exec(raw);
      const y = m ? Number(m[1]) : 0;
      const mo = m ? Number(m[2]) : 0;
      const d = m ? Number(m[3]) : 0;
      if (!m || y < 1970 || y > 2099 || mo < 1 || mo > 12 || d < 1 || d > daysIn(y, mo)) return { error: 'key "date": not a date from 1970-01-01 to 2099-12-31 (YYYY-MM-DD)' };
      return { value: raw };
    }
    case 'tags': {
      if (!raw.startsWith('[') || !raw.endsWith(']')) return { error: 'key "tags": not a list [a, b]' };
      const inner = raw.slice(1, -1);
      if (inner.trim() === '') return { value: [] };
      const tags = inner.split(',').map((t) => t.trim());
      if (tags.some((t) => t === '' || !TAG_RE.test(t))) return { error: 'key "tags": an empty tag, or one holding " [ or ]' };
      return { value: tags };
    }
    case 'draft':
      return raw === 'true' ? { value: true } : raw === 'false' ? { value: false } : { error: 'key "draft": true or false' };
    case 'layout':
      return NAME_RE.test(raw) ? { value: raw } : { error: 'key "layout": not a template name' };
    case 'slug':
      return SLUG_RE.test(raw) && raw.length <= 64 ? { value: raw } : { error: 'key "slug": not a slug' };
    default:
      return { error: `unknown key "${key}"` };
  }
}

function isBlankLine(line) {
  for (let i = 0; i < line.length; i++) {
    const c = line.charCodeAt(i);
    if (c !== 32 && c !== 9) return false;
  }
  return true;
}

/**
 * A source's front matter and body lines: { data, bodyLines }, or { error }.
 * `lines` is the source's text split on "\n" (line ends already "\n").
 */
function parseFrontMatter(lines) {
  if (lines[0] !== '---') return { error: 'no front matter' };
  let close = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === '---') { close = i; break; }
  }
  if (close === -1) return { error: 'the front matter is not closed' };
  const data = {};
  for (let i = 1; i < close; i++) {
    const line = lines[i];
    if (isBlankLine(line) || line.charCodeAt(0) === 35) continue;
    const m = LINE.exec(line);
    if (!m) return { error: `line ${i + 1} is not "key: value"` };
    const key = m[1];
    const raw = (m[2] ?? '').replace(/[ \t]+$/, '');
    if (KEYS.indexOf(key) === -1) return { error: `unknown key "${key}"` };
    if (Object.hasOwn(data, key)) return { error: `key "${key}" is given twice` };
    if (raw === '') return { error: `key "${key}" has no value` };
    const v = valueOf(key, raw);
    if ('error' in v) return v;
    data[key] = v.value;
  }
  if (!Object.hasOwn(data, 'title')) return { error: 'no title' };
  return { data, bodyLines: lines.slice(close + 1) };
}

// ---------------------------------------------------------------- markdown

function trimLine(line) {
  let a = 0;
  let b = line.length;
  while (a < b && (line.charCodeAt(a) === 32 || line.charCodeAt(a) === 9)) a++;
  while (b > a && (line.charCodeAt(b - 1) === 32 || line.charCodeAt(b - 1) === 9)) b--;
  return a === 0 && b === line.length ? line : line.slice(a, b);
}

/** Whether char code `c` is whitespace in JavaScript's \s sense (BMP only; \s has no astral members). */
function isWs(c) {
  if (c === 32 || (c >= 9 && c <= 13)) return true;
  if (c < 128) return false;
  return c === 0xA0 || c === 0x1680 || (c >= 0x2000 && c <= 0x200A) || c === 0x2028 || c === 0x2029 || c === 0x202F || c === 0x205F || c === 0x3000 || c === 0xFEFF;
}

/** The words of `line`: its runs of characters other than whitespace. */
function countWords(line) {
  let n = 0;
  let inW = false;
  for (let i = 0; i < line.length; i++) {
    const c = line.charCodeAt(i);
    // Whitespace in JavaScript's \s sense (BMP only; \s has no astral members).
    const ws = c === 32 || (c >= 9 && c <= 13) || (c >= 128 && (c === 0xA0 || c === 0x1680 || (c >= 0x2000 && c <= 0x200A) || c === 0x2028 || c === 0x2029 || c === 0x202F || c === 0x205F || c === 0x3000 || c === 0xFEFF));
    if (ws) inW = false;
    else if (!inW) {
      inW = true;
      n++;
    }
  }
  return n;
}

// One line's kind, for the Markdown pass.
const K_BLANK = 0;
const K_FENCE = 1;
const K_HEAD = 2;
const K_HR = 3;
const K_QUOTE = 4;
const K_BULLET = 5;
const K_ORDERED = 6;
const K_CONT = 7;
const K_OTHER = 8;

/**
 * Every line's kind in one pass, plus the body's word count. kinds[i] is a
 * K_* code; nums[i] a heading's depth or an ordered list's start number;
 * langs[i] a fence's language ("" when it has none). Heading and item text
 * are sliced lazily, when the block is rendered.
 */
function classifyAll(lines) {
  const n = lines.length;
  const kinds = new Uint8Array(n);
  const nums = new Int32Array(n);
  const langs = new Array(n);
  let words = 0;
  for (let i = 0; i < n; i++) {
    const line = lines[i];
    words += countWords(line);
    const len = line.length;
    if (len === 0) {
      kinds[i] = K_BLANK;
      continue;
    }
    const c0 = line.charCodeAt(0);
    if (c0 === 32 || c0 === 9) {
      let j = 0;
      while (j < len && (line.charCodeAt(j) === 32 || line.charCodeAt(j) === 9)) j++;
      if (j === len) {
        kinds[i] = K_BLANK;
        continue;
      }
      // Continued: two or more spaces, then a non-space.
      let sp = 0;
      while (sp < len && line.charCodeAt(sp) === 32) sp++;
      kinds[i] = sp >= 2 && !isWs(line.charCodeAt(sp)) ? K_CONT : K_OTHER;
      continue;
    }
    if (c0 === 35) {
      let k = 0;
      while (k < len && line.charCodeAt(k) === 35) k++;
      if (k >= 1 && k <= 6 && k < len && (line.charCodeAt(k) === 32 || line.charCodeAt(k) === 9)) {
        let j = k;
        while (j < len && (line.charCodeAt(j) === 32 || line.charCodeAt(j) === 9)) j++;
        let end = len;
        while (end > j && (line.charCodeAt(end - 1) === 32 || line.charCodeAt(end - 1) === 9)) end--;
        if (end > j) {
          kinds[i] = K_HEAD;
          nums[i] = k;
          continue;
        }
      }
      kinds[i] = K_OTHER;
      continue;
    }
    if (c0 === 96) {
      if (line.charCodeAt(1) === 96 && line.charCodeAt(2) === 96) {
        let j = 3;
        while (j < len) {
          const c = line.charCodeAt(j);
          if ((c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 95 || c === 43 || c === 45) j++;
          else break;
        }
        const lang = line.slice(3, j);
        while (j < len && (line.charCodeAt(j) === 32 || line.charCodeAt(j) === 9)) j++;
        if (j === len) {
          kinds[i] = K_FENCE;
          langs[i] = lang;
          continue;
        }
      }
      kinds[i] = K_OTHER;
      continue;
    }
    if (c0 === 45 || c0 === 42) {
      if (line.charCodeAt(1) === 32) {
        kinds[i] = K_BULLET;
        continue;
      }
      if (line.charCodeAt(1) === c0 && line.charCodeAt(2) === c0) {
        let j = 3;
        while (j < len && (line.charCodeAt(j) === 32 || line.charCodeAt(j) === 9)) j++;
        if (j === len) {
          kinds[i] = K_HR;
          continue;
        }
      }
      kinds[i] = K_OTHER;
      continue;
    }
    if (c0 === 62) {
      kinds[i] = K_QUOTE;
      continue;
    }
    if (c0 >= 48 && c0 <= 57) {
      let j = 0;
      while (j < len && line.charCodeAt(j) >= 48 && line.charCodeAt(j) <= 57) j++;
      if (j >= 1 && j <= 9 && line.charCodeAt(j) === 46 && line.charCodeAt(j + 1) === 32) {
        kinds[i] = K_ORDERED;
        nums[i] = Number(line.slice(0, j));
        continue;
      }
      kinds[i] = K_OTHER;
      continue;
    }
    kinds[i] = K_OTHER;
  }
  return { kinds, nums, langs, words };
}

/** The characters a backslash escapes. */
const ESCAPABLE = new Set(['\\', '`', '*', '_', '[', ']', '(', ')', '#', '+', '-', '.', '!', '>']);

/** The first index from `from` where `s` holds `what` outside a backslash escape, or -1. */
function findUnescaped(s, what, from) {
  for (let j = from; j <= s.length - what.length; j++) {
    if (s[j] === '\\' && j + 1 < s.length && ESCAPABLE.has(s[j + 1])) {
      j++;
      continue;
    }
    if (s.startsWith(what, j)) return j;
  }
  return -1;
}

/** The first single * from `from` (one whose run is not **), outside an escape, or -1. */
function findSingleStar(s, from) {
  for (let j = from; j < s.length; j++) {
    const c = s[j];
    if (c === '\\' && j + 1 < s.length && ESCAPABLE.has(s[j + 1])) {
      j++;
      continue;
    }
    if (c !== '*') continue;
    if (s[j + 1] === '*') {
      j++;
      continue;
    }
    return j;
  }
  return -1;
}

/** The next index at or after `from` holding backslash, backtick, `*` or `[`, or -1. */
function nextSpecial(s, from) {
  for (let j = from; j < s.length; j++) {
    const c = s.charCodeAt(j);
    if (c === 92 || c === 96 || c === 42 || c === 91) return j;
  }
  return -1;
}

const WS_RE = /\s/;

/**
 * `s` rendered inline; `env.link(target)` is a link's href. Plain runs
 * between the marks are escaped whole, so a sentence with one mark costs
 * one slice and one escape instead of one push per character.
 */
function inline(s, env) {
  let i = nextSpecial(s, 0);
  if (i === -1) return escapeHtml(s);
  const out = [];
  let start = 0;
  while (i !== -1) {
    const c = s.charCodeAt(i);
    if (c === 92) {
      if (i + 1 < s.length && ESCAPABLE.has(s[i + 1])) {
        if (i > start) out.push(escapeHtml(s.slice(start, i)));
        out.push(escapeHtml(s[i + 1]));
        i += 2;
        start = i;
        i = nextSpecial(s, i);
        continue;
      }
      // A backslash before anything else is itself: it stays in the run.
      i = nextSpecial(s, i + 1);
      continue;
    }
    if (c === 96) {
      const j = s.indexOf('`', i + 1);
      if (j > i + 1) {
        if (i > start) out.push(escapeHtml(s.slice(start, i)));
        out.push('<code>', escapeHtml(s.slice(i + 1, j)), '</code>');
        i = j + 1;
        start = i;
        i = nextSpecial(s, i);
      } else {
        i = nextSpecial(s, i + 1);
      }
      continue;
    }
    if (c === 42) {
      if (s.charCodeAt(i + 1) === 42) {
        const j = findUnescaped(s, '**', i + 2);
        if (j > i + 2) {
          if (i > start) out.push(escapeHtml(s.slice(start, i)));
          out.push('<strong>', inline(s.slice(i + 2, j), env), '</strong>');
          i = j + 2;
          start = i;
          i = nextSpecial(s, i);
        } else {
          i = nextSpecial(s, i + 2);
        }
        continue;
      }
      const j = findSingleStar(s, i + 1);
      if (j > i + 1) {
        if (i > start) out.push(escapeHtml(s.slice(start, i)));
        out.push('<em>', inline(s.slice(i + 1, j), env), '</em>');
        i = j + 1;
        start = i;
        i = nextSpecial(s, i);
      } else {
        i = nextSpecial(s, i + 1);
      }
      continue;
    }
    // '[': a link, or itself when the target does not read.
    const k = findUnescaped(s, ']', i + 1);
    const m = k !== -1 && s[k + 1] === '(' ? s.indexOf(')', k + 2) : -1;
    const target = m === -1 ? '' : s.slice(k + 2, m);
    if (target !== '' && !WS_RE.test(target)) {
      if (i > start) out.push(escapeHtml(s.slice(start, i)));
      out.push('<a href="', escapeHtml(env.link(target)), '">', inline(s.slice(i + 1, k), env), '</a>');
      i = m + 1;
      start = i;
      i = nextSpecial(s, i);
      continue;
    }
    i = nextSpecial(s, i + 1);
  }
  if (start < s.length) out.push(escapeHtml(s.slice(start)));
  return out.join('');
}

/**
 * A body's lines rendered: its HTML, table of contents, excerpt and word
 * count. Single pass over the preclassified lines, no token objects.
 */
function renderMarkdown(lines, env, slugCache) {
  const { kinds, nums, langs, words } = classifyAll(lines);
  const ids = new Set();
  const blocks = [];
  const toc = [];
  let excerpt = null;
  let i = 0;
  const n = lines.length;
  while (i < n) {
    const kind = kinds[i];
    const line = lines[i];
    if (kind === K_BLANK) {
      i++;
      continue;
    }
    if (kind === K_FENCE) {
      const lang = langs[i];
      const body = [];
      i++;
      while (i < n && !(kinds[i] === K_FENCE && langs[i] === '')) body.push(lines[i++]);
      i++;
      let inner = '';
      for (const l of body) inner += escapeHtml(l) + '\n';
      blocks.push(`<pre><code${lang === '' ? '' : ` class="language-${escapeHtml(lang)}"`}>${inner}</code></pre>`);
      continue;
    }
    if (kind === K_HEAD) {
      const depth = nums[i];
      let j = depth;
      while (line.charCodeAt(j) === 32 || line.charCodeAt(j) === 9) j++;
      let end = line.length;
      while (line.charCodeAt(end - 1) === 32 || line.charCodeAt(end - 1) === 9) end--;
      const text = line.slice(j, end);
      const id = uniqueSlug(slugify(text, slugCache), ids);
      const html = inline(text, env);
      blocks.push(`<h${depth} id="${id}">${html}</h${depth}>`);
      if (depth === 2 || depth === 3) toc.push({ level: depth, id, html });
      i++;
      continue;
    }
    if (kind === K_HR) {
      blocks.push('<hr>');
      i++;
      continue;
    }
    if (kind === K_QUOTE) {
      const body = [];
      while (i < n && kinds[i] === K_QUOTE) {
        const l = lines[i++];
        body.push(trimLine(l.charCodeAt(1) === 32 ? l.slice(2) : l.slice(1)));
      }
      const kept = [];
      for (const l of body) if (l !== '') kept.push(l);
      blocks.push(kept.length === 0 ? '<blockquote>\n</blockquote>' : `<blockquote>\n<p>${inline(kept.join('\n'), env)}</p>\n</blockquote>`);
      continue;
    }
    if (kind === K_BULLET || kind === K_ORDERED) {
      const isOrdered = kind === K_ORDERED;
      const startNum = isOrdered ? nums[i] : 1;
      const items = [];
      while (i < n) {
        const k = kinds[i];
        if (isOrdered ? k === K_ORDERED : k === K_BULLET) {
          const l = lines[i++];
          items.push([trimLine(isOrdered ? l.slice(l.indexOf('. ') + 2) : l.slice(2))]);
          continue;
        }
        if (k === K_CONT) {
          items[items.length - 1].push(trimLine(lines[i++]));
          continue;
        }
        break;
      }
      const tag = isOrdered ? 'ol' : 'ul';
      const open = isOrdered && startNum !== 1 ? `<ol start="${startNum}">` : `<${tag}>`;
      let inner = '';
      for (const parts of items) inner += `<li>${inline(parts.join('\n'), env)}</li>\n`;
      blocks.push(`${open}\n${inner}</${tag}>`);
      continue;
    }
    const body = [trimLine(line)];
    i++;
    while (i < n && kinds[i] !== K_BLANK && kinds[i] !== K_FENCE && kinds[i] !== K_HEAD && kinds[i] !== K_HR) body.push(trimLine(lines[i++]));
    const html = inline(body.join('\n'), env);
    if (excerpt === null) excerpt = html;
    blocks.push(`<p>${html}</p>`);
  }
  return { html: blocks.length === 0 ? '' : blocks.join('\n') + '\n', toc, excerpt: excerpt ?? '', words };
}

// ---------------------------------------------------------------- templates

const INCLUDE_DEPTH = 8;
const PATH_RE = /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*$/;
const FOR_RE = /^for ([A-Za-z_][A-Za-z0-9_]*) in (\S+)$/;
const IF_RE = /^if (not )?(\S+)$/;
const INCLUDE_RE = /^include "([a-z0-9-]+)"$/;

/** A template that does not parse: its name and why. */
class TemplateError extends Error {}

/** The path `text` names, split at its dots, or a TemplateError. */
function pathOf(name, text) {
  if (!PATH_RE.test(text)) throw new TemplateError(`template "${name}": ${JSON.stringify(text)} is not a path`);
  return text.split('.');
}

/** `src`'s tokens: text, {{ }}, {{{ }}} and {% %}, a standalone tag's line taken with it. */
function tokenize(name, src) {
  const tokens = [];
  let text = '';
  let i = 0;
  while (i < src.length) {
    const open = src.indexOf('{', i);
    if (open === -1 || open === src.length - 1) {
      text += src.slice(i);
      break;
    }
    const next = src[open + 1];
    if (next !== '{' && next !== '%') {
      text += src.slice(i, open + 1);
      i = open + 1;
      continue;
    }
    text += src.slice(i, open);
    if (next === '{') {
      const raw = src[open + 2] === '{';
      const close = src.indexOf(raw ? '}}}' : '}}', open + (raw ? 3 : 2));
      if (close === -1) throw new TemplateError(`template "${name}": a ${raw ? '{{{' : '{{'} is not closed`);
      if (text !== '') tokens.push({ t: 'text', text });
      text = '';
      tokens.push({ t: raw ? 'raw' : 'var', path: pathOf(name, src.slice(open + (raw ? 3 : 2), close).trim()) });
      i = close + (raw ? 3 : 2);
      continue;
    }
    const close = src.indexOf('%}', open + 2);
    if (close === -1) throw new TemplateError(`template "${name}": a {% is not closed`);
    const end = close + 2;
    const lineStart = src.lastIndexOf('\n', open - 1) + 1;
    const nl = src.indexOf('\n', end);
    const lineEnd = nl === -1 ? src.length : nl;
    const standalone = /^[ \t]*$/.test(src.slice(lineStart, open)) && /^[ \t]*$/.test(src.slice(end, lineEnd));
    if (standalone) text = text.slice(0, text.length - (open - lineStart));
    if (text !== '') tokens.push({ t: 'text', text });
    text = '';
    tokens.push({ t: 'tag', tag: src.slice(open + 2, close).trim() });
    i = standalone ? (nl === -1 ? src.length : nl + 1) : end;
  }
  if (text !== '') tokens.push({ t: 'text', text });
  return tokens;
}

/** `src` parsed into its tree of nodes (a TemplateError when it does not parse). */
function parseTemplate(name, src) {
  const root = { kind: 'root', body: [] };
  const stack = [root];
  let body = root.body;
  for (const tok of tokenize(name, src)) {
    if (tok.t === 'text') body.push({ kind: 'text', text: tok.text });
    else if (tok.t === 'var' || tok.t === 'raw') body.push({ kind: tok.t, path: tok.path });
    else {
      const tag = tok.tag;
      const top = stack[stack.length - 1];
      let m;
      if ((m = FOR_RE.exec(tag)) !== null) {
        const node = { kind: 'for', name: m[1], path: pathOf(name, m[2]), body: [] };
        body.push(node);
        stack.push(node);
        body = node.body;
      } else if ((m = IF_RE.exec(tag)) !== null) {
        const node = { kind: 'if', not: m[1] !== undefined, path: pathOf(name, m[2]), then: [], else: null };
        body.push(node);
        stack.push(node);
        body = node.then;
      } else if (tag === 'else') {
        if (top.kind !== 'if' || top.else !== null) throw new TemplateError(`template "${name}": an else outside an if`);
        top.else = [];
        body = top.else;
      } else if (tag === 'endfor' || tag === 'endif') {
        if (top.kind !== (tag === 'endfor' ? 'for' : 'if')) throw new TemplateError(`template "${name}": an ${tag} with no open ${tag.slice(3)}`);
        stack.pop();
        const parent = stack[stack.length - 1];
        body = parent.kind === 'root' ? parent.body : parent.kind === 'for' ? parent.body : parent.else ?? parent.then;
      } else if ((m = INCLUDE_RE.exec(tag)) !== null) body.push({ kind: 'include', name: m[1] });
      else throw new TemplateError(`template "${name}": {% ${tag} %} is not a tag`);
    }
  }
  if (stack.length > 1) throw new TemplateError(`template "${name}": a ${stack[stack.length - 1].kind} is not closed`);
  return root.body;
}

/** The value at `path` in the scope chain: its first name from the nearest scope holding it, then own properties. */
function lookup(s, path) {
  let c = s;
  while (c !== null && !Object.hasOwn(c.v, path[0])) c = c.p;
  if (c === null) return undefined;
  let v = c.v[path[0]];
  for (let k = 1; k < path.length; k++) {
    if (v === null || typeof v !== 'object' || !Object.hasOwn(v, path[k])) return undefined;
    v = v[path[k]];
  }
  return v;
}

/** The value at one name in the scope chain, then one own property. */
function lk1(s, a) {
  let c = s;
  while (c !== null && !Object.hasOwn(c.v, a)) c = c.p;
  return c === null ? undefined : c.v[a];
}

/** The value at two names in the scope chain. */
function lk2(s, a, b) {
  let c = s;
  while (c !== null && !Object.hasOwn(c.v, a)) c = c.p;
  if (c === null) return undefined;
  const v = c.v[a];
  if (v === null || typeof v !== 'object' || !Object.hasOwn(v, b)) return undefined;
  return v[b];
}

/** The value at three names in the scope chain. */
function lk3(s, a, b, d) {
  let c = s;
  while (c !== null && !Object.hasOwn(c.v, a)) c = c.p;
  if (c === null) return undefined;
  let v = c.v[a];
  if (v === null || typeof v !== 'object' || !Object.hasOwn(v, b)) return undefined;
  v = v[b];
  if (v === null || typeof v !== 'object' || !Object.hasOwn(v, d)) return undefined;
  return v[d];
}

/** A value as text, HTML-escaped: the `{{ }}` of a template. */
function varText(v) {
  if (typeof v === 'string') return escapeHtml(v);
  return escapeHtml(textOf(v));
}

/** A value as text: a string itself, a number in JavaScript's digits, true or false, an array's items joined by ", ", else "". */
function textOf(v) {
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (Array.isArray(v)) return v.map(textOf).join(', ');
  return '';
}

/** Whether a value counts as true in an if: not undefined, null, false, "", 0 or an empty array. */
function truthy(v) {
  if (Array.isArray(v)) return v.length > 0;
  return v !== undefined && v !== null && v !== false && v !== '' && v !== 0;
}

/**
 * A node tree compiled to JS source. The generated function is
 * render(s, o, C, d): s the scope chain {v, p}, o the output array,
 * C the helpers {T, esc, txt, tr, lk}, d the include depth.
 */
function genNodes(nodes, ctr) {
  let code = '';
  const pathId = (path) => {
    const id = ctr.paths.length;
    ctr.paths.push(path);
    return `_q${id}`;
  };
  // A path's lookup, specialised by its length: most paths have 1-3 names.
  const lkExpr = (path) => {
    if (path.length === 1) return `__a(s,${JSON.stringify(path[0])})`;
    if (path.length === 2) return `__b(s,${JSON.stringify(path[0])},${JSON.stringify(path[1])})`;
    if (path.length === 3) return `__c(s,${JSON.stringify(path[0])},${JSON.stringify(path[1])},${JSON.stringify(path[2])})`;
    return `__l(s,${pathId(path)})`;
  };
  for (const n of nodes) {
    if (n.kind === 'text') code += `o.push(${JSON.stringify(n.text)});`;
    else if (n.kind === 'var') code += `o.push(__v(${lkExpr(n.path)}));`;
    else if (n.kind === 'raw') code += `o.push(__t(${lkExpr(n.path)}));`;
    else if (n.kind === 'if') {
      code += `if(__r(${lkExpr(n.path)})!==${n.not}){${genNodes(n.then, ctr)}`;
      if (n.else !== null) code += `}else{${genNodes(n.else, ctr)}`;
      code += '}';
    } else if (n.kind === 'for') {
      const t = ctr.n++;
      code += `const _a${t}=${lkExpr(n.path)};if(Array.isArray(_a${t})){for(let _k${t}=0;_k${t}<_a${t}.length;_k${t}++){const _s${t}=s;s={v:{${JSON.stringify(n.name)}:_a${t}[_k${t}],loop:{index:_k${t}+1,first:_k${t}===0,last:_k${t}===_a${t}.length-1,length:_a${t}.length}},p:s};${genNodes(n.body, ctr)}s=_s${t};}}`;
    } else if (n.kind === 'include') {
      const t = ctr.n++;
      code += `const _t${t}=C.T.get(${JSON.stringify(n.name)});if(_t${t}!==undefined&&d<${INCLUDE_DEPTH})_t${t}(s,o,C,d+1);`;
    }
  }
  return code;
}

/** `src` compiled to its render function. */
function compileTemplate(name, src) {
  const nodes = parseTemplate(name, src);
  const ctr = { n: 0, paths: [] };
  const body = genNodes(nodes, ctr);
  const prologue = `const __v=C.varText,__t=C.txt,__a=C.lk1,__b=C.lk2,__c=C.lk3,__l=C.lk,__r=C.tr;${ctr.paths.map((p, i) => `const _q${i}=${JSON.stringify(p)};`).join('')}`;
  return new Function('s', 'o', 'C', 'd', prologue + body); // eslint-disable-line no-new-func
}

// ---------------------------------------------------------------- the build

/** The top-level directories the generator writes itself. */
const RESERVED = Object.freeze(['posts', 'tags', 'page']);

const dirOf = (path) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '');

/** `rel` from the directory `dir` of a source, or null when it climbs out of the root. */
function resolvePath(dir, rel) {
  const parts = dir === '' ? [] : dir.split('/');
  for (const seg of rel.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      if (parts.length === 0) return null;
      parts.pop();
    } else parts.push(seg);
  }
  return parts.join('/');
}

/** Whether `target` opens with a scheme (`https:`, `mailto:` ...). */
function hasScheme(target) {
  const c0 = target.charCodeAt(0);
  if (!((c0 >= 65 && c0 <= 90) || (c0 >= 97 && c0 <= 122))) return false;
  for (let j = 1; j < target.length; j++) {
    const c = target.charCodeAt(j);
    if (c === 58) return true;
    if (!((c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 43 || c === 45 || c === 46)) return false;
  }
  return false;
}

/** One site's output tree: path -> text. */
export function run(input) {
  const slugCache = new Map();
  const dateCache = new Map();
  const longDateCached = (d) => {
    let v = dateCache.get(d);
    if (v === undefined) {
      v = longDate(d);
      dateCache.set(d, v);
    }
    return v;
  };

  // Templates, parsed in code-unit order of their name; one that does not
  // parse is reported and left out.
  const templates = new Map();
  const report = [];
  for (const name of Object.keys(input.templates).sort(byCodeUnits)) {
    try {
      templates.set(name, compileTemplate(name, input.templates[name]));
    } catch (err) {
      if (!(err instanceof TemplateError)) throw err;
      report.push(err.message);
    }
  }
  const C = { T: templates, esc: escapeHtml, txt: textOf, tr: truthy, lk: lookup, lk1, lk2, lk3, varText };

  // Sources, in code-unit order of their paths, line ends made "\n".
  const files = [...input.files].sort((x, y) => byCodeUnits(x.path, y.path));
  const sources = [];
  const statics = [];
  for (const f of files) {
    if (f.path.endsWith('.md')) sources.push({ path: f.path, lines: f.content.replace(/\r\n?/g, '\n').split('\n') });
    else statics.push({ path: f.path, content: f.content });
  }

  // Front matter and the refusal checks, in order.
  const kept = [];
  for (const s of sources) {
    const fm = parseFrontMatter(s.lines);
    if ('error' in fm) {
      report.push(`refused ${s.path}: ${fm.error}`);
      continue;
    }
    s.data = fm.data;
    s.bodyLines = fm.bodyLines;
    s.post = s.path.startsWith('posts/');
    let own;
    if (s.path.startsWith('tags/')) own = 'tags';
    else if (s.path.startsWith('page/')) own = 'page';
    if (own !== undefined) {
      report.push(`refused ${s.path}: ${own}/ is the generator's own`);
      continue;
    }
    if (s.post && !Object.hasOwn(s.data, 'date')) {
      report.push(`refused ${s.path}: a post needs a date`);
      continue;
    }
    const layout = s.data.layout ?? (s.post ? 'post' : 'page');
    if (!templates.has(layout)) {
      report.push(`refused ${s.path}: layout "${layout}" is no template that parses`);
      continue;
    }
    s.layout = layout;
    if (s.data.draft === true) {
      report.push(`draft ${s.path}`);
      continue;
    }
    kept.push(s);
  }

  // Permalinks.
  const base = input.site.base_url.replace(/\/+$/, '');
  const taken = new Map();
  const takenIn = (dir) => {
    let set = taken.get(dir);
    if (set === undefined) {
      set = new Set(dir === '' ? RESERVED : []);
      taken.set(dir, set);
    }
    return set;
  };
  const bySource = new Map();
  for (const s of kept) {
    const dir = s.post ? 'posts' : dirOf(s.path);
    const slug = uniqueSlug(s.data.slug ?? slugify(s.data.title, slugCache), takenIn(dir));
    s.slug = slug;
    s.outDir = dir === '' ? slug : `${dir}/${slug}`;
    s.url = `${base}/${s.outDir}/`;
    bySource.set(s.path, s);
  }

  // Markdown, its links resolved.
  const staticPaths = new Set(statics.map((f) => f.path));
  const broken = new Set();
  for (const s of kept) {
    const dir = dirOf(s.path);
    const env = {
      link: (target) => {
        if (hasScheme(target) || target.startsWith('/') || target.startsWith('#')) return target;
        const hash = target.indexOf('#');
        const rel = hash === -1 ? target : target.slice(0, hash);
        const frag = hash === -1 ? '' : target.slice(hash);
        const path = rel === '' ? null : resolvePath(dir, rel);
        if (path !== null && bySource.has(path)) return `${bySource.get(path).url}${frag}`;
        if (path !== null && staticPaths.has(path)) return `${base}/${path}${frag}`;
        broken.add(`broken-link ${s.path} -> ${target}`);
        return target;
      },
    };
    const md = renderMarkdown(s.bodyLines, env, slugCache);
    s.html = md.html;
    s.toc = md.toc;
    s.excerpt = md.excerpt;
    s.words = md.words;
  }

  // Collections: the posts, newest date first, then by slug.
  const posts = kept.filter((s) => s.post);
  posts.sort((x, y) => byCodeUnits(y.data.date, x.data.date) || byCodeUnits(x.slug, y.slug));
  posts.forEach((p, k) => {
    p.newer = k === 0 ? null : posts[k - 1];
    p.older = k === posts.length - 1 ? null : posts[k + 1];
  });

  // Tags.
  const bySlug = new Map();
  const ownTags = (s) => {
    const seen = new Set();
    const out = [];
    for (const name of s.data.tags ?? []) {
      const sl = slugify(name, slugCache);
      if (!seen.has(sl)) {
        seen.add(sl);
        out.push(name);
      }
    }
    return out;
  };
  for (const p of posts) {
    p.tagRefs = [];
    for (const name of ownTags(p)) {
      const slug = slugify(name, slugCache);
      let tag = bySlug.get(slug);
      if (tag === undefined) {
        tag = { name, slug, url: `${base}/tags/${slug}/`, posts: [] };
        bySlug.set(slug, tag);
      }
      tag.posts.push(p);
      p.tagRefs.push(tag);
    }
  }
  for (const s of kept) {
    if (!s.post) {
      s.tagRefs = ownTags(s).map((name) => {
        const sl = slugify(name, slugCache);
        return bySlug.get(sl) ?? { name, slug: sl, url: '', posts: [] };
      });
    }
  }
  const tags = [...bySlug.values()].sort((x, y) => y.posts.length - x.posts.length || byCodeUnits(x.slug, y.slug));

  // Cards and pages, as templates read them.
  const linkOf = (s) => (s === null ? null : { title: s.data.title, url: s.url, date: s.data.date ?? '', date_long: s.data.date === undefined ? '' : longDateCached(s.data.date) });
  const cardOf = (s) => ({
    title: s.data.title,
    url: s.url,
    date: s.data.date ?? '',
    date_long: s.data.date === undefined ? '' : longDateCached(s.data.date),
    summary: s.data.summary ?? '',
    excerpt: s.excerpt,
    reading_minutes: Math.max(1, Math.ceil(s.words / 200)),
    tags: s.tagRefs.map((t) => ({ name: t.name, slug: t.slug, url: t.url })),
  });
  for (const s of kept) s.card = cardOf(s);
  const pageOf = (s) => ({
    ...s.card,
    slug: s.slug,
    content: s.html,
    toc: s.toc.map((h) => ({ level: h.level, id: h.id, html: h.html })),
    newer: linkOf(s.newer ?? null),
    older: linkOf(s.older ?? null),
    is_post: s.post,
  });

  // Layouts.
  const output = {};
  const site = { title: input.site.title, base_url: base };
  const allTags = tags.map((t) => ({ name: t.name, slug: t.slug, url: t.url, count: t.posts.length }));
  const recent = posts.slice(0, input.site.recent).map((p) => p.card);
  const render = (name, vars) => {
    const fn = templates.get(name);
    if (fn === undefined) return null;
    const o = [];
    fn({ v: { site, tags: allTags, recent, ...vars }, p: null }, o, C, 0);
    return o.join('');
  };
  for (const s of kept) output[`${s.outDir}/index.html`] = render(s.layout, { page: pageOf(s) });
  const per = input.site.per_page;
  const pages = Math.max(1, Math.ceil(posts.length / per));
  const indexUrl = (k) => (k === 1 ? `${base}/` : `${base}/page/${k}/`);
  for (let k = 1; k <= pages; k++) {
    const html = render('index', {
      posts: posts.slice((k - 1) * per, k * per).map((p) => p.card),
      pager: { number: k, total: pages, url: indexUrl(k), newer_url: k === 1 ? '' : indexUrl(k - 1), older_url: k === pages ? '' : indexUrl(k + 1) },
    });
    if (html !== null) output[k === 1 ? 'index.html' : `page/${k}/index.html`] = html;
  }
  for (const t of tags) {
    const html = render('tag', { tag: { name: t.name, slug: t.slug, url: t.url, count: t.posts.length, posts: t.posts.map((p) => p.card) } });
    if (html !== null) output[`tags/${t.slug}/index.html`] = html;
  }
  const tagsHtml = render('tags', {});
  if (tagsHtml !== null) output['tags/index.html'] = tagsHtml;
  for (const f of statics) {
    if (Object.hasOwn(output, f.path)) report.push(`shadowed ${f.path}: a built page has its path`);
    else output[f.path] = f.content;
  }

  // The report.
  const lines = [...report, ...broken].sort(byCodeUnits);
  const pagesCount = kept.filter((s) => !s.post).length;
  lines.push(`built ${pagesCount} pages, ${posts.length} posts, ${tags.length} tags and ${statics.length} static files`);
  output['build-report.txt'] = `${lines.join('\n')}\n`;
  return output;
}

