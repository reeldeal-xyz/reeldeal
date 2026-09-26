import { expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { mapRepository } from './dog-map';

test('maps Solidity and every tracked source beyond Dotdog’s scan cap without secrets or generated churn', () => {
  const root = mkdtempSync(join(tmpdir(), 'umi-dotdog-test-'));
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
    write('frontend/src/pages/index.astro', '<h1>Umi</h1>');
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
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
