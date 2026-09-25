// OWNER: Jay. Ingestion. See docs/INTERFACE.md for output shapes.
// Pull NASA JPL MUR SST (ERDDAP dataset jplMURSST41) for each zone's reference point and season window,
// pin the raw CSV under pipeline/data/, record its sha256, and write out/series-<zone>-<season>.json (SeriesFile).
// Reference point for karakuwa-east: 38.85N 141.66E (coastal cells are land-masked; keep points offshore).
// Example query:
// https://coastwatch.pfeg.noaa.gov/erddap/griddap/jplMURSST41.csv?analysed_sst[(2023-07-01T09:00:00Z):1:(2023-09-30T09:00:00Z)][(38.85):1:(38.85)][(141.66):1:(141.66)]
export {};
