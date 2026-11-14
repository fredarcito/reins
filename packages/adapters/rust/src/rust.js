// Reads one Rust file into what the graph needs: module declarations (`mod x;`, inline `mod x { … }`, `#[path]`),
// `use` trees and the paths the code names (`crate::a::b`, `super::x`, `chat::store::load`).
// A small tokenizer instead of a parser: only paths matter, and comments, strings, chars and lifetimes are the only
// places where a path-looking text is not one.

/**
 * @typedef {{ type: 'ident' | 'string' | 'punct', value: string }} Token
 *   identifier (a raw `r#x` gives `x`), string literal value, or one punctuation character (`::` is one token)
 * @typedef {{ segments: string[], alias: string | null, glob: boolean }} UseEntry
 *   `alias`: the name it brings into scope (null for `as _` and globs)
 * @typedef {{ name: string, path: string | null, scope: Scope | null }} ModDecl  `scope` is set for inline modules
 * @typedef {{ mods: ModDecl[], uses: UseEntry[], refs: string[][] }} Scope
 * @typedef {{ source: string, position: number, tokens: Token[] }} Lexer
 */

const IDENT_START = /[A-Za-z_À-￿]/;
const IDENT = /[A-Za-z0-9_À-￿]/;

/** @param {Lexer} lexer */
const current = (lexer, offset = 0) => lexer.source[lexer.position + offset];
/** @param {Lexer} lexer */
const atEnd = (lexer) => lexer.position >= lexer.source.length;

/** @param {Lexer} lexer @param {RegExp} pattern */
function skipWhile(lexer, pattern) {
  while (!atEnd(lexer) && pattern.test(current(lexer))) lexer.position++;
}

/** @param {Lexer} lexer */
function skipLine(lexer) {
  while (!atEnd(lexer) && current(lexer) !== '\n') lexer.position++;
}

/** Block comment, nested ones included; the lexer is on its opening slash. */
function skipBlockComment(lexer) {
  const depthChange = { '/*': 1, '*/': -1 };
  let depth = 1;
  lexer.position += 2;
  while (!atEnd(lexer) && depth > 0) {
    const change = depthChange[lexer.source.slice(lexer.position, lexer.position + 2)];
    depth += change ?? 0;
    lexer.position += change ? 2 : 1;
  }
}

/** String body after the opening quote, escapes kept as their character; moves past the closing quote. */
function readQuoted(lexer) {
  let value = '';
  while (!atEnd(lexer) && current(lexer) !== '"') {
    if (current(lexer) === '\\') {
      value += current(lexer, 1) ?? '';
      lexer.position += 2;
    } else {
      value += current(lexer);
      lexer.position++;
    }
  }
  lexer.position++;
  return value;
}

/** Raw string `r#"…"#`, with the lexer on the first `#` or `"`. */
function readRawString(lexer) {
  let hashes = 0;
  while (current(lexer) === '#') {
    hashes++;
    lexer.position++;
  }
  lexer.position++;
  const closing = `"${'#'.repeat(hashes)}`;
  const end = lexer.source.indexOf(closing, lexer.position);
  const value = end < 0 ? lexer.source.slice(lexer.position) : lexer.source.slice(lexer.position, end);
  lexer.position = end < 0 ? lexer.source.length : end + closing.length;
  return value;
}

/** Byte or char literal body after the opening quote. */
function skipCharBody(lexer) {
  if (current(lexer) === '\\') lexer.position++;
  lexer.position++;
  while (!atEnd(lexer) && current(lexer) !== "'") lexer.position++;
  lexer.position++;
}

/** @param {Lexer} lexer */
const pushString = (lexer, value) => lexer.tokens.push({ type: 'string', value });

/** @param {Lexer} lexer */
function pushPunct(lexer) {
  lexer.tokens.push({ type: 'punct', value: current(lexer) });
  lexer.position++;
}

/** `r#type`: the lexer is on the `#`. */
function readRawIdent(lexer) {
  lexer.position++;
  const start = lexer.position;
  skipWhile(lexer, IDENT);
  lexer.tokens.push({ type: 'ident', value: lexer.source.slice(start, lexer.position) });
}

const rawString = (lexer) => pushString(lexer, readRawString(lexer));
const quotedString = (lexer) => {
  lexer.position++;
  pushString(lexer, readQuoted(lexer));
};

/**
 * Words that start a literal instead of being an identifier, by the character that follows them:
 * r"…", r#"…"#, br"…", cr"…", b"…", c"…", b'x', and the raw identifier r#type.
 * @type {Record<string, Record<string, (lexer: Lexer) => void>>}
 */
const LITERAL_PREFIXES = {
  r: {
    '"': rawString,
    '#': (lexer) => (IDENT_START.test(current(lexer, 1) ?? '') ? readRawIdent(lexer) : rawString(lexer)),
  },
  br: { '"': rawString, '#': rawString },
  cr: { '"': rawString, '#': rawString },
  b: {
    '"': quotedString,
    "'": (lexer) => {
      lexer.position++;
      skipCharBody(lexer);
    },
  },
  c: { '"': quotedString },
};

