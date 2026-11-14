// Reading JavaScript/TypeScript source as text, without a parser: only for the few places where the import graph
// is not enough (the next-server-client markers, re-export files).

/**
 * The source without its comments, strings kept as they are (they hold the module names). Not a full parser:
 * a regex literal containing a quote can confuse it, at worst up to the end of that line.
 * @param {string} source
 */
export function stripComments(source) {
  let out = '';
  let index = 0;
  const length = source.length;
  while (index < length) {
    const char = source[index];
    const nextChar = source[index + 1];
    if (char === '/' && nextChar === '/') {
      while (index < length && source[index] !== '\n') index++;
    } else if (char === '/' && nextChar === '*') {
      const end = source.indexOf('*/', index + 2);
      index = end === -1 ? length : end + 2;
      out += ' ';
    } else if (char === '"' || char === "'" || char === '`') {
      let close = index + 1;
      while (close < length && source[close] !== char && (char === '`' || source[close] !== '\n')) close += source[close] === '\\' ? 2 : 1;
      out += source.slice(index, close + 1);
      index = close + 1;
    } else {
      out += char;
      index++;
    }
  }
  return out;
}
