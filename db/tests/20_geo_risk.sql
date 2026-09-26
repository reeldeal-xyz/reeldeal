-- Constraints and behaviour of geo/risk, exercised as the pipeline role. Rolled back.
\set ON_ERROR_STOP on
BEGIN;
SET ROLE pipeline;

INSERT INTO geo.sea_areas (id, name_ja, kind, geom, accuracy)
VALUES ('test-bay', 'テスト湾', 'toxin_monitoring',
        ST_Multi(ST_GeomFromText('POLYGON((141.60 38.85,141.62 38.85,141.62 38.87,141.60 38.87,141.60 38.85))', 4326)),
        'test fixture');

INSERT INTO geo.plots (plot_code, origin, geom, species, operation, sea_area_id)
VALUES ('test-001', 'msil',
        ST_Multi(ST_GeomFromText('POLYGON((141.610 38.860,141.611 38.860,141.611 38.861,141.610 38.861,141.610 38.860))', 4326)),
        '{scallop}', 'longline', 'test-bay');

DO $$
DECLARE
  p geo.plots;
  n int;
BEGIN
  SELECT * INTO p FROM geo.plots WHERE plot_code = 'test-001';
  -- ~87 m x ~111 m at 38.86N
  ASSERT p.area_m2 BETWEEN 9000 AND 10500, format('area_m2 from geography, got %s', p.area_m2);
  ASSERT ST_Contains(p.geom, p.centroid), 'centroid lies inside the plot';

  -- A second live plot with the same code is rejected.
  BEGIN
    INSERT INTO geo.plots (plot_code, origin, geom) VALUES ('test-001', 'msil', p.geom);
    RAISE EXCEPTION 'duplicate live plot_code accepted';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;

  -- Uploaded plots carry an upload: code.
  BEGIN
    INSERT INTO geo.plots (plot_code, origin, geom) VALUES ('test-002', 'upload', p.geom);
    RAISE EXCEPTION 'upload without upload: code accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- Invalid (self-intersecting) geometry is rejected.
  BEGIN
    INSERT INTO geo.plots (plot_code, origin, geom)
    VALUES ('test-003', 'msil', ST_Multi(ST_GeomFromText('POLYGON((0 0,1 1,1 0,0 1,0 0))', 4326)));
    RAISE EXCEPTION 'invalid geometry accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- The pipeline cannot delete; it retires.
  BEGIN
    DELETE FROM geo.plots WHERE id = p.id;
    RAISE EXCEPTION 'pipeline delete accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  -- Changing geometry keeps the id and archives the old shape.
  UPDATE geo.plots SET geom = ST_Multi(ST_Buffer(geom::geography, 10)::geometry) WHERE id = p.id;
  SELECT count(*) INTO n FROM geo.plots_history WHERE id = p.id;
  ASSERT n = 1, 'geometry change archived';
  UPDATE geo.plots SET species = '{scallop,hoya}' WHERE id = p.id;
  SELECT count(*) INTO n FROM geo.plots_history WHERE id = p.id;
  ASSERT n = 1, 'non-geometry change not archived';

  -- Index values: NULL is allowed (missing), the target must match its kind, and a value is unique per version.
  INSERT INTO risk.index_values (target_kind, plot_id, index, unit, date, value, pixel_strategy, pixel_count, product, source_sha256, module_version)
  VALUES ('plot', p.id, 'SST', 'degC', '2025-08-01', NULL, 'buffer_500m', 0,
          'GCOM-C_SGLI_L3-SST.nighttime.v3', repeat('a', 64), 'heat-0.1.0');
  BEGIN
    INSERT INTO risk.index_values (target_kind, plot_id, index, unit, date, value, product, source_sha256, module_version)
    VALUES ('plot', p.id, 'SST', 'degC', '2025-08-01', 24.1, 'x', repeat('a', 64), 'heat-0.1.0');
    RAISE EXCEPTION 'duplicate index value accepted';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  INSERT INTO risk.index_values (target_kind, plot_id, index, unit, date, value, product, source_sha256, module_version)
  VALUES ('plot', p.id, 'SST', 'degC', '2025-08-01', 24.1, 'x', repeat('a', 64), 'heat-0.2.0');
  BEGIN
    INSERT INTO risk.index_values (target_kind, sea_area_id, index, unit, date, value, product, source_sha256, module_version)
    VALUES ('plot', 'test-bay', 'SST', 'degC', '2025-08-01', 24.1, 'x', repeat('a', 64), 'heat-0.1.0');
    RAISE EXCEPTION 'target_kind mismatch accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- Reference data is present.
  ASSERT (SELECT count(*) FROM risk.risk_types) = 3, 'risk types seeded';
  ASSERT EXISTS (SELECT 1 FROM risk.layers WHERE id LIKE '%SGLI%L3-SST.nighttime%'), 'SGLI SST layer seeded';
END $$;

RESET ROLE;
ROLLBACK;
\echo 20_geo_risk ok
