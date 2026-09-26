// Generates packages/shared/src/species.data.json from the canonical pipeline/data/ref/species.json (pipeline/README.md
// §5a). RULES and the SPECIES check read the generated copy, so the keeper, contracts' tests and the web app keep working
// offline; test/species-drift.test.ts fails when the two disagree. Run: `bun run species:gen`.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const CANONICAL = fileURLToPath(new URL('../../../pipeline/data/ref/species.json', import.meta.url));
export const GENERATED = fileURLToPath(new URL('../src/species.data.json', import.meta.url));

interface Canonical {
  profile_version: string;
  rules_version: string;
  species: { id: string }[];
  rules: Record<string, unknown>[];
}

/** The generated file's contents: versions, species ids in order and the rules. Profiles and evidence stay pipeline-side. */
export const speciesData = (canonical: Canonical): string =>
  `${JSON.stringify(
    {
      profile_version: canonical.profile_version,
      rules_version: canonical.rules_version,
      species: canonical.species.map((s) => s.id),
      rules: canonical.rules,
    },
    null,
    2,
  )}\n`;

export const readCanonical = (): Canonical => JSON.parse(readFileSync(CANONICAL, 'utf8')) as Canonical;

if (import.meta.main) {
  writeFileSync(GENERATED, speciesData(readCanonical()));
  console.log(`wrote ${GENERATED}`);
}
