-- migrate:up

-- HAB restrictions (#80) keep the bulletin fields the pipeline's /hab/bans returns (pipeline/README.md §7):
-- the prefecture that published it, its own restriction category as printed, and the extraction confidence.
ALTER TABLE risk.restrictions
  ADD COLUMN pref       text,
  ADD COLUMN level      text,
  ADD COLUMN confidence text CHECK (confidence IN ('high', 'medium', 'low'));

-- migrate:down

ALTER TABLE risk.restrictions
  DROP COLUMN confidence,
  DROP COLUMN level,
  DROP COLUMN pref;
