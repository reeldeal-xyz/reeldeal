// Copies compiled ABIs from contracts/out into packages/shared/src/abi for the web app and pipeline.
import { mkdirSync, writeFileSync } from 'node:fs';
const names = ['ReliefPool', 'HumanRegistry'];
mkdirSync('packages/shared/src/abi', { recursive: true });
for (const n of names) {
  const art = await Bun.file(`contracts/out/${n}.sol/${n}.json`).json();
  writeFileSync(`packages/shared/src/abi/${n}.ts`, `export const ${n}Abi = ${JSON.stringify(art.abi, null, 2)} as const;\n`);
  console.log('abi', n);
}
