// Demo fixtures used whenever the pipeline feed (PIPELINE_FEED_URL) is unreachable — see
// lib/feed-client.ts, which is the only place that should import from here in application code.
// Everything under this directory is SYNTHETIC, not measured NASA/buoy data; #3/#6/#22 (Jay) replace it
// with the real pipeline once it ships the same shapes over HTTP.
export * from './series';
export * from './buoy';
export * from './geo';
export * from './banweeks';
