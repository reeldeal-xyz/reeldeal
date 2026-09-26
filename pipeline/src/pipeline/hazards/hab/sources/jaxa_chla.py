"""Chlorophyll-a from the JAXA Earth API: GCOM-C SGLI L3 daytime (README §4, §7).

Daily values are null under cloud; the monthly composite gives cloud-robust context and will feed the
day-of-year climatology behind `CHL_Z`. 1/360° grid; nearest-pixel reach 3 km.
"""

from pipeline.core.layers import LayerSpec

CHLA_DAILY = LayerSpec("chla_sgli", "sgli_chla_daily", "CHL", "mg/m3", nearest_max_km=3.0)
CHLA_MONTHLY = LayerSpec("chla_sgli_monthly", "sgli_chla_monthly", "CHL", "mg/m3", nearest_max_km=3.0)

DAILY: tuple[LayerSpec, ...] = (CHLA_DAILY,)
MONTHLY: tuple[LayerSpec, ...] = (CHLA_MONTHLY,)
