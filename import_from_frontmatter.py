#!/usr/bin/env python3
"""
Import tasks from files in client/import with YAML frontmatter.

Reads each file, parses:
  title   -> task title
  due     -> task due_date
  schedule -> task available_date
  projects -> list of project names (supports "[[Project Name]]" or plain names)

Content below the frontmatter becomes the task notes.

Uses the Spaztick external API. Configure API_URL and API_KEY below, or set
SPAZTICK_API_URL / SPAZTICK_API_KEY env vars, or pass:
  python import_from_frontmatter.py <base_url> <api_key>

Processed files are moved to client/import/processed.
"""

from __future__ import annotations

import os
import re
import sys
from pathlib import Path

try:
    import yaml
except ImportError:
    print("Missing dependency: pyyaml. Run: pip3 install pyyaml", file=sys.stderr)
    sys.exit(1)
try:
    import httpx
except ImportError:
    print("Missing dependency: httpx. Run: pip3 install httpx", file=sys.stderr)
    sys.exit(1)

# --- Settings (edit these or use env / command-line) ---
API_URL = "http://home-server:8081"   # e.g. "https://your-spaztick-server.com"
API_KEY = "Tqbfjotld1!"   # From Spaztick web UI → Settings → External API
# -----------------------------------------------------

# Default paths relative to repo root (script's parent directory)
REPO_ROOT = Path(__file__).resolve().parent
IMPORT_DIR = REPO_ROOT / "client" / "import"
PROCESSED_DIR = REPO_ROOT / "client" / "import" / "processed"

FRONTMATTER_RE = re.compile(r"^\s*---\s*\n(.*?)\n\s*---\s*\n?(.*)", re.DOTALL)
WIKILINK_RE = re.compile(r"\[\[([^\]|]+)(?:\|[^\]]*)?\]\]")


def get_config():
    url = (API_URL or os.environ.get("SPAZTICK_API_URL", "")).strip().rstrip("/")
    key = (API_KEY or os.environ.get("SPAZTICK_API_KEY", "")).strip()
    if len(sys.argv) >= 3:
        url = (sys.argv[1] or url).rstrip("/")
        key = (sys.argv[2] or key).strip()
    if not url or not key:
        print(
            "Set API_URL and API_KEY in this script, or SPAZTICK_API_URL / SPAZTICK_API_KEY env vars,\n"
            "or run: python import_from_frontmatter.py <base_url> <api_key>",
            file=sys.stderr,
        )
        sys.exit(1)
    return url, key


def parse_frontmatter(content: str) -> tuple[dict, str]:
    """Return (frontmatter_dict, body_str). If no frontmatter, returns ({}, content)."""
    m = FRONTMATTER_RE.match(content)
    if not m:
        return {}, content.strip()
    yaml_str, body = m.group(1), m.group(2)
    try:
        data = yaml.safe_load(yaml_str)
    except yaml.YAMLError as e:
        raise ValueError(f"Invalid YAML frontmatter: {e}") from e
    return (data or {}), body.strip()


def extract_project_names(raw: list | str | None) -> list[str]:
    """Turn projects field into list of plain names. Supports [[Name]] or plain names."""
    if raw is None:
        return []
    names = []
    if isinstance(raw, str):
        raw = [raw]
    for item in raw:
        if not isinstance(item, str):
            continue
        item = item.strip()
        # Wikilink: [[Project Name]] or [[Name|label]]
        link = WIKILINK_RE.match(item)
        if link:
            names.append(link.group(1).strip())
        elif item:
            names.append(item)
    return [n for n in names if n]


def normalize_date(value) -> str | None:
    """Return YYYY-MM-DD string or None."""
    if value is None:
        return None
    if isinstance(value, str):
        s = value.strip()[:10]
        return s if len(s) == 10 and s[4] == "-" and s[7] == "-" else None
    # datetime.date or datetime.datetime
    if hasattr(value, "strftime"):
        return value.strftime("%Y-%m-%d")
    return None


def ensure_dirs():
    IMPORT_DIR.mkdir(parents=True, exist_ok=True)
    PROCESSED_DIR.mkdir(parents=True, exist_ok=True)


def list_import_files():
    if not IMPORT_DIR.is_dir():
        return []
    return [f for f in IMPORT_DIR.iterdir() if f.is_file()]


def get_or_create_projects(base_url: str, api_key: str, names: list[str]) -> list[str]:
    """Return list of project IDs for the given names; create projects that don't exist."""
    if not names:
        return []
    headers = {"X-API-Key": api_key, "Content-Type": "application/json"}
    with httpx.Client(timeout=30.0) as client:
        r = client.get(f"{base_url}/api/external/projects", headers=headers)
        r.raise_for_status()
        existing = {p["name"].strip(): p["id"] for p in r.json()}
    ids = []
    for name in names:
        if name in existing:
            ids.append(existing[name])
            continue
        with httpx.Client(timeout=30.0) as client:
            r = client.post(
                f"{base_url}/api/external/projects",
                headers=headers,
                json={"name": name},
            )
            r.raise_for_status()
            created = r.json()
            ids.append(created["id"])
            existing[name] = created["id"]
    return ids


def create_task(base_url: str, api_key: str, payload: dict) -> dict:
    headers = {"X-API-Key": api_key, "Content-Type": "application/json"}
    with httpx.Client(timeout=30.0) as client:
        r = client.post(f"{base_url}/api/external/tasks", headers=headers, json=payload)
        r.raise_for_status()
        return r.json()


def process_file(path: Path, base_url: str, api_key: str) -> bool:
    """Parse file, create task via API, move to processed. Returns True on success."""
    content = path.read_text(encoding="utf-8", errors="replace")
    fm, body = parse_frontmatter(content)
    title = (fm.get("title") or "").strip()
    if not title:
        print(f"  Skip (no title): {path.name}")
        return False
    due = normalize_date(fm.get("due"))
    schedule = normalize_date(fm.get("schedule"))
    project_names = extract_project_names(fm.get("projects"))
    project_ids = get_or_create_projects(base_url, api_key, project_names) if project_names else []
    notes = body if body else None
    payload = {
        "title": title,
        "due_date": due,
        "available_date": schedule,
        "notes": notes,
        "projects": project_ids or None,
    }
    task = create_task(base_url, api_key, payload)
    dest = PROCESSED_DIR / path.name
    path.rename(dest)
    print(f"  Created task '{title}' (id={task.get('id', '')}) -> moved to processed/")
    return True


def main():
    base_url, api_key = get_config()
    ensure_dirs()
    files = list_import_files()
    if not files:
        print("No files in client/import.")
        return
    print(f"Processing {len(files)} file(s) from client/import ...")
    ok = 0
    for path in files:
        try:
            if process_file(path, base_url, api_key):
                ok += 1
        except Exception as e:
            print(f"  Error {path.name}: {e}")
    print(f"Done. {ok}/{len(files)} imported, rest left in client/import or reported above.")


if __name__ == "__main__":
    main()
