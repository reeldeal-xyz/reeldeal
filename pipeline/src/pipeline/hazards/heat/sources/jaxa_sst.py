"""Sea surface temperature from the JAXA Earth API (README §4, §6).

Daily `SST` takes the first product with a valid pixel in reach, in the order proposed in README Q10:
SGLI nighttime → SGLI daytime → AMSR2 nighttime → null. Each value records the product it came from.

- SGLI (GCOM-C, optical, 1/360° ≈ 300 m) sees nothing under cloud. Nearest-pixel reach is 3 km so a value
  is never borrowed from across a cloud hole.
- AMSR2 (GCOM-W, microwave, 0.2° here) sees through cloud but is coarse and masked or degraded within tens of
  km of the coast (Q10), so it may reach up to 30 km offshore.
- The SGLI monthly nighttime composite is published as `SST_MONTH` context. It is cloud-robust but is not the
  daily series the app counts heat days from.
"""

from pipeline.core.layers import LayerSpec

SGLI_NIGHT = LayerSpec("sst_sgli_night", "sgli_sst_night_daily", "SST", "degC", nearest_max_km=3.0)
SGLI_DAY = LayerSpec("sst_sgli_day", "sgli_sst_day_daily", "SST", "degC", nearest_max_km=3.0)
AMSR2_NIGHT = LayerSpec("sst_amsr2_night", "amsr2_sst_night_daily", "SST", "degC", nearest_max_km=30.0)
SGLI_NIGHT_MONTHLY = LayerSpec("sst_sgli_night_monthly", "sgli_sst_night_monthly", "SST", "degC", nearest_max_km=3.0)

DAILY_ORDER: tuple[LayerSpec, ...] = (SGLI_NIGHT, SGLI_DAY, AMSR2_NIGHT)
MONTHLY: tuple[LayerSpec, ...] = (SGLI_NIGHT_MONTHLY,)
