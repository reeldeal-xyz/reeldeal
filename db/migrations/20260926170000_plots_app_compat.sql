-- migrate:up

-- App compatibility (PR #114 review, #115):
-- 1. plot_code is unique across all rows, not just live ones, so app tables can FK geo.plots(plot_code)
--    (the ENS label the app keys on). Ids are stable and geometry edits go to plots_history, so a code
--    never needs a second row; a retired plot keeps its code for good.
-- 2. origin gains 'synthetic' for demo plots that have no surveyed polygon yet.
DROP INDEX geo.plots_plot_code_live;
ALTER TABLE geo.plots ADD CONSTRAINT plots_plot_code_key UNIQUE (plot_code);

ALTER TABLE geo.plots DROP CONSTRAINT plots_origin_check;
ALTER TABLE geo.plots ADD CONSTRAINT plots_origin_check CHECK (origin IN ('msil', 'upload', 'synthetic'));

-- migrate:down
