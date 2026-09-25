// OWNER: Jay. Transforms. Read out/series-*.json, compute cumulative HEAT24/25/26 per day within the rule window,
// and BANWEEKS per species from transcribed toxin episodes. Write out/indices-<zone>-<season>.json (IndicesFile)
// and out/triggers-<zone>-<season>.json (TriggersFile, unsigned) using RULES from @repo/shared.
// Regression target: REFERENCE_FIRES in @repo/shared must reproduce exactly.
export {};
