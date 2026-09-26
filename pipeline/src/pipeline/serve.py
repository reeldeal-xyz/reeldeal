"""`pipeline-serve`: run all modules, or one module alone, on :8787."""

import argparse

import uvicorn

from pipeline.api import MODULES, create_app


def main() -> None:
    parser = argparse.ArgumentParser(prog="pipeline-serve")
    parser.add_argument("--module", choices=list(MODULES), help="serve one module alone (default: all)")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8787)
    args = parser.parse_args()

    app = create_app([args.module] if args.module else MODULES)
    uvicorn.run(app, host=args.host, port=args.port)


if __name__ == "__main__":
    main()
