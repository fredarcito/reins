// Reading JavaScript/TypeScript source as text, without a parser: only for the few places where the import graph
// is not enough (the next-server-client markers, re-export files).

/**
 * The source without its comments, strings kept as they are (they hold the module names). Not a full parser:
 * a regex literal containing a quote can confuse it, at worst up to the end of that line.
 * @param {string} source
 */
export function stripComments(source) {
  let out = '';
  let i = 0;
  const n = source.length;
  while (i < n) {
    const c = source[i];
    const d = source[i + 1];
    if (c === '/' && d === '/') {
      while (i < n && source[i] !== '\n') i++;
    } else if (c === '/' && d === '*') {
      const end = source.indexOf('*/', i + 2);
      i = end === -1 ? n : end + 2;
      out += ' ';
    } else if (c === '"' || c === "'" || c === '`') {
      let j = i + 1;
      while (j < n && source[j] !== c && (c === '`' || source[j] !== '\n')) j += source[j] === '\\' ? 2 : 1;
      out += source.slice(i, j + 1);
      i = j + 1;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}
