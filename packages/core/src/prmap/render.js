// `renderPrMap`: the Markdown comment for a pull request, from the model of `prStructure`. Pure templates:
// the same model gives the same text. The exact shape is fixed by docs/proposals/pr-map-examples/ (snapshots).

/** Structural edges above which the map is skipped (assumption; calibrated in phase 0c). */
export const MAP_EDGE_LIMIT = 20;
/** GitHub rejects comments over 65,536 characters. */
export const MAX_COMMENT_CHARS = 60_000;
const DIFF_LINES = 40;
const DETAIL_ROWS = 150;
const FILE_ROWS = 40;
const COLLAPSE_FILE_ROWS = 10;
const MAX_TOUCHED_DRAWN = 8;
const MAX_AFFECTED_DRAWN = 4;
const MAX_NOTE_LINES = 20;

export const MARKER = '<!-- reins:pr-map -->';
const INIT = '%%{init: {"theme": "base", "flowchart": {"curve": "basis", "padding": 18, "nodeSpacing": 28, "rankSpacing": 70}, "themeVariables": {"fontFamily": "-apple-system, BlinkMacSystemFont, Segoe UI, Helvetica, Arial, sans-serif", "fontSize": "13px", "primaryColor": "#ffffff", "primaryBorderColor": "#d0d7de", "primaryTextColor": "#1f2328", "lineColor": "#8c959f", "edgeLabelBackground": "#ffebe9", "textColor": "#1f2328"}}}%%';
const CLASS_DEFS = {
  default: 'fill:#ffffff,stroke:#afb8c1,stroke-width:1px,color:#1f2328',
  touched: 'fill:#fff5cc,stroke:#bf8700,stroke-width:2px,color:#1f2328',
  added: 'fill:#e6d8ff,stroke:#8250df,stroke-width:2.5px,color:#1f2328',
  affected: 'fill:#c8e6ff,stroke:#0969da,stroke-width:2px,color:#1f2328',
  nodomain: 'fill:#ffffff,stroke:#424a53,stroke-width:2px,stroke-dasharray:6 4,color:#1f2328',
};
const NODE_CLASS = { new: 'added', touched: 'touched', affected: 'affected', nodomain: 'nodomain', unchanged: null };
/** An untouched folder outside the domains keeps its dashed look. */
const classOf = (n) => (n.status === 'unchanged' && n.kind === 'nodomain' ? 'nodomain' : NODE_CLASS[n.status]);
const GROUPS = [
  ['new', 'stroke:#8250df,stroke-width:2.5px'],
  ['mutual', 'stroke:#bc4c00,stroke-width:2.5px'],
  ['removed', 'stroke:#6e7781,stroke-width:1.5px,stroke-dasharray:4 4'],
  ['forbidden', 'stroke:#cf222e,stroke-width:2.5px'],
  ['affected', 'stroke:#d0d7de,stroke-width:1px'],
];

