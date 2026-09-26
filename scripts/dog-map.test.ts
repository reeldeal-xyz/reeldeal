import { expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mapRepository } from './dog-map';
import { checkMap, checkSpecs, compileSpecs } from './dog-check';

test('maps Solidity and every tracked source beyond Dotdog’s scan cap without secrets or generated churn', () => {
  const root = mkdtempSync(join(tmpdir(), 'reeldeal-dotdog-test-'));
  const write = (file: string, text: string) => {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), text);
  };
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
  try {
    git('init', '--quiet');
    write('.gitignore', '.doghouse/\n');
    write('contracts/src/Pool.sol', 'import {I} from "./I.sol";\ncontract Pool {}');
    write('contracts/src/I.sol', 'interface I {}');
    write('pipeline/api.py', 'from fastapi import FastAPI');
    write('frontend/src/pages/index.astro', '<h1>Reel Deal</h1>');
    write('deploy/compose.yml', 'services: {}');
    write('.env', 'SECRET_SENTINEL=do-not-map');
    write('.data/private.json', '{"name":"PRIVATE_SENTINEL"}');
    write('contracts/lib/vendor/Contract.sol', 'VENDORED_SENTINEL');
    symlinkSync('/etc/hosts', join(root, 'external-link'));
    for (let i = 0; i < 505; i++) write(`src/${i}.ts`, 'export const value = 1;');
    git('add', '.');
    git('add', '--force', '.env', '.data/private.json', 'contracts/lib/vendor/Contract.sol', 'external-link');
    git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '--quiet', '-m', 'test: mapping fixture');
    write('untracked.ts', 'UNTRACKED_SENTINEL');
    const before = git('status', '--porcelain');
    const report = mapRepository(root);
    const first = JSON.parse(readFileSync(join(root, '.doghouse/generated/repo.dag'), 'utf8'));
    expect(report.included).toBe(511);
    expect(report.dotdogScanned).toBe(500);
    expect(report.excluded).toHaveLength(4);
    expect(first.nodes.some((node: any) => node.source === 'pipeline/api.py')).toBe(true);
    expect(first.nodes.some((node: any) => node.source === 'frontend/src/pages/index.astro')).toBe(true);
    expect(first.edges.some((edge: any) => edge.sourceId === 'file:contracts/src/Pool.sol' && edge.targetId === 'file:contracts/src/I.sol' && edge.verb === 'imports')).toBe(true);
    expect(JSON.stringify(first)).not.toMatch(/SENTINEL|external-link|private\.json|Contract\.sol|untracked\.ts/);
    mapRepository(root);
    const second = JSON.parse(readFileSync(join(root, '.doghouse/generated/repo.dag'), 'utf8'));
    expect(second.nodes).toEqual(first.nodes);
    expect(second.edges).toEqual(first.edges);
    expect(git('status', '--porcelain')).toBe(before);
    expect(checkMap(root)).toEqual(['Untracked source: untracked.ts; stage it before mapping.']);
    git('add', 'untracked.ts');
    expect(checkMap(root)).toEqual(['Map added: untracked.ts']);
    mapRepository(root);
    expect(checkMap(root)).toEqual([]);

    mkdirSync(join(root, 'specs/reeldeal'), { recursive: true });
    const nodes: Parameters<typeof checkSpecs>[1] = [
      [0, 'Current', 'component', 'Observed fixture', ['paths', '.gitignore contracts/ pipeline/ frontend/ deploy/ src/ untracked.ts'], ['observed'], []],
      [1, 'Future', 'component', 'Planned fixture', ['paths', 'future/'], ['planned'], []],
    ];
    expect(checkSpecs(root, nodes)[0]).toContain('Spec Current:');
    expect(checkSpecs(root, nodes, ['Current'])).toEqual([]);
    git('add', 'specs');
    mapRepository(root);
    expect(checkMap(root)).toEqual([]);

    const pool = join(root, 'contracts/src/Pool.sol');
    const originalTime = statSync(pool);
    writeFileSync(pool, 'import {I} from "./I.sol";\ncontract PoolV2 {}');
    utimesSync(pool, originalTime.atime, originalTime.mtime);
    expect(checkMap(root)).toEqual(['Map changed: contracts/src/Pool.sol']);
    const reviewFile = join(root, 'specs/reeldeal/review.json');
    const reviewBefore = readFileSync(reviewFile, 'utf8');
    expect(checkSpecs(root, nodes)[0]).toContain('Spec Current:');
    mapRepository(root);
    expect(checkMap(root)).toEqual([]);
    expect(checkSpecs(root, nodes)[0]).toContain('Spec Current:');
    expect(readFileSync(reviewFile, 'utf8')).toBe(reviewBefore);
    expect(checkSpecs(root, nodes, ['Current'])).toEqual([]);
    nodes[0]![3] = 'Changed definition';
    expect(checkSpecs(root, nodes)[0]).toContain('Spec Current:');
    expect(checkSpecs(root, nodes, ['Current'])).toEqual([]);
    expect(() => checkSpecs(root, nodes, ['Future'])).toThrow('Unknown observed spec');

    rmSync(join(root, 'pipeline/api.py'));
    expect(checkMap(root)).toContain('Map removed: pipeline/api.py');
    write('future/new.py', 'print("new source")');
    git('add', 'future/new.py');
    expect(checkSpecs(root, nodes)).toContain('Spec coverage missing: future/new.py');
    git('add', '-A');
    git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '--quiet', '-m', 'test: change mapping fixture');
    expect(checkMap(root)).toContain('Map revision changed: run bun run dog:map.');
    write('.doghouse/generated/repo.dag', '{}');
    expect(checkMap(root)).toContain('Map artifact changed: run bun run dog:map.');
    rmSync(join(root, '.doghouse/generated/coverage.json'));
    expect(checkMap(root)).toEqual(['Map missing: run bun run dog:map.']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 30_000);

test('compiled specs expose planned status through Dotdog MCP', () => {
  const root = mkdtempSync(join(tmpdir(), 'reeldeal-spec-test-'));
  try {
    mkdirSync(join(root, 'specs/reeldeal'), { recursive: true });
    for (const file of ['SPEC.dog', 'constitution.dog', 'data-model.dog', 'plan.dog']) {
      writeFileSync(join(root, 'specs/reeldeal', file), readFileSync(new URL(`../specs/reeldeal/${file}`, import.meta.url)));
    }
    expect(compileSpecs(root).some((node) => node[1] === 'Contracts' && node[5].includes('observed'))).toBe(true);
    const request = { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'getEntity', arguments: { project: 'reeldeal', name: 'AstroApplication' } } };
    const output = execFileSync(process.execPath, [fileURLToPath(new URL('../node_modules/dotdog/dist/cli.js', import.meta.url)), 'serve', 'specs'], { cwd: root, input: JSON.stringify(request) + '\n', encoding: 'utf8', timeout: 5000 });
    expect(JSON.parse(JSON.parse(output).result.content[0].text).properties.status).toBe('planned');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
