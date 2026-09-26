import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { repositoryFiles, runDotdog, sha256 } from './dog-map';

type SpecNode = [number, string, string, string, string[], string[], [number, string, ...unknown[]][]];

export function checkMap(root: string) {
  const issues: string[] = [];
  const coverageFile = join(root, '.doghouse/generated/coverage.json');
  const graphFile = join(root, '.doghouse/generated/repo.dag');
  if (!existsSync(coverageFile) || !existsSync(graphFile)) return ['Map missing: run bun run dog:map.'];
  const coverage = JSON.parse(readFileSync(coverageFile, 'utf8'));
  const revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  if (coverage.revision !== revision) issues.push('Map revision changed: run bun run dog:map.');
  if (coverage.graphHash !== sha256(readFileSync(graphFile))) issues.push('Map artifact changed: run bun run dog:map.');
  const { files, untracked } = repositoryFiles(root);
  const hashes = coverage.hashes as Record<string, string>;
  for (const file of files) {
    if (!(file in hashes)) issues.push(`Map added: ${file}`);
    else if (hashes[file] !== sha256(readFileSync(join(root, file)))) issues.push(`Map changed: ${file}`);
  }
  for (const file of Object.keys(hashes)) if (!files.includes(file)) issues.push(`Map removed: ${file}`);
  for (const file of untracked) issues.push(`Untracked source: ${file}; stage it before mapping.`);
  return issues;
}

export function compileSpecs(root: string) {
  for (const file of ['SPEC.dog', 'constitution.dog', 'data-model.dog', 'plan.dog']) {
    if (!existsSync(join(root, 'specs/reeldeal', file))) throw new Error(`Missing spec: ${file}`);
  }
  runDotdog(root, 'validate', '.');
  mkdirSync(join(root, '.doghouse/generated'), { recursive: true });
  runDotdog(root, 'compile', 'specs', '--v2', '--output', '.doghouse/generated/specs-v2.dag');
  const graph = JSON.parse(readFileSync(join(root, '.doghouse/generated/specs-v2.dag'), 'utf8'));
  if (graph.v !== 2 || graph.p !== 'reeldeal' || !graph.n?.length) throw new Error('Reel Deal spec graph is empty or unsupported.');
  runDotdog(root, 'compile', 'specs');
  return graph.n as SpecNode[];
}

export function checkSpecs(root: string, nodes: SpecNode[], review: string[] = []) {
  const { files } = repositoryFiles(root);
  const baselineFile = join(root, 'specs/reeldeal/review.json');
  const baseline: Record<string, string> = existsSync(baselineFile) ? JSON.parse(readFileSync(baselineFile, 'utf8')) : {};
  const issues: string[] = [];
  const covered = new Set<string>();
  const observed = new Set<string>();
  for (const [, name, , description, properties, states, edges] of nodes) {
    const props = Object.fromEntries(properties.flatMap((value, i) => i % 2 === 0 ? [[value, properties[i + 1]!]] : []));
    if (!states.includes('observed')) continue;
    observed.add(name);
    const paths = (props.paths || '').split(' ').filter(Boolean);
    const sources = files.filter((file) => paths.some((path) => path.endsWith('/') ? file.startsWith(path) : file === path));
    if (!sources.length) issues.push(`Spec ${name}: no included source files match its paths.`);
    for (const file of sources) covered.add(file);
    const relationships = edges.map(([target, ...relation]) => [nodes.find((node) => node[0] === target)?.[1], ...relation]);
    const digest = sha256(JSON.stringify({ name, description, properties, states, relationships, sources: sources.map((file) => [file, sha256(readFileSync(join(root, file)))]) }));
    if (review.includes(name)) baseline[name] = digest;
    else if (baseline[name] !== digest) issues.push(`Spec ${name}: sources or definition changed; review the spec, then bun run dog:review ${name}.`);
  }
  for (const file of files) if (!file.startsWith('specs/') && !covered.has(file)) issues.push(`Spec coverage missing: ${file}`);
  for (const name of review) if (!observed.has(name)) throw new Error(`Unknown observed spec: ${name}`);
  for (const name of Object.keys(baseline)) if (!observed.has(name)) issues.push(`Spec baseline has removed entity: ${name}`);
  if (review.length) writeFileSync(baselineFile, JSON.stringify(baseline, null, 2) + '\n');
  return issues;
}

if (import.meta.main) {
  try {
    const root = process.cwd();
    const [command = 'check', ...names] = process.argv.slice(2);
    if (!['check', 'spec', 'review'].includes(command)) throw new Error(`Unknown command: ${command}`);
    if (command === 'review' && !names.length) throw new Error('Name the observed spec areas you reviewed: bun run dog:review Contracts Shared.');
    const nodes = compileSpecs(root);
    const issues = command === 'spec' ? [] : [
      ...(command === 'check' ? checkMap(root) : []),
      ...checkSpecs(root, nodes, command === 'review' ? names : []),
    ];
    for (const issue of issues) console.error(issue);
    if (issues.length) process.exitCode = 1;
    else console.log(command === 'spec' ? `Compiled ${nodes.length} spec entities.` : 'Dotdog checks passed.');
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    if (error && typeof error === 'object' && 'stdout' in error) console.error(String(error.stdout));
    process.exitCode = 1;
  }
}