const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const code = (s) => (s.includes('`') ? `\`\` ${s} \`\`` : `\`${s}\``);
const list = (names) => names.map(code).join(', ');
const label = (s) => s.replace(/`/g, '#96;').replace(/"/g, '#quot;');
const cell = (s) => s.replace(/\|/g, '\\|');

/**
 * @param {import('./index.js').MapNode[]} nodes
 * @param {import('./index.js').MapEdge[]} edges
 * @param {boolean} full
 */
function pickDrawn(model) {
  const byName = new Map(model.nodes.map((n) => [n.name, n]));
  const drawn = new Set();
  const structural = model.edges.filter((e) => e.status !== 'affected');
  for (const e of structural) (drawn.add(e.from), drawn.add(e.to));
  for (const n of model.nodes) if (n.status === 'new' || n.status === 'nodomain') drawn.add(n.name);
  const affected = model.nodes.filter((n) => n.status === 'affected');
  const drawAffected = affected.length <= MAX_AFFECTED_DRAWN;
  if (drawAffected) for (const n of affected) drawn.add(n.name);
  if (model.form === 'short') {
    const touched = model.nodes.filter((n) => n.status === 'touched').sort((a, b) => b.changed - a.changed || cmp(a.name, b.name));
    for (const n of touched.slice(0, MAX_TOUCHED_DRAWN)) drawn.add(n.name);
  }
  const edges = model.edges.filter((e) => {
    if (e.status !== 'affected') return true;
    if (!drawAffected) return false;
    if (model.form === 'short') return drawn.has(e.to); // the 8-box cap is strict
    drawn.add(e.to); // the only unchanged edge ever drawn needs both ends
    return true;
  });
  return { drawn, edges, byName };
}

function mermaid(model, { drawn, edges, byName }) {
  const order = { added: 0, touched: 1, affected: 2, nodomain: 3, none: 4 };
  const rank = (n) => order[classOf(n) ?? 'none'];
  const nodes = [...drawn].map((n) => byName.get(n)).filter(Boolean)
    .sort((a, b) => rank(a) - rank(b) || cmp(a.name, b.name));
  const ids = new Map(nodes.map((n, i) => [n.name, `n${i + 1}`]));
  const plan = (n) => {
    const count = (k) => plural(k, 'file');
    if (n.status === 'new') return `new domain · ${count(n.changed)}`;
    if (n.status === 'touched') return `${plural(n.changed, 'file')} changed`;
    if (n.status === 'affected') return `affected · ${count(n.importers)}`;
    if (classOf(n) === 'nodomain') return 'not in architecture.yml';
    return null;
  };
  const lines = ['```mermaid', INIT, 'flowchart LR'];
  for (const n of nodes) {
    const second = plan(n);
    const cls = classOf(n);
    lines.push(`  ${ids.get(n.name)}("\`**${label(n.name)}**${second ? `\n  ${second}` : ''}\`")${cls ? `:::${cls}` : ''}`);
  }
  const used = new Set(nodes.map(classOf).filter(Boolean));
  const emitted = [];
  const styles = [];
  for (const [status, style] of GROUPS) {
    const group = edges.filter((e) => e.status === status && ids.has(e.from) && ids.has(e.to)).sort((a, b) => cmp(a.from, b.from) || cmp(a.to, b.to));
    if (!group.length) continue;
    styles.push(`linkStyle ${group.map((_, i) => emitted.length + i).join(',')} ${style}`);
    emitted.push(...group);
  }
  // Without edges, Mermaid stacks LR boxes in one tall column; TB lays them out in a row.
  if (!emitted.length) lines[2] = 'flowchart TB';
  if (emitted.length) {
    lines.push('');
    for (const e of emitted) {
      const [a, b] = [ids.get(e.from), ids.get(e.to)];
      lines.push(e.status === 'removed' ? `  ${a} -.-> ${b}` : e.status === 'forbidden' ? `  ${a} -. "#nbsp;#nbsp;breaks ${label(e.rule ?? '')}#nbsp;#nbsp;" .-> ${b}` : `  ${a} --> ${b}`);
    }
  }
  lines.push('', `  classDef default ${CLASS_DEFS.default}`);
  for (const c of ['touched', 'added', 'affected', 'nodomain']) if (used.has(c)) lines.push(`  classDef ${c} ${CLASS_DEFS[c]}`);
  for (const s of styles) lines.push(`  ${s}`);
  lines.push('```');

  // legend: only what appears on this map
  const boxes = [];
  const has = (c) => nodes.some((n) => classOf(n) === c);
  if (has('touched')) boxes.push('🟨 Touched');
  if (has('affected')) boxes.push('🟦 Affected');
  if (has('added')) boxes.push('🟪 New');
  if (nodes.some((n) => classOf(n) === null)) boxes.push('⬜ Unchanged');
  if (has('nodomain')) boxes.push('⬚ Not in architecture.yml');
  const legend = [`<sub>**Boxes:** &nbsp; ${boxes.join(' &nbsp; ')}</sub>`];
  if (emitted.length) {
    const ex = ['forbidden', 'new', 'mutual', 'affected', 'removed'].map((s) => emitted.find((e) => e.status === s)).find(Boolean);
    const kinds = [];
    if (emitted.some((e) => e.status === 'new')) kinds.push('🟪 New');
    if (emitted.some((e) => e.status === 'mutual')) kinds.push('🟧 Mutual');
    if (emitted.some((e) => e.status === 'forbidden')) kinds.push('🟥 Breaks a rule');
    if (emitted.some((e) => e.status === 'removed')) kinds.push('┈┈ Removed');
    if (emitted.some((e) => e.status === 'affected')) kinds.push('── Unchanged');
    const head = `the arrow points to the code being used (${ex.from} → ${ex.to}: ${ex.from} uses ${ex.to})`;
    legend[0] += '<br>';
    legend.push(`<sub>**Lines:** &nbsp; ${[head, ...kinds].join(' &nbsp; ')}</sub>`);
  }
  return { block: lines.join('\n'), legend: legend.join('\n'), drawnNodes: nodes };
}

