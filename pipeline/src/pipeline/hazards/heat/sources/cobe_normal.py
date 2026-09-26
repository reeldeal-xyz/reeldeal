"""JMA COBE-SST daily normal from the JAXA Earth API (README §4): the climatology `SST_ANOM` is measured against.

0.2° grid, one layer per calendar day (29 February uses 28 February's). Reach is 30 km, like AMSR2.
"""

from pipeline.core.layers import LayerSpec

COBE_NORMAL = LayerSpec("sst_normal", "cobe_sst_normal", "SST", "degC", nearest_max_km=30.0)
