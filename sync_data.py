#!/usr/bin/env python3
"""Download a curated set of Iconify collections and build a local search index.

Usage:
    python3 sync_data.py            # default curated set
    python3 sync_data.py --all      # every collection Iconify publishes (~500 MB)
    python3 sync_data.py lucide mdi # just these prefixes (rebuilds db from cache+new)

Source: github.com/iconify/icon-sets (raw JSON per collection), jsDelivr as fallback.
Index: data/icons.db — SQLite + FTS5 over icon names, aliases, categories, collection names.
"""
from __future__ import annotations

import argparse
import json
import os
import sqlite3
import sys
import time
import urllib.request
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DATA = ROOT / "data"
RAW = DATA / "raw"
DB = DATA / "icons.db"

RAW_BASE = "https://raw.githubusercontent.com/iconify/icon-sets/master/json/{prefix}.json"
CDN_BASE = "https://cdn.jsdelivr.net/npm/@iconify/json@latest/json/{prefix}.json"
COLLECTIONS_API = "https://api.iconify.design/collections"

# Curated general-purpose + brand + game sets. ~90k icons, ~40 MB raw.
CURATED = [
    "lucide", "tabler", "mdi", "mdi-light", "material-symbols", "material-symbols-light",
    "ph", "heroicons", "bi", "ri", "ion", "carbon", "fluent", "iconoir", "solar",
    "mingcute", "hugeicons", "boxicons", "fa6-solid", "fa6-regular", "octicon",
    "simple-icons", "game-icons", "logos", "devicon", "codicon", "uil", "basil",
    "akar-icons", "clarity",
]


def fetch(url: str, dest: Path) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": "icon-library/1.0"})
    with urllib.request.urlopen(req, timeout=60) as r:
        blob = r.read()
    dest.write_bytes(blob)
    return blob


def get_collection(prefix: str, refresh: bool = False) -> dict | None:
    dest = RAW / f"{prefix}.json"
    if dest.exists() and not refresh:
        try:
            return json.loads(dest.read_text())
        except Exception:
            dest.unlink(missing_ok=True)
    for url in (RAW_BASE.format(prefix=prefix), CDN_BASE.format(prefix=prefix)):
        try:
            blob = fetch(url, dest)
            return json.loads(blob)
        except Exception as exc:  # network or 404 — try next mirror
            print(f"  ! {prefix}: {url.split('/')[2]} failed ({exc})", file=sys.stderr)
    return None


def all_prefixes() -> list[str]:
    req = urllib.request.Request(COLLECTIONS_API, headers={"User-Agent": "icon-library/1.0"})
    with urllib.request.urlopen(req, timeout=60) as r:
        data = json.loads(r.read())
    return sorted(data.keys())