function diffBlock(model, cap, detailCap) {
  const kindOrder = ['forbidden', 'mutual', 'new', 'removed'];
  const nodeStatus = new Map(model.nodes.map((n) => [n.name, n.status]));
  const rows = [];
  for (const kind of kindOrder) {
    for (const e of model.edges.filter((x) => x.status === kind).sort((a, b) => cmp(a.from, b.from) || cmp(a.to, b.to))) {
      const noDomain = nodeStatus.get(e.from) === 'nodomain';
      if (kind === 'forbidden') {
        const internals = e.rule === 'domain-boundary' ? ' internals' : '';
        rows.push({ p: '-', from: e.from, verb: 'now uses', to: `${e.to}${internals}`, note: `✖ breaks ${e.rule}` });
      } else if (kind === 'mutual') rows.push({ p: '!', from: e.from, verb: 'now uses', to: e.to, note: `⇄ mutual: ${e.to} also uses ${e.from}` });
      else if (kind === 'new') rows.push({ p: '+', from: e.from, verb: 'now uses', to: e.to, note: noDomain ? `(${e.from} is not in architecture.yml)` : '' });
      else rows.push({ p: ' ', from: e.from, verb: 'no longer uses', to: e.to, note: '' });
    }
  }
  if (!rows.length) return null;
  const extra = Math.max(0, rows.length - cap);
  const kept = rows.slice(0, cap);
  const w = (k) => Math.max(...kept.map((r) => r[k].length));
  const [wf, wv, wt] = [w('from'), w('verb'), w('to')];
  const lines = kept.map((r) => `${r.p} ${r.from.padEnd(wf)}  ${r.verb.padEnd(wv)}  ${r.to.padEnd(wt)}  ${r.note}`.trimEnd());
  if (extra) lines.push(detailRows(model).length <= detailCap ? `… ${extra} more in Details` : `… ${extra} more not listed: the PR is too large to list them`);
  return ['```diff', ...lines, '```'].join('\n');
}

function detailRows(model) {
  const first = (e) => e.pairs[0];
  const rows = [];
  for (const d of model.newDomains) rows.push(['New domain', `${code(d.name)} added to architecture.yml (${list(d.paths)})`]);
  for (const d of model.removedDomains) rows.push(['Removed domain', `${code(d)} removed from architecture.yml`]);
  for (const n of model.nodes.filter((x) => x.status === 'nodomain')) {
    rows.push(['Not in architecture.yml', `${code(`${n.name}/`)} (${plural(n.changed, 'file')}): no domain covers it, so no rule checks it`]);
  }
  for (const e of model.edges.filter((x) => x.status === 'new')) {
    const p = first(e);
    rows.push(['New dependency', `${code(`${e.from} → ${e.to}`)}: ${code(p.from)} imports ${code(p.to)}${e.pairs.length > 1 ? ` (+${e.pairs.length - 1} more)` : ''}`]);
  }
  for (const m of model.mutual) {
    rows.push(['Mutual', `${code(`${m.a} ⇄ ${m.b}`)}: ${code(m.ab.from)} imports ${code(m.ab.to)}; ${code(m.ba.from)} imports ${code(m.ba.to)}`]);
  }
  for (const e of model.edges.filter((x) => x.status === 'removed')) {
    rows.push(['Removed dependency', `${code(`${e.from} → ${e.to}`)}: last import removed from ${code(first(e).from)}`]);
  }
  const affected = model.nodes.filter((n) => n.status === 'affected').sort((a, b) => b.importers - a.importers || cmp(a.name, b.name));
  if (affected.length) rows.push(['Affected', affected.map((n) => `${code(n.name)} (${n.importers})`).join(', ')]);
  return rows;
}

function detailsBlock(model, cap) {
  const rows = detailRows(model);
  if (!rows.length) return null;
  let shown = rows;
  if (rows.length > cap) {
    shown = rows.slice(0, cap);
    const rest = new Map();
    for (const [k] of rows.slice(cap)) rest.set(k, (rest.get(k) ?? 0) + 1);
    for (const [k, n] of rest) shown.push([k, `… one row per ${k.toLowerCase()} (${n})`]);
  }
  return ['<details>', `<summary><b>Details</b> (${rows.length})</summary>`, '', '| Change | Where |', '| --- | --- |',
    ...shown.map(([k, v]) => `| ${k} | ${cell(v)} |`), '', '</details>'].join('\n');
}

