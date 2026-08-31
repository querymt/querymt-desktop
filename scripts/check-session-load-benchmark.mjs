import { readFileSync } from 'node:fs';

const report = JSON.parse(readFileSync(process.argv[2] ?? '.session-load-benchmark.json', 'utf8'));
const budgets = new Map([
  ['session load 1x::captured ACP replay reduction', 250],
  ['session load 1x::conversation construction', 250],
  ['observed session pipeline 1x::live + response + duplicate sidecar drain', 300],
  ['session render 1x::ActiveSessionView mount and destroy', 2_000]
]);
const results = new Map();

for (const file of report.files ?? []) {
  for (const group of file.groups ?? []) {
    const groupName = group.fullName.split(' > ').at(-1);
    for (const benchmark of group.benchmarks ?? []) {
      results.set(`${groupName}::${benchmark.name}`, benchmark.mean);
    }
  }
}

let failed = false;
for (const [name, budgetMs] of budgets) {
  const meanMs = results.get(name);
  if (typeof meanMs !== 'number') {
    console.error(`Missing required session-load benchmark: ${name}`);
    failed = true;
    continue;
  }
  const status = meanMs <= budgetMs ? 'PASS' : 'FAIL';
  console.log(`${status} ${name}: ${meanMs.toFixed(2)} ms (budget ${budgetMs} ms)`);
  if (meanMs > budgetMs) failed = true;
}

if (failed) process.exit(1);