def build_db(prefixes: list[str], refresh: bool) -> None:
    RAW.mkdir(parents=True, exist_ok=True)
    tmp = DB.with_suffix(".db.tmp")
    tmp.unlink(missing_ok=True)
    con = sqlite3.connect(tmp)
    con.executescript(
        """
        PRAGMA journal_mode=OFF;
        PRAGMA synchronous=OFF;
        CREATE TABLE collections(
            prefix TEXT PRIMARY KEY, name TEXT, spdx TEXT, license_title TEXT,
            license_url TEXT, author TEXT, author_url TEXT, height INTEGER,
            palette INTEGER, category TEXT, count INTEGER
        );
        CREATE TABLE icons(
            id INTEGER PRIMARY KEY, prefix TEXT NOT NULL, name TEXT NOT NULL,
            w INTEGER, h INTEGER, body BLOB NOT NULL
        );
        CREATE VIRTUAL TABLE search USING fts5(
            name, extra, coll, tokenize="unicode61 remove_diacritics 2"
        );
        """
    )

    total = 0
    for prefix in prefixes:
        info_raw = get_collection(prefix, refresh=refresh)
        if not info_raw:
            print(f"  - {prefix}: skipped")
            continue
        info = info_raw.get("info") or {}
        lic = info.get("license") or {}
        icons = info_raw.get("icons") or {}
        aliases = info_raw.get("aliases") or {}
        cats = info_raw.get("categories") or {}
        cname = info.get("name") or prefix

        # The viewBox lives in the collection's top-level width/height (Iconify spec).
        # info.height is the *display* size and lies for ph (24 vs 256), ion (32 vs 512)
        # and carbon (32 vs 32). Sets without top-level dims (bi, tabler) do use info.height.
        cw = int(info_raw.get("width") or info_raw.get("height")
                 or info.get("height") or 16)
        ch = int(info_raw.get("height") or info_raw.get("width")
                 or info.get("height") or 16)

        alias_words: dict[str, list[str]] = {}
        for alias, parent in aliases.items():
            pname = parent.get("parent") if isinstance(parent, dict) else parent
            if pname:
                alias_words.setdefault(pname, []).append(alias.replace("-", " "))

        cat_words: dict[str, list[str]] = {}
        for cat, names in cats.items():
            for nm in names or []:
                cat_words.setdefault(nm, []).append(cat.replace("-", " "))

        rows = []
        skipped_hidden = 0
        for name, icon in icons.items():
            body = icon.get("body")
            if not body:
                continue
            if icon.get("hidden"):
                skipped_hidden += 1
                continue
            w = int(icon.get("width") or cw)
            h = int(icon.get("height") or ch)
            extra = " ".join(
                [cname] + alias_words.get(name, []) + cat_words.get(name, [])
            )
            rows.append(
                (prefix, name, w, h,
                 zlib.compress(body.encode("utf-8"), 9), extra)
            )

        cur = con.cursor()
        for prefix_, name, w, h, blob, extra in rows:
            cur.execute(
                "INSERT INTO icons(prefix,name,w,h,body) VALUES(?,?,?,?,?)",
                (prefix_, name, w, h, blob),
            )
            rid = cur.lastrowid
            cur.execute(
                "INSERT INTO search(rowid,name,extra,coll) VALUES(?,?,?,?)",
                (rid, name.replace("-", " "), extra, cname),
            )
        con.execute(
            "INSERT OR REPLACE INTO collections(prefix,name,spdx,license_title,license_url,"
            "author,author_url,height,palette,category,count) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
            (prefix, cname, lic.get("spdx") or "", lic.get("title") or "",
             lic.get("url") or "", (info.get("author") or {}).get("name") or "",
             (info.get("author") or {}).get("url") or "", int(info.get("height") or 0),
             int(info.get("palette") or 0), (info.get("category") or ""), len(rows)),
        )
        con.commit()
        total += len(rows)
        size = (RAW / f"{prefix}.json").stat().st_size / 1e6
        print(f"  + {prefix:<24} {len(rows):>6} icons  {size:5.1f} MB  [{lic.get('spdx') or '?'}]")

    con.executescript("INSERT INTO search(search) VALUES('optimize'); ANALYZE;")
    con.commit()
    con.close()
    os.replace(tmp, DB)
    print(f"\nIndexed {total:,} icons from {len(prefixes)} collections -> {DB} "
          f"({DB.stat().st_size / 1e6:.1f} MB)")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("prefixes", nargs="*", help="specific collections to (re)build from")
    ap.add_argument("--all", action="store_true", help="every Iconify collection")
    ap.add_argument("--refresh", action="store_true", help="re-download cached JSON")
    args = ap.parse_args()

    if args.prefixes:
        prefixes = args.prefixes
    elif args.all:
        prefixes = all_prefixes()
        print(f"Fetching all {len(prefixes)} collections…")
    else:
        prefixes = CURATED

    t0 = time.time()
    build_db(prefixes, args.refresh)
    print(f"done in {time.time() - t0:.1f}s")


if __name__ == "__main__":
    main()