function filesBlock(model, drawn, cap) {
  const changed = model.nodes.filter((n) => n.status === 'new' || n.status === 'touched' || n.status === 'nodomain');
  if (!changed.length) return null;
  const total = changed.reduce((s, n) => s + n.changed, 0);
  const sorted = [...changed].sort((a, b) => b.changed - a.changed || cmp(a.name, b.name));
  let shown = sorted;
  /** @type {{ more: number, count: number } | null} */
  let collapsed = null;
  if (sorted.length > COLLAPSE_FILE_ROWS) {
    const quiet = sorted.filter((n) => n.status === 'touched' && !drawn.has(n.name));
    if (quiet.length) {
      shown = sorted.filter((n) => !quiet.includes(n));
      collapsed = { more: quiet.length, count: quiet.reduce((s, n) => s + n.changed, 0) };
    }
  }
  if (shown.length > cap) {
    const rest = shown.slice(cap);
    shown = shown.slice(0, cap);
    collapsed = { more: (collapsed?.more ?? 0) + rest.length, count: (collapsed?.count ?? 0) + rest.reduce((s, n) => s + n.changed, 0) };
  }
  const rows = shown.map((n) => {
    if (n.status === 'nodomain') return `| no domain | ${code(`${n.name}/*`)} | ${n.changed} |`;
    const names = n.sample.slice(0, 3).map(code).join(', ') + (n.sample.length > 3 ? ', …' : '');
    return `| ${code(n.name)}${n.status === 'new' ? ' · new' : ''} | ${cell(names)} | ${n.changed} |`;
  });
  if (collapsed) rows.push(`| ${collapsed.more} more domains | no structural change | ${collapsed.count} |`);
  return ['<details>', `<summary><b>Files by domain</b> (${total})</summary>`, '', '| Domain | Files | |', '| --- | --- | ---: |', ...rows, '', '</details>'].join('\n');
}

/**
 * @param {ReturnType<typeof import('./index.js').prStructure>} model
 * @param {{ skipMap?: string, diffLines?: number, detailRows?: number, fileRows?: number }} [opts]
 */
function build(model, opts = {}) {
  const full = model.form === 'full';
  const by = (s) => model.nodes.filter((n) => n.status === s);
  const structuralEdges = model.edges.filter((e) => e.status !== 'affected');
  const count = (s) => model.edges.filter((e) => e.status === s).length;
  const newDeps = count('new') + count('mutual');
  const nodomain = by('nodomain').length;

  const summary = [];
  const noCode = !full && model.fileCount === 0;
  if (noCode) summary.push('**No code changes**');
  else if (!full) summary.push('**No structural changes**');
  else {
    if (model.newDomains.length) summary.push(`**${plural(model.newDomains.length, 'new domain')}**`);
    if (newDeps) summary.push(`**${plural(newDeps, 'new dependency', 'new dependencies')}**`);
    if (count('removed')) summary.push(`**${count('removed')} removed**`);
    if (model.mutual.length) summary.push(`**${plural(model.mutual.length, 'mutual dependency', 'mutual dependencies')}**`);
    if (nodomain) summary.push(`**${plural(nodomain, 'folder')} outside architecture.yml**`);
    if (model.removedDomains.length) summary.push(`**${plural(model.removedDomains.length, 'removed domain')}**`);
    if (model.violations.length) summary.push(`**${plural(model.violations.length, 'violation')}**`);
  }

  const skipMap = opts.skipMap ?? (structuralEdges.length > MAP_EDGE_LIMIT ? `Map skipped: ${structuralEdges.length} structural changes. Consider splitting this PR.` : null);
  const picked = pickDrawn(model);
  const map = skipMap || noCode || !picked.drawn.size ? null : mermaid(model, picked);

  const touchedNames = by('touched').map((n) => n.name);
  const affected = by('affected');
  const drawnTouched = map ? map.drawnNodes.filter((n) => n.status === 'touched').length : touchedNames.length;
  const undrawn = touchedNames.length - drawnTouched;
  const touchedText = touchedNames.length > 4 ? plural(touchedNames.length, 'domain') : list(touchedNames);
  const affectedText = affected.length > 4 ? plural(affected.length, 'domain') : list(affected.map((n) => n.name));
  const parts = [`Compared with ${code(model.base.label)} at ${code(model.base.sha)}`];
  // Every changed file, as GitHub counts them; the ones off the map get one short reason, not a list.
  const offMap = (model.notAnalyzed ?? 0) + (model.outsideLayers ?? 0);
  parts.push(plural(model.fileCount + offMap, 'file') + (offMap ? ` (${offMap} not on the map: they don't change the architecture)` : ''));
  if (touchedNames.length) parts.push(`touched: ${touchedText}${!full && undrawn > 0 ? ` (+ ${undrawn} more touched)` : ''}`);
  if (affected.length) parts.push(`affected: ${affectedText} (${model.affectedFiles === 1 ? '1 file imports' : `${model.affectedFiles} files import`} changed code)`);
  const context = [`<sub>${parts.join(' · ')}</sub>`];
  if (skipMap) context.push(`<sub>${skipMap}</sub>`);
  else if (full && map && undrawn > 0) context.push(`<sub>${plural(undrawn, 'touched domain')} ${undrawn === 1 ? 'has' : 'have'} no structural change and ${undrawn === 1 ? 'is' : 'are'} not on the map: see Files by domain.</sub>`);

  const out = [MARKER, '### Architecture changes', '', summary.join(' · '), '', context.join('<br>\n')];
  const quote = (head, lines) => ['', head, `> ${lines.join('<br>\n> ')}`];
  if (model.violations.length) {
    const lines = model.violations.slice(0, MAX_NOTE_LINES).map((v) => `**${v.rule}:** ${v.message} ${v.fix}`);
    if (model.violations.length > MAX_NOTE_LINES) lines.push(`… ${model.violations.length - MAX_NOTE_LINES} more: run \`reins check\`.`);
    out.push(...quote('> [!CAUTION]', lines));
  }
  if (model.mutual.length) {
    const lines = model.mutual.slice(0, MAX_NOTE_LINES).map((m) => `**Mutual dependency:** ${code(m.a)} and ${code(m.b)} now use each other (${code(m.ab.from)} imports ${code(m.ab.to)}, ${code(m.ba.from)} imports ${code(m.ba.to)}). Neither can change without the other. No rule blocks it; decide if it is intended.`);
    if (model.mutual.length > MAX_NOTE_LINES) lines.push(`… ${model.mutual.length - MAX_NOTE_LINES} more in Details.`);
    out.push(...quote('> [!WARNING]', lines));
  }
  if (map) out.push('', map.block, '', map.legend);
  if (full) {
    const diff = diffBlock(model, opts.diffLines ?? DIFF_LINES, opts.detailRows ?? DETAIL_ROWS);
    if (diff) out.push('', diff);
    const details = detailsBlock(model, opts.detailRows ?? DETAIL_ROWS);
    if (details) out.push('', details);
  }
  const files = filesBlock(model, picked.drawn, opts.fileRows ?? FILE_ROWS);
  if (files) out.push('', files);
  out.push('', '<sub>Generated by reins on every push · `check` result is in the reins job</sub>', '');
  return out.join('\n');
}

/**
 * @param {ReturnType<typeof import('./index.js').prStructure>} model
 * @returns {string} Markdown, always under GitHub's size limit
 */
export function renderPrMap(model) {
  let text = build(model);
  if (text.length <= MAX_COMMENT_CHARS) return text;
  text = build(model, { skipMap: 'Map skipped: the comment is too large. Consider splitting this PR.' });
  if (text.length <= MAX_COMMENT_CHARS) return text;
  text = build(model, { skipMap: 'Map skipped: the comment is too large. Consider splitting this PR.', diffLines: 15, detailRows: 10, fileRows: 10 });
  if (text.length <= MAX_COMMENT_CHARS) return text;
  return truncate(text);
}

/** Cuts at a line boundary and closes what is open (code fences, <details>), so the Markdown still renders. */
function truncate(text) {
  const note = '… comment truncated: it was too large. Run `reins review --map` locally.';
  const kept = text.slice(0, MAX_COMMENT_CHARS - 400);
  const lines = kept.slice(0, kept.lastIndexOf('\n')).split('\n');
  const fences = lines.filter((l) => l.startsWith('```')).length;
  const opened = lines.filter((l) => l.startsWith('<details>')).length - lines.filter((l) => l.startsWith('</details>')).length;
  const out = [...lines];
  if (fences % 2) out.push('```');
  for (let i = 0; i < opened; i++) out.push('', '</details>');
  out.push('', `<sub>${note}</sub>`, '');
  return out.join('\n');
}
