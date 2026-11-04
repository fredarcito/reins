// Minimal glob matcher for repo-relative POSIX paths. No dependencies.
// Supports: `*` (any chars except "/"), `**` (any chars including "/"; `**/` also matches zero folders),
// `?` (one char except "/"), `{a,b}` (alternatives, may contain globs). No negation, no character classes.

/** @type {Map<string, RegExp>} */
const cache = new Map();

/** @param {string} s */
const escapeRe = (s) => s.replace(/[.+^$()|[\]\\]/g, '\\$&');

/** @param {string} glob @returns {string} regexp source without anchors */
function toSource(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        i++;
        if (glob[i + 1] === '/') {
          i++;
          re += '(?:.*/)?';
        } else {
          re += '.*';
        }
      } else {
        re += '[^/]*';
      }
    } else if (c === '?') {
      re += '[^/]';
    } else if (c === '{') {
      const end = glob.indexOf('}', i);
      if (end === -1) {
        re += '\\{';
        continue;
      }
      re += `(?:${glob.slice(i + 1, end).split(',').map(toSource).join('|')})`;
      i = end;
    } else {
      re += escapeRe(c);
    }
  }
  return re;
}

/** @param {string} glob @returns {RegExp} */
export function globToRegExp(glob) {
  let re = cache.get(glob);
  if (!re) {
    re = new RegExp(`^${toSource(glob)}$`);
    cache.set(glob, re);
  }
  return re;
}

/**
 * @param {string} file repo-relative POSIX path
 * @param {string[]} globs
 */
export function matchesAny(file, globs) {
  return globs.some((g) => globToRegExp(g).test(file));
}
