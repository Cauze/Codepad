// Runs every *.test.mjs here, one after another, and prints a summary.
//   npm run test:e2e              all of them
//   npm run test:e2e -- find enc  only files whose name contains one of these words
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const only = process.argv.slice(2);
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.test.mjs') && (!only.length || only.some((o) => f.includes(o)))).sort();
if (!files.length) { console.error('No tests match.'); process.exit(2); }

const results = [];
for (const file of files) {
  const r = spawnSync(process.execPath, [path.join(dir, file)], { encoding: 'utf8', timeout: 300_000 });
  const out = (r.stdout ?? '') + (r.stderr ?? '');
  process.stdout.write(out);
  const m = /(\d+) passed, (\d+) failed/.exec(out);
  results.push({ file, passed: m ? +m[1] : 0, failed: m ? +m[2] : 1, code: r.status, skipped: /^SKIP /m.test(out) });
  if (r.status === 2) break; // setup problem (exe missing, Codepad already running): no point continuing
}

console.log('\n' + '-'.repeat(48));
for (const r of results) console.log(`${r.failed || r.code ? 'FAIL' : r.skipped ? 'skip' : 'ok  '}  ${r.file.padEnd(24)} ${r.passed} passed, ${r.failed} failed`);
const failed = results.some((r) => r.failed || r.code);
console.log(`\n${results.reduce((n, r) => n + r.passed, 0)} checks passed in ${results.length} files${failed ? ', with failures' : ''}.`);
process.exit(failed ? 1 : 0);
