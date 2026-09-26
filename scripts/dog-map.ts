import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('../node_modules/dotdog/dist/cli.js', import.meta.url));
const excluded = /(^|\/)(\.env(?:\.[^/]*)?|\.git|\.doghouse|\.aws|\.azure|\.gcp|\.ssh|\.npmrc|credentials(?:\.[^/]*)?|node_modules|vendor|\.data|\.run|\.next|out|cache|dist|build|coverage|id_rsa|id_ed25519)(\/|$)|\.(?:pem|key|p12|crt|log|tsbuildinfo)$|^contracts\/lib\//i;

export const sha256 = (content: string | Uint8Array) => createHash('sha256').update(content).digest('hex');
export const runDotdog = (root: string, ...args: string[]) => execFileSync(process.execPath, [cli, ...args], { cwd: root, encoding: 'utf8' });

export function repositoryFiles(root: string) {
  const list = (...args: string[]) => execFileSync('git', ['ls-files', '-z', ...args], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean).sort();
  const include = (file: string) => !excluded.test(file) && lstatSync(join(root, file), { throwIfNoEntry: false })?.isFile();
  const tracked = list();
  return { tracked, files: tracked.filter(include), untracked: list('--others', '--exclude-standard').filter(include) };
}

export function mapRepository(root: string) {
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trimEnd();
  const { tracked, files } = repositoryFiles(root);
  const snapshot = mkdtempSync(join(tmpdir(), 'reeldeal-dotdog-'));
  try {
    for (const file of files) {
      const target = join(snapshot, file);
      mkdirSync(dirname(target), { recursive: true });
      copyFileSync(join(root, file), target);
    }
    const result = JSON.parse(runDotdog(root, 'map', snapshot, '--project', 'reeldeal', '--json'));
    const graph = JSON.parse(readFileSync(result.dagFile, 'utf8'));
    const nodes = new Map(graph.nodes.filter((node: any) => node.properties?.path).map((node: any) => [node.properties.path, node]));
    const id = (file: string) => `file:${file}`;
    for (const node of graph.nodes) {
      if (node.source === snapshot) node.source = '.';
      if (node.origin?.file === snapshot) node.origin.file = '.';
    }
    for (const edge of graph.edges) if (edge.source === snapshot) edge.source = '.';
    const hashes: Record<string, string> = {};
    for (const file of files) {
      const hash = sha256(readFileSync(join(snapshot, file)));
      hashes[file] = hash;
      let node: any = nodes.get(file);
      if (!node) {
        node = { id: id(file), kind: 'file', label: id(file), source: file, properties: { path: file }, confidence: 'certain', origin: { type: 'generated', file } };
        graph.nodes.push(node);
        nodes.set(file, node);
      }
      node.hash = hash;
      graph.edges.push({ id: `contains:${file}`, sourceId: 'repository', targetId: node.id, verb: 'includes', confidence: 'certain', source: file });
    }
    const unresolved: { file: string; specifier: string }[] = [];
    const packageEntries = new Map<string, string>();
    for (const file of files.filter((file) => posix.basename(file) === 'package.json')) {
      const pkg = JSON.parse(readFileSync(join(snapshot, file), 'utf8'));
      if (pkg.name && typeof pkg.main === 'string') packageEntries.set(pkg.name, posix.join(posix.dirname(file), pkg.main));
    }
    for (const file of files.filter((file) => /\.(?:sol|[cm]?[jt]sx?)$/.test(file))) {
      const source = readFileSync(join(snapshot, file), 'utf8').replace(/\/\*[\s\S]*?\*\/|^\s*\/\/.*$/gm, '');
      for (const match of source.matchAll(/\b(?:import|export)\s+(?:[^;'"`]*?\s+from\s+)?['"]([^'"\r\n]+)['"]/g)) {
        const specifier = match[1]!;
        const relative = specifier.startsWith('.') ? posix.join(posix.dirname(file), specifier) : packageEntries.get(specifier);
        const target = relative && ['', '.ts', '.tsx', '.js', '.jsx', '.sol', '/index.ts', '/index.tsx', '/index.js'].map((ext) => relative + ext).find((path) => nodes.has(path));
        if (!target) {
          unresolved.push({ file, specifier });
          continue;
        }
        graph.edges.push({ id: `imports:${file}:${target}`, sourceId: (nodes.get(file) as any).id, targetId: (nodes.get(target) as any).id, verb: 'imports', confidence: 'likely', source: file, description: `Static import/export declaration: ${specifier}` });
      }
    }
    graph.root = '.';
    graph.nodes.sort((a: any, b: any) => a.id.localeCompare(b.id));
    graph.edges = [...new Map(graph.edges.map((edge: any) => [edge.id, edge])).values()].sort((a: any, b: any) => a.id.localeCompare(b.id));
    graph.unknowns = ['File inventory is complete for included tracked regular files; symbol/call graphs are not inferred.', 'Static import links are heuristic. Aliases, remappings, external packages, dynamic imports, and Python imports may remain unresolved.', ...unresolved.map(({ file, specifier }) => `${file}: unresolved import ${specifier}`)];
    const output = join(root, '.doghouse', 'generated');
    mkdirSync(output, { recursive: true });
    const graphText = JSON.stringify(graph, null, 2) + '\n';
    writeFileSync(join(output, 'repo.dag'), graphText);
    const coverage = { revision: git('rev-parse', 'HEAD'), dirty: Boolean(git('status', '--porcelain')), tracked: tracked.length, included: files.length, excluded: tracked.filter((file) => !files.includes(file)), dotdogScanned: result.scanned, nodes: graph.nodes.length, edges: graph.edges.length, graphHash: sha256(graphText), hashes, unresolved };
    writeFileSync(join(output, 'coverage.json'), JSON.stringify(coverage, null, 2) + '\n');
    return coverage;
  } finally {
    rmSync(snapshot, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  const report = mapRepository(process.cwd());
  console.log(`Mapped ${report.included}/${report.tracked} tracked files: ${report.nodes} nodes, ${report.edges} edges. ${report.excluded.length} excluded; ${report.unresolved.length} unresolved imports.`);
  console.log('.doghouse/generated/repo.dag and coverage.json');
}
