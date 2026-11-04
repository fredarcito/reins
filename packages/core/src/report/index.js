// Common message format: every finding says which rule broke, why, and how to fix it.
// Shared by `check` and (later) `doctor`. Text for people, JSON for agents and tools.

export const REPORT_SCHEMA = 1;

const ICON = { error: '✖', warn: '!' };

/**
 * @param {import('../check/index.js').CheckResult} result
 * @param {{ verbose?: boolean, title?: string, warnings?: string[] }} [opts]
 *   verbose: also list violations already in the baseline; warnings: problems reading the code (e.g. from the adapter)
 * @returns {string}
 */
export function formatText(result, opts = {}) {
  const title = opts.title ?? 'harness check';
  const lines = [];
  for (const w of opts.warnings ?? []) lines.push(`! warning  ${w}`, '');
  const shown = result.violations.filter((v) => v.status === 'new' || opts.verbose);
  for (const v of shown) {
    const where = v.to ? `${v.from} → ${v.to}` : v.from;
    const tag = v.status === 'baseline' ? ' (in baseline)' : '';
    lines.push(`${ICON[v.severity]} ${v.severity.padEnd(5)} ${v.rule}  ${where}${tag}`);
    lines.push(`    Why: ${v.message}`);
    lines.push(`    Fix: ${v.fix}`);
    lines.push('');
  }

  const s = result.summary;
  const parts = [
    s.new === 0 ? 'no new violations' : `${s.new} new (${s.newErrors} error${s.newErrors === 1 ? '' : 's'}, ${s.newWarnings} warning${s.newWarnings === 1 ? '' : 's'})`,
    `${s.baseline} in baseline`,
  ];
  if (!result.partial) parts.push(`${s.stale} fixed`);
  lines.push(`${title}: ${parts.join(' · ')}${result.partial ? ' (touched files only)' : ''}`);
  if (s.stale > 0) {
    lines.push(`${s.stale} baseline entr${s.stale === 1 ? 'y no longer occurs' : 'ies no longer occur'}. Remove ${s.stale === 1 ? 'it' : 'them'} with \`harness check --update-baseline\` and commit the smaller baseline.`);
  }
  lines.push(result.ok ? 'Result: pass' : 'Result: FAIL (new errors)');
  return lines.join('\n');
}

/**
 * Stable JSON shape for agents and tools. Bump REPORT_SCHEMA on breaking changes.
 * @param {import('../check/index.js').CheckResult} result
 * @param {{ warnings?: string[] }} [opts]
 * @returns {string}
 */
export function formatJson(result, opts = {}) {
  return JSON.stringify(
    {
      schema: REPORT_SCHEMA,
      ok: result.ok,
      partial: result.partial,
      summary: result.summary,
      warnings: opts.warnings ?? [],
      violations: result.violations.map((v) => ({
        rule: v.rule,
        severity: v.severity,
        status: v.status,
        from: v.from,
        ...(v.to ? { to: v.to } : {}),
        ...(v.files ? { files: v.files } : {}),
        message: v.message,
        fix: v.fix,
        key: v.key,
      })),
      stale: result.stale,
    },
    null,
    2,
  );
}
