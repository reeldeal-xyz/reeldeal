"""`pipeline`: fetch and build a module's inputs, layers and indices (README §9, §14).

    pipeline heat fetch --season 2025 --region miyagi     pin inputs only
    pipeline heat build --date 2025-08-01                 layers + indices (fetches missing inputs unless --offline)
    pipeline all --season 2025 --region miyagi            same as `build`
    pipeline all build --days 35                          cron: the last 35 days to today (JST), incl. last month's composites
    pipeline hab build --month 2025-08                    monthly composites only
    pipeline stations build                               load the reviewed station registry into PostGIS

`hab build` also publishes the reviewed shellfish-ban table (data/ref/hab/bans.csv) to PostGIS; database steps are
skipped while DATABASE_URL is unset.

Daily JAXA files appear ~3 days after observation and monthly ones after the month ends, so the cron rebuilds a
trailing window; existing layers are kept (use --force to rebuild them, --refresh to re-download inputs too).
"""

import argparse
import json
import logging
import sys
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

from pipeline.core import stations
from pipeline.core.db import NoDatabase
from pipeline.core.pin import PinError
from pipeline.core.regions import REGIONS, region
from pipeline.hazards.hab import bans as hab_bans
from pipeline.hazards.hab import layers as hab_layers
from pipeline.hazards.heat import build as heat_build
from pipeline.hazards.heat.layers import season_window as heat_season_window

MODULES = ("heat", "hab", "storm")
TARGETS = (*MODULES, "stations")
JST = ZoneInfo("Asia/Tokyo")


def today_jst() -> date:
    return datetime.now(JST).date()


def _window(args: argparse.Namespace, module: str) -> tuple[date, date, bool]:
    """(start, end, months_only) for the requested period."""
    if args.month:
        first = datetime.strptime(args.month, "%Y-%m").date()
        last = (first + timedelta(days=32)).replace(day=1) - timedelta(days=1)
        return first, last, True
    if args.season:
        if module == "heat":
            start, end = heat_season_window(args.season)
        else:
            y = int(args.season)
            start, end = date(y, 1, 1), date(y, 12, 31)
        return start, min(end, today_jst()), False
    end = date.fromisoformat(args.date) if args.date else today_jst()
    if args.start:
        return date.fromisoformat(args.start), date.fromisoformat(args.end) if args.end else end, False
    return end - timedelta(days=args.days - 1), end, False


def run(module: str, action: str, args: argparse.Namespace) -> dict:
    if module == "stations":
        head = {"module": module, "action": action}
        return head | ({"skipped": "stations have nothing to fetch"} if action == "fetch" else stations.build())
    reg = region(args.region)
    start, end, months_only = _window(args, module)
    head = {"module": module, "action": action, "region": reg.id, "start": start.isoformat(), "end": end.isoformat()}
    if module == "storm":
        return head | {"skipped": "the storm module has no builders yet (#81)"}
    if module == "heat":
        if action == "fetch":
            return head | {"pinned": heat_build.fetch(start, end, reg, refresh=args.refresh)}
        return head | heat_build.build(start, end, reg, offline=args.offline, force=args.force or args.refresh, months_only=months_only)
    if action == "fetch":
        return head | {"pinned": hab_layers.fetch(start, end, reg, refresh=args.refresh)}
    built = hab_layers.build(start, end, reg, offline=args.offline, force=args.force or args.refresh, months_only=months_only)
    return head | built | hab_bans.build()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="pipeline", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("module", choices=[*TARGETS, "all"])
    parser.add_argument("action", nargs="?", choices=["fetch", "build", "train"], default="build")
    when = parser.add_mutually_exclusive_group()
    when.add_argument("--season", help="YYYY (heat: 06-01..10-31; hab: the calendar year)")
    when.add_argument("--month", help="YYYY-MM: that month's composites only")
    when.add_argument("--start", help="YYYY-MM-DD (with --end, default --date)")
    parser.add_argument("--end", help="YYYY-MM-DD")
    parser.add_argument("--date", help="YYYY-MM-DD, default today in JST; the last day of a --days window")
    parser.add_argument("--days", type=int, default=1, help="with --date: build this many days ending on it (default 1)")
    parser.add_argument("--region", default="miyagi", choices=list(REGIONS))
    parser.add_argument("--offline", action="store_true", help="build from already-pinned inputs only")
    parser.add_argument("--force", action="store_true", help="rebuild existing layers")
    parser.add_argument("--refresh", action="store_true", help="re-download pinned inputs (implies --force)")
    parser.add_argument("-v", "--verbose", action="store_true")
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO if args.verbose else logging.WARNING, format="%(asctime)s %(name)s %(message)s")

    if args.action == "train":
        print("model training is not implemented yet (README §10, Q5)", file=sys.stderr)
        return 2
    modules = TARGETS if args.module == "all" else (args.module,)
    status = 0
    for m in modules:
        try:
            result = run(m, args.action, args)
        except (PinError, ValueError, NoDatabase) as e:
            result, status = {"module": m, "error": str(e)}, 1
        print(json.dumps(result, ensure_ascii=False))
    return status


if __name__ == "__main__":
    sys.exit(main())
