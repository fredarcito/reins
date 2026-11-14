import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readRust, tokenize } from '../src/rust.js';

const identifiers = (source) => tokenize(source).filter((token) => token.type === 'ident').map((token) => token.value);

test('tokenize: comments, strings, chars and lifetimes hide nothing that is code', () => {
  assert.deepEqual(identifiers('a // b\n/* c /* d */ e */ f'), ['a', 'f']);
  assert.deepEqual(identifiers(`x("y::z", r#"w "q" "#, br"v", b"u", c"t") s`), ['x', 's']);
  assert.deepEqual(identifiers(`let c = '"'; let d = '\\''; fn f<'a>(x: &'a str) -> char { b'q' }`), ['let', 'c', 'let', 'd', 'fn', 'f', 'x', 'str', 'char']);
  assert.deepEqual(identifiers('let r#type = 10u8;'), ['let', 'type']);
});

test('readRust: mod declarations, inline modules and #[path]', () => {
  const scope = readRust('pub mod a;\n#[cfg(unix)]\n#[path = "x/y.rs"]\npub(crate) mod b;\nmod c { mod d; use super::a; }\n');
  assert.deepEqual(scope.mods.map((decl) => [decl.name, decl.path, Boolean(decl.scope)]), [['a', null, false], ['b', 'x/y.rs', false], ['c', null, true]]);
  const inline = scope.mods[2].scope;
  assert.deepEqual(inline?.mods.map((decl) => decl.name), ['d']);
  assert.deepEqual(inline?.uses.map((entry) => entry.segments), [['super', 'a']]);
});

test('readRust: use trees, aliases, globs and extern crate', () => {
  const { uses } = readRust('use crate::{a::{self, B as C}, d::*}; use ::ext::x; use e as _; extern crate f as g;');
  assert.deepEqual(uses, [
    { segments: ['crate', 'a'], alias: 'a', glob: false },
    { segments: ['crate', 'a', 'B'], alias: 'C', glob: false },
    { segments: ['crate', 'd'], alias: null, glob: true },
    { segments: ['::', 'ext', 'x'], alias: 'x', glob: false },
    { segments: ['e'], alias: null, glob: false },
    { segments: ['f'], alias: 'g', glob: false },
  ]);
});

test('readRust: paths in code, not method calls nor absolute paths', () => {
  const { refs } = readRust('fn f() { a::b::c(); x.collect::<Vec<_>>(); ::std::mem::drop(1); Vec::<u8>::new(); m!(crate::k); }');
  assert.deepEqual(refs, [['a', 'b', 'c'], ['crate', 'k']]);
});
