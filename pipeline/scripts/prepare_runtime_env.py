"""Prepare only the pipeline-role DB connection on the documented shared EC2 host."""

import argparse
import os
import re
import tempfile
from pathlib import Path
from urllib.parse import quote, urlsplit


def env_value(text: str, key: str) -> str | None:
    matches = re.findall(rf"^\s*{re.escape(key)}\s*=(.*)$", text, flags=re.MULTILINE)
    if len(matches) > 1:
        raise ValueError(f"Duplicate {key} configuration")
    if not matches:
        return None
    value = matches[0].strip()
    if value[:1] in {"'", '"'}:
        if len(value) < 2 or value[-1] != value[0]:
            raise ValueError(f"Invalid {key} configuration")
        value = value[1:-1]
    return value


def prepare(database_env: Path, pipeline_env: Path) -> bool:
    if pipeline_env.is_symlink() or database_env.is_symlink():
        raise ValueError("Runtime env files must not be symlinks")
    existing = pipeline_env.read_text() if pipeline_env.exists() else ""
    configured = env_value(existing, "DATABASE_URL")
    if configured:
        try:
            url = urlsplit(configured)
            valid = url.scheme in {"postgres", "postgresql"} and url.hostname and url.username and url.path.strip("/")
        except ValueError:
            valid = False
        if not valid:
            raise ValueError("Invalid existing DATABASE_URL; refusing to replace it")
        os.chmod(pipeline_env, 0o600)
        return False

    if not database_env.is_file():
        raise ValueError("db/.env is missing; provision the database before deploying the pipeline")
    database = database_env.read_text()
    password = env_value(database, "PIPELINE_PASSWORD")
    name = env_value(database, "POSTGRES_DB") or "reeldeal"
    if not password or any(c in password + name for c in "\r\n\x00"):
        raise ValueError("PIPELINE_PASSWORD is missing or invalid")
    url = f"postgresql://pipeline:{quote(password, safe='')}@db:5432/{quote(name, safe='')}?sslmode=disable"
    lines = [line for line in existing.splitlines() if not re.match(r"^\s*DATABASE_URL\s*=", line)]
    content = "\n".join([*lines, f"DATABASE_URL={url}", ""])
    pipeline_env.parent.mkdir(parents=True, exist_ok=True)
    name_on_disk = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=pipeline_env.parent, delete=False) as output:
            name_on_disk = output.name
            os.fchmod(output.fileno(), 0o600)
            output.write(content)
            output.flush()
            os.fsync(output.fileno())
        os.replace(name_on_disk, pipeline_env)
    finally:
        if name_on_disk and os.path.exists(name_on_disk):
            os.unlink(name_on_disk)
    return True


def main() -> None:
    root = Path(__file__).resolve().parents[2]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database-env", type=Path, default=root / "db/.env")
    parser.add_argument("--pipeline-env", type=Path, default=root / "pipeline/.env")
    args = parser.parse_args()
    try:
        changed = prepare(args.database_env, args.pipeline_env)
    except (ValueError, OSError) as error:
        # Never log file contents, credentials or connection strings.
        raise SystemExit(str(error) if isinstance(error, ValueError) else "Cannot prepare pipeline runtime environment") from None
    print("Pipeline database connection configured" if changed else "Existing pipeline database connection preserved")


if __name__ == "__main__":
    main()