/** @param {Lexer} lexer */
function readWord(lexer) {
  const start = lexer.position;
  skipWhile(lexer, IDENT);
  const word = lexer.source.slice(start, lexer.position);
  const literal = LITERAL_PREFIXES[word]?.[current(lexer)];
  if (literal) literal(lexer);
  else lexer.tokens.push({ type: 'ident', value: word });
}

/** A char literal ('a', '\n', '😀') or a lifetime / label ('a, 'static); the lexer is on the quote. */
function readQuote(lexer) {
  lexer.position++;
  const codePoint = lexer.source.codePointAt(lexer.position) ?? 0;
  const width = codePoint > 0xffff ? 2 : 1;
  if (current(lexer) === '\\' || current(lexer, width) === "'") skipCharBody(lexer);
  else skipWhile(lexer, IDENT);
}

const skipChar = (lexer) => lexer.position++;

/** @type {Record<string, (lexer: Lexer) => void>} lexers by first character; the rest go through `readOther` */
const LEXERS = {
  ' ': skipChar,
  '\t': skipChar,
  '\n': skipChar,
  '\r': skipChar,
  '/': (lexer) => {
    const comments = { '/': skipLine, '*': skipBlockComment };
    (comments[current(lexer, 1)] ?? pushPunct)(lexer);
  },
  '"': quotedString,
  "'": readQuote,
  ':': (lexer) => {
    if (current(lexer, 1) !== ':') return pushPunct(lexer);
    lexer.tokens.push({ type: 'punct', value: '::' });
    lexer.position += 2;
  },
};

/** @param {Lexer} lexer */
function readOther(lexer) {
  const char = current(lexer);
  if (IDENT_START.test(char)) return readWord(lexer);
  if (char >= '0' && char <= '9') return skipWhile(lexer, IDENT); // numbers, suffixes included (10u8)
  pushPunct(lexer);
}

/**
 * @param {string} source
 * @returns {Token[]}
 */
export function tokenize(source) {
  /** @type {Lexer} */
  const lexer = { source, position: 0, tokens: [] };
  while (!atEnd(lexer)) (LEXERS[current(lexer)] ?? readOther)(lexer);
  return lexer.tokens;
}

const PATH_KEYWORDS = new Set(['crate', 'super', 'self']);
const CLOSING_BRACKET = { '[': ']', '(': ')', '{': '}' };
const isIdent = (token) => token?.type === 'ident';
const isPunct = (token, value) => token?.type === 'punct' && token.value === value;

/**
 * @typedef {{ tokens: Token[], position: number, depth: number, inline: boolean, pathAttr: string | null, scope: Scope, done: boolean }} Reader
 */

/** @param {Reader} reader */
const tokenAt = (reader, offset = 0) => reader.tokens[reader.position + offset];

/** Skips a balanced group starting at an opening bracket. */
function skipGroup(reader) {
  const opening = tokenAt(reader).value;
  const closing = CLOSING_BRACKET[opening];
  let depth = 0;
  for (; reader.position < reader.tokens.length; reader.position++) {
    if (isPunct(tokenAt(reader), opening)) depth++;
    else if (isPunct(tokenAt(reader), closing) && --depth === 0) {
      reader.position++;
      return;
    }
  }
}

/**
 * One use tree; appends its entries. The reader is on the tree's first token.
 * @param {Reader} reader
 * @param {string[]} prefix
 * @param {UseEntry[]} entries
 */
function readUseTree(reader, prefix, entries) {
  const segments = [...prefix];
  if (isPunct(tokenAt(reader), '::')) {
    // `use ::serde::…`: an external crate, never a file of this repo
    if (!segments.length) segments.push('::');
    reader.position++;
  }
  while (reader.position < reader.tokens.length) {
    const token = tokenAt(reader);
    if (isPunct(token, '*')) {
      reader.position++;
      entries.push({ segments, alias: null, glob: true });
      return;
    }
    if (isPunct(token, '{')) {
      reader.position++;
      while (reader.position < reader.tokens.length && !isPunct(tokenAt(reader), '}')) {
        if (isPunct(tokenAt(reader), ',')) reader.position++;
        else readUseTree(reader, segments, entries);
      }
      reader.position++;
      return;
    }
    if (!isIdent(token)) return;
    reader.position++;
    if (isPunct(tokenAt(reader), '::')) {
      segments.push(token.value);
      reader.position++;
      continue;
    }
    // the last segment; `a::{self}` names `a`
    const full = token.value === 'self' && segments.length ? segments : [...segments, token.value];
    let alias = full[full.length - 1];
    if (tokenAt(reader)?.value === 'as') {
      const renamed = tokenAt(reader, 1)?.value ?? null;
      alias = renamed === '_' ? null : renamed;
      reader.position += 2;
    }
    entries.push({ segments: full, alias, glob: false });
    return;
  }
}

/** @type {Record<string, (reader: Reader) => void>} punctuation that matters at item level */
const PUNCT_HANDLERS = {
  // attribute: #[path = "x.rs"] matters, the rest is skipped (#[cfg(…)], #[derive(…)])
  '#': (reader) => {
    reader.position++;
    if (isPunct(tokenAt(reader), '!')) reader.position++;
    if (!isPunct(tokenAt(reader), '[')) return;
    const [name, equals, value] = [tokenAt(reader, 1), tokenAt(reader, 2), tokenAt(reader, 3)];
    if (name?.value === 'path' && isPunct(equals, '=') && value?.type === 'string') reader.pathAttr = value.value;
    skipGroup(reader);
  },
  '{': (reader) => {
    reader.depth++;
    reader.position++;
  },
  '}': (reader) => {
    reader.position++;
    if (reader.depth === 0 && reader.inline) reader.done = true;
    else reader.depth = Math.max(0, reader.depth - 1);
  },
};

/** @type {Record<string, (reader: Reader) => boolean>} keywords; each returns false when the tokens are not that item */
const KEYWORD_HANDLERS = {
  mod: (reader) => {
    const [name, after] = [tokenAt(reader, 1), tokenAt(reader, 2)];
    if (!isIdent(name) || !(isPunct(after, ';') || isPunct(after, '{'))) return false;
    reader.position += 3;
    const inline = isPunct(after, '{') ? readScope(reader, true) : null;
    reader.scope.mods.push({ name: name.value, path: reader.pathAttr, scope: inline });
    reader.pathAttr = null;
    return true;
  },
  use: (reader) => {
    const next = tokenAt(reader, 1);
    if (!(isIdent(next) || isPunct(next, '::') || isPunct(next, '{'))) return false;
    reader.position++;
    readUseTree(reader, [], reader.scope.uses);
    while (reader.position < reader.tokens.length && !isPunct(tokenAt(reader), ';')) reader.position++;
    return true;
  },
  // `extern crate foo as bar;` brings a crate into scope like a `use`
  extern: (reader) => {
    const [keyword, name, as, renamed] = [1, 2, 3, 4].map((offset) => tokenAt(reader, offset));
    if (keyword?.value !== 'crate' || !isIdent(name)) return false;
    const alias = as?.value === 'as' ? renamed?.value ?? name.value : name.value;
    if (name.value !== 'self') reader.scope.uses.push({ segments: [name.value], alias: alias === '_' ? null : alias, glob: false });
    reader.position += 3;
    return true;
  },
};

/**
 * A path in code: `a::b::c`. `::x::y` is external; `value.method::<T>()` is a method call.
 * @returns {boolean} false when the identifier does not start a path
 */
function readPath(reader) {
  if (!isPunct(tokenAt(reader, 1), '::')) return false;
  const previous = tokenAt(reader, -1);
  const external = isPunct(previous, '::') || isPunct(previous, '.');
  const segments = [tokenAt(reader).value];
  reader.position++;
  while (isPunct(tokenAt(reader), '::') && isIdent(tokenAt(reader, 1))) {
    segments.push(tokenAt(reader, 1).value);
    reader.position += 2;
  }
  if (!external && (segments.length > 1 || PATH_KEYWORDS.has(segments[0]))) reader.scope.refs.push(segments);
  return true;
}

/** @type {Record<Token['type'], (reader: Reader, token: Token) => boolean>} each returns false when it did not move */
const TOKEN_HANDLERS = {
  punct: (reader, token) => {
    const handler = PUNCT_HANDLERS[token.value];
    handler?.(reader);
    return Boolean(handler);
  },
  ident: (reader, token) => Boolean(KEYWORD_HANDLERS[token.value]?.(reader)) || readPath(reader),
};

/**
 * Reads items until the end of the file, or the closing brace of an inline module. Moves `parent` past them.
 * @param {{ tokens: Token[], position: number }} parent
 * @param {boolean} inline
 * @returns {Scope}
 */
function readScope(parent, inline) {
  /** @type {Reader} */
  const reader = { tokens: parent.tokens, position: parent.position, depth: 0, inline, pathAttr: null, scope: { mods: [], uses: [], refs: [] }, done: false };
  while (reader.position < reader.tokens.length && !reader.done) {
    const token = tokenAt(reader);
    const handled = TOKEN_HANDLERS[token.type]?.(reader, token);
    if (!handled) reader.position++;
  }
  parent.position = reader.position;
  return reader.scope;
}

/**
 * @param {string} source
 * @returns {Scope}
 */
export function readRust(source) {
  return readScope({ tokens: tokenize(source), position: 0 }, false);
}
