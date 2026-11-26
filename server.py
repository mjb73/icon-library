#!/usr/bin/env python3
"""Icon Library — search open-source icon collections, compose a coloured app icon.

Backend:
  /api/search      local FTS5 index over 30 bundled collections, live Iconify fallback
  /api/collections bundled collection list with licence metadata
  /api/icon/<prefix>/<name>.svg   single icon source
  /api/export      POST a 1024 px composite + SVG -> zip of PNG sizes, .ico, .svg, licence
"""
from __future__ import annotations

import base64
import html as html_lib
import io
import json
import os
import re
import sqlite3
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
import zipfile
from pathlib import Path

from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import FileResponse, JSONResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles
from fontTools import subset as ftsubset
from fontTools.ttLib import TTFont
from PIL import Image

RESAMPLE = Image.Resampling.LANCZOS

ROOT = Path(__file__).resolve().parent
# A frozen/installed build keeps the index read-only next to the program but must
# write design records and the live-icon cache somewhere the user owns, so both
# locations are overridable from the environment.
DATA_DIR = Path(os.environ.get("ICON_LIBRARY_DATA") or (ROOT / "data"))
DB_PATH = Path(os.environ.get("ICON_LIBRARY_DB") or (DATA_DIR / "icons.db"))
STATIC = ROOT / "static"

EXPORT_SIZES = [1024, 512, 384, 256, 192, 180, 144, 128, 96, 72, 48, 32]
ICO_SIZES = [(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
ICONIFY_SEARCH = "https://api.iconify.design/search?query={q}&limit={n}"
ICONIFY_SVG = "https://api.iconify.design/{prefix}/{name}.svg"

FONT_DIR = STATIC / "fonts" / "label"
try:
    FONT_MANIFEST = json.loads((FONT_DIR / "manifest.json").read_text(encoding="utf-8"))
except (OSError, ValueError):
    FONT_MANIFEST = {"fonts": []}
FONT_BY_ID = {f["id"]: f for f in FONT_MANIFEST.get("fonts", [])}
FONT_BY_FAMILY = {f["family"]: f for f in FONT_MANIFEST.get("fonts", [])}
_FONT_SUBSETS: dict[tuple[str, str], str] = {}


def _font_subset_b64(rel: str, text: str) -> str:
    """The label font, subset to the characters the label actually uses.

    Embedding the full face would add 200 KB–2.6 MB to every exported SVG;
    a 16-character label needs a few KB. Cached per (file, text) because a
    batch export reuses the same face and text for every size.
    """
    key = (rel, text)
    if key in _FONT_SUBSETS:
        return _FONT_SUBSETS[key]
    font = TTFont(FONT_DIR / rel)
    opts = ftsubset.Options()
    opts.flavor = None
    opts.notdef_outline = True
    opts.name_IDs = ["*"]
    opts.name_legacy = True
    opts.layout_features = ["*"]
    opts.recalc_bounds = True
    sub = ftsubset.Subsetter(options=opts)
    sub.populate(text=text)
    sub.subset(font)
    buf = io.BytesIO()
    font.save(buf)
    data = base64.b64encode(buf.getvalue()).decode("ascii")
    if len(_FONT_SUBSETS) > 32:
        _FONT_SUBSETS.pop(next(iter(_FONT_SUBSETS)))
    _FONT_SUBSETS[key] = data
    return data


def embed_label_fonts(svg: str, groups) -> str:
    """Bake every label face into the SVG so the text survives off this machine.

    Without it the SVG names a bundled family the viewer probably lacks, and
    the label silently falls back to its system serif/sans — most visible on
    Windows, where none of the 40 faces are installed.

    `groups` is an iterable of (font_id, text, family) — one per label. Labels
    that share a family share one @font-face, subset to the union of the
    characters they use, so a two-label icon carries two subsets, not two
    conflicting rules for the same family.
    """
    if not svg or "<text" not in svg.lower():
        return svg
    per_family: dict[str, dict] = {}
    for font_id, text, family in groups:
        entry = FONT_BY_ID.get(font_id or "") or FONT_BY_FAMILY.get(family or "")
        sample = (text or "").strip()
        if not entry or not sample:
            continue
        slot = per_family.setdefault(entry["family"], {"entry": entry, "chars": ""})
        slot["chars"] += sample
    faces = []
    for slot in per_family.values():
        entry = slot["entry"]
        sample = "".join(dict.fromkeys(slot["chars"]))
        pairs = [(400, entry.get("regular"))] if entry.get("variable") else [
            (400, entry.get("regular")), (700, entry.get("bold"))
        ]
        for weight, rel in pairs:
            if not rel or not (FONT_DIR / rel).exists():
                continue
            fmt = "opentype" if rel.lower().endswith((".otf", ".otc")) else "truetype"
            css_weight = "400 900" if entry.get("variable") else str(weight)
            faces.append(
                f'@font-face{{font-family:"{entry["family"]}";font-style:normal;'
                f'font-weight:{css_weight};src:url(data:font/{fmt};base64,'
                f'{_font_subset_b64(rel, sample)}) format("{fmt}")}}'
            )
    if not faces:
        return svg
    m = re.search(r"<svg\b[^>]*>", svg, re.I)
    if not m:
        return svg
    return svg[:m.end()] + "<style>" + "".join(faces) + "</style>" + svg[m.end():]


def embed_label_font(svg: str, font_id: str | None = None, text: str | None = None,
                     family: str | None = None) -> str:
    """One label — the wrapper every single-label caller keeps using."""
    return embed_label_fonts(svg, [(font_id, text, family)])


def svg_label_texts(svg: str) -> list[tuple[str | None, str]]:
    """Family and text of **every** <text> element, front-most last as drawn."""
    out = []
    for m in re.finditer(r'<text\b[^>]*font-family="([^"]+)"[^>]*>(.*?)</text>', svg, re.I | re.S):
        family = html_lib.unescape(m.group(1)).split(",")[0].strip().strip("'\"")
        text = html_lib.unescape(re.sub(r"<[^>]+>", "", m.group(2)))
        out.append((family, text))
    return out


def svg_label_font(svg: str) -> tuple[str | None, str | None]:
    """Family and text of the composite's <text> element, for callers that only
    have the SVG (the launcher hand-off) rather than the composer state."""
    m = re.search(r'<text\b[^>]*font-family="([^"]+)"[^>]*>(.*?)</text>', svg, re.I | re.S)
    if not m:
        return None, None
    family = html_lib.unescape(m.group(1)).split(",")[0].strip().strip("'\"")
    text = html_lib.unescape(re.sub(r"<[^>]+>", "", m.group(2)))
    return family, text


def label_groups(payload: dict, svg: str) -> list[tuple[str | None, str | None, str | None]]:
    """(font_id, text, family) per label, from the payload when it says which
    font each label uses, otherwise parsed out of the SVG's own <text> nodes."""
    labels = payload.get("labels")
    groups: list[tuple[str | None, str | None, str | None]] = [(l.get("font"), l.get("value"), None)
              for l in labels if isinstance(l, dict)] if isinstance(labels, list) else []
    if not groups:
        lab = payload.get("label")
        if isinstance(lab, dict):
            groups = [(lab.get("font"), lab.get("value"), None)]
        elif isinstance(lab, str) and lab.strip():
            font = payload.get("font") if isinstance(payload.get("font"), str) else None
            groups = [(font, lab, None)]
    if not groups:
        groups = [(None, text, family) for family, text in svg_label_texts(svg)]
    return groups


app = FastAPI(title="Icon Library")


def db() -> sqlite3.Connection:
    if not DB_PATH.exists():
        raise HTTPException(503, "index missing — run: python3 sync_data.py")
    con = sqlite3.connect(f"{DB_PATH.as_uri()}?mode=ro", uri=True, check_same_thread=False)
    return con


def load_collections() -> dict[str, dict]:
    con = db()
    try:
        rows = con.execute(
            "SELECT prefix,name,spdx,license_title,license_url,author,author_url,"
            "height,palette,category,count FROM collections ORDER BY count DESC"
        ).fetchall()
    finally:
        con.close()
    keys = "prefix name spdx license_title license_url author author_url height palette category count".split()
    return {r[0]: dict(zip(keys, r)) for r in rows}


COLLECTIONS = load_collections()
_LIVE_CACHE: dict[str, dict] = {}


def live_collections() -> dict[str, dict]:
    """Collection metadata from the Iconify API, for results not bundled locally."""
    global _LIVE_CACHE
    if _LIVE_CACHE:
        return _LIVE_CACHE
    try:
        req = urllib.request.Request(
            "https://api.iconify.design/collections", headers={"User-Agent": "icon-library/1.0"}
        )
        with urllib.request.urlopen(req, timeout=8) as r:
            data = json.loads(r.read())
        for prefix, c in data.items():
            lic = c.get("license") or {}
            _LIVE_CACHE[prefix] = {
                "prefix": prefix,
                "name": c.get("name") or prefix,
                "spdx": lic.get("spdx") or "",
                "license_title": lic.get("title") or "",
                "license_url": lic.get("url") or "",
                "author": (c.get("author") or {}).get("name") or "",
                "author_url": (c.get("author") or {}).get("url") or "",
                "count": c.get("total") or 0,
                "remote": True,
            }
    except Exception:
        _LIVE_CACHE = {}
    return _LIVE_CACHE


def fts_query(q: str) -> str:
    toks = re.findall(r"[a-z0-9]+", q.lower())
    return " ".join(f'"{t}"*' for t in toks)


@app.get("/api/health")
def health():
    con = db()
    try:
        icons = con.execute("SELECT count(*) FROM icons").fetchone()[0]
    finally:
        con.close()
    return {
        "ok": True,
        "icons": icons,
        "collections": len(COLLECTIONS),
        "db_mb": round(DB_PATH.stat().st_size / 1e6, 1),
        "export_sizes": EXPORT_SIZES,
        "online": bool(live_collections()),
    }


@app.get("/api/collections")
def collections():
    return {"collections": list(COLLECTIONS.values()), "live": len(live_collections())}


@app.get("/api/search")
def search(
    q: str = Query("", min_length=0, max_length=80),
    limit: int = Query(60, ge=1, le=200),
    offset: int = Query(0, ge=0),
    sets: str = Query("", description="comma separated prefixes"),
    live: bool = Query(True),
):
    match = fts_query(q)
    if not match:
        return {"query": q, "total": 0, "results": [], "local_total": 0, "live": 0}

    only = [s for s in (sets or "").split(",") if s in COLLECTIONS]
    where = "search MATCH ?"
    params: list = [match]
    if sets and only:
        where += f" AND i.prefix IN ({','.join('?' * len(only))})"
        params += only

    con = db()
    try:
        local_total = con.execute(
            f"SELECT count(*) FROM search JOIN icons i ON i.id = search.rowid WHERE {where}",
            params,
        ).fetchone()[0]
        rows = con.execute(
            f"""SELECT i.id, i.prefix, i.name, i.w, i.h, i.body
                FROM search JOIN icons i ON i.id = search.rowid
                WHERE {where}
                ORDER BY
                  CASE WHEN i.name = ? THEN 0
                       WHEN i.name LIKE ? THEN 1
                       WHEN i.name LIKE ? THEN 2 ELSE 3 END,
                  bm25(search, 8.0, 2.0, 1.0),
                  length(i.name)
                LIMIT ? OFFSET ?""",
            params + [q.lower(), q.lower() + "%", "%" + q.lower() + "%", limit, offset],
        ).fetchall()
    finally:
        con.close()

    import zlib

    results = []
    for _id, prefix, name, w, h, blob in rows:
        c = COLLECTIONS.get(prefix, {})
        results.append({
            "id": f"{prefix}:{name}",
            "prefix": prefix,
            "name": name,
            "w": w or 16,
            "h": h or 16,
            "body": zlib.decompress(blob).decode("utf-8"),
            "collection": c.get("name", prefix),
            "collection_name": c.get("name", prefix),
            "spdx": c.get("spdx", ""),
            "license_title": c.get("license_title", ""),
            "license_url": c.get("license_url", ""),
            "author": c.get("author", ""),
            "remote": False,
        })

    # Live Iconify fallback for anything the local bundle does not cover.
    added = 0
    if live and offset == 0 and results is not None:
        want = min(24, max(0, limit - len(results))) if len(results) < limit else 0
        if want:
            try:
                url = ICONIFY_SEARCH.format(q=urllib.parse.quote(q), n=want + 16)
                req = urllib.request.Request(url, headers={"User-Agent": "icon-library/1.0"})
                with urllib.request.urlopen(req, timeout=6) as r:
                    data = json.loads(r.read())
                meta = live_collections()
                seen = {r["id"] for r in results}
                for ident in data.get("icons", []):
                    if len(results) >= limit or ident in seen:
                        continue
                    if ":" not in ident:
                        continue
                    prefix, name = ident.split(":", 1)
                    if prefix in COLLECTIONS:  # already indexed locally
                        continue
                    c = meta.get(prefix, {})
                    results.append({
                        "id": ident,
                        "prefix": prefix,
                        "name": name,
                        "w": 24, "h": 24,
                        "body": "",
                        "remote": ICONIFY_SVG.format(prefix=prefix, name=name),
                        "collection": c.get("name", prefix),
                        "collection_name": c.get("name", prefix),
                        "spdx": c.get("spdx", ""),
                        "license_title": c.get("license_title", ""),
                        "license_url": c.get("license_url", ""),
                        "author": c.get("author", ""),
                    })
                    added += 1
            except Exception:
                pass

    return {
        "query": q,
        "total": local_total + added,
        "local_total": local_total,
        "live": added,
        "results": results,
    }


LIVE_DIR = DATA_DIR / "live"
_SAFE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$")


def live_icon(prefix: str, name: str, colour: str = "") -> bytes:
    """Iconify glyph, cached on disk so a rate limit cannot empty the UI.

    The page used to fetch api.iconify.design directly, which fails from a
    browser whenever Iconify answers 429 or the origin is blocked — and the
    failure was invisible: the composer drew its background and no glyph. Every
    live fetch now goes through here, once per glyph, forever.
    """
    if not (_SAFE.match(prefix) and _SAFE.match(name)):
        raise HTTPException(400, "bad icon id")
    tint = re.sub(r"[^0-9a-fA-F]", "", colour or "")[:6].lower()
    key = f"{prefix}__{name}" + (f"__{tint}" if tint else "") + ".svg"
    cached = LIVE_DIR / key
    if cached.exists():
        return cached.read_bytes()
    url = ICONIFY_SVG.format(prefix=prefix, name=name) + (f"?color=%23{tint}" if tint else "")
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "icon-library/1.0"})
        with urllib.request.urlopen(req, timeout=8) as r:
            data = r.read()
    except urllib.error.HTTPError as e:
        raise HTTPException(503, f"Iconify said {e.code} for {prefix}:{name} — "
                                 f"pick a bundled set or try again later")
    except Exception as e:
        raise HTTPException(503, f"Iconify unreachable: {e}")
    try:
        LIVE_DIR.mkdir(parents=True, exist_ok=True)
        cached.write_bytes(data)
    except OSError:
        pass
    return data


@app.get("/api/icon/{prefix}/{name}")
def icon(prefix: str, name: str, color: str = Query("")):
    con = db()
    try:
        row = con.execute(
            "SELECT w,h,body FROM icons WHERE prefix=? AND name=?", (prefix, name)
        ).fetchone()
    finally:
        con.close()
    if not row:
        return Response(live_icon(prefix, name, color), media_type="image/svg+xml",
                        headers={"Cache-Control": "no-store"})
    import zlib

    w, h, blob = row
    body = zlib.decompress(blob).decode("utf-8")
    tint = re.sub(r"[^0-9a-fA-F]", "", color or "")[:6]
    if tint:
        body = re.sub(r"currentColor", f"#{tint}", body)
    svg = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w or 24} {h or 24}" '
           f'width="{w or 24}" height="{h or 24}">{body}</svg>')
    return Response(svg, media_type="image/svg+xml",
                    headers={"Cache-Control": "no-store"})


def slug(text: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")
    return s or "icon"


@app.post("/api/export/svg")
async def export_svg(payload: dict):
    """The composite SVG with the label face baked in, as text — the clipboard path.

    Separate from /api/export so copying an icon needs no PNG master and no zip:
    the page posts what it drew, gets the same self-contained markup the zip
    would have carried, and puts it on the clipboard.
    """
    svg = payload.get("svg") or ""
    if not isinstance(svg, str) or "<svg" not in svg[:600].lower():
        raise HTTPException(400, "svg required")
    if len(svg.encode("utf-8")) > 200_000:
        raise HTTPException(413, "icon too large")
    svg = embed_label_fonts(svg, label_groups(payload, svg))
    return Response(svg, media_type="image/svg+xml",
                    headers={"Cache-Control": "no-store"})


@app.post("/api/export")
async def export(payload: dict):
    png_b64 = (payload.get("png") or "").split(",")[-1]
    if not png_b64:
        raise HTTPException(400, "png required")
    try:
        master = Image.open(io.BytesIO(base64.b64decode(png_b64))).convert("RGBA")
    except Exception:
        raise HTTPException(400, "png not decodable")
    if max(master.size) < 256:
        raise HTTPException(400, "master render must be at least 256 px")

    name = slug(payload.get("name") or payload.get("icon") or "icon")
    svg = payload.get("svg") or ""
    payload_labels = [
        {"value": l.get("value", ""), "font": l.get("font", ""), "bold": bool(l.get("bold")),
         "colour": l.get("colour", ""), "size": l.get("size"), "x": l.get("x"), "y": l.get("y"),
         "rot": l.get("rot") or 0}
        for l in (payload.get("labels") or []) if isinstance(l, dict)
    ]
    if not payload_labels:
        one = payload.get("label")
        if isinstance(one, dict):
            payload_labels = [one]
    if svg:
        svg = embed_label_fonts(svg, label_groups(payload, svg))
    meta = {
        "icon": payload.get("icon", ""),
        "collection": payload.get("collection", ""),
        "license": payload.get("license") or payload.get("spdx", ""),
        "license_url": payload.get("license_url", ""),
        "author": payload.get("author", ""),
        "background": payload.get("bg") or "transparent",
        "transparent": bool(payload.get("transparent")),
        "icon_colour": payload.get("fg", ""),
        "grayscale": bool(payload.get("grayscale")),
        "shape": payload.get("shape", ""),
        "inset": payload.get("inset"),
        "rotation": payload.get("rotation", 0),
        "label": payload.get("label") or None,
        "labels": payload_labels,
        "layers": [{
            "icon": l.get("icon", ""),
            "collection": l.get("collection", ""),
            "license": l.get("license", ""),
            "size": l.get("size"),
            "x": l.get("x"),
            "y": l.get("y"),
            "rotation": l.get("rotation", 0),
            "ink": l.get("ink", ""),
            "auto_ink": bool(l.get("auto_ink")),
        } for l in (payload.get("layers") or []) if isinstance(l, dict)],
        "source": "Iconify" if not payload.get("remote") else "Iconify (live)",
    }

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for size in EXPORT_SIZES:
            img = master if size == master.width else master.resize((size, size), RESAMPLE)
            b = io.BytesIO()
            img.save(b, format="PNG", optimize=True)
            z.writestr(f"{name}-{size}.png", b.getvalue())
        ico = master.resize((256, 256), RESAMPLE)
        b = io.BytesIO()
        ico.save(b, format="ICO", sizes=ICO_SIZES)
        z.writestr(f"{name}.ico", b.getvalue())
        if svg:
            z.writestr(f"{name}.svg", svg)
        else:
            b = io.BytesIO()
            master.save(b, format="PNG")
            z.writestr(f"{name}-1024.png", b.getvalue())
        z.writestr("recipe.json", json.dumps(meta, indent=2))
        lic_lines = [
            f"Icon:        {meta['icon']}",
            f"Collection:  {meta['collection']}",
            f"Licence:     {meta['license'] or 'see collection'}",
            f"Licence URL: {meta['license_url'] or 'n/a'}",
            f"Author:      {meta['author'] or 'n/a'}",
            "",
            "Icon geometry is the property of the collection's authors and is redistributed",
            "here under the licence above; keep this file with the exported artwork if you",
            "publish it, and credit the collection for CC-BY sources.",
            "",
            f"Background: {meta['background']}  Icon colour: {meta['icon_colour']}",
            f"Transparent: {meta['transparent']}",
            f"Grayscale:  {meta['grayscale']}  Shape: {meta['shape']}",
            f"Rotation:   {meta['rotation']} deg  Icon size: {meta['inset']}",
        ]
        if len(meta["layers"]) > 1:
            lic_lines.append("Layers (back to front):")
            inks = {l.get("ink", "") for l in meta["layers"]}
            per_layer_ink = len(inks) > 1
            for i, l in enumerate(meta["layers"], 1):
                line = (
                    f"  {i}. {l['icon']} · {l['license'] or 'see collection'} · "
                    f"size {l['size']} at {l['x']},{l['y']} · {l['rotation']} deg"
                )
                if per_layer_ink and l.get("ink"):
                    line += f" · {l['ink']}"
                lic_lines.append(line)
        def label_line(lab: dict) -> str:
            return (f"{lab.get('value', '')!r} · {lab.get('font', '')}"
                    f"{' bold' if lab.get('bold') else ''} · {lab.get('colour', '')}"
                    f" · size {lab.get('size')} · at {lab.get('x')},{lab.get('y')}"
                    f" · {lab.get('rot') or 0} deg")

        if len(meta["labels"]) == 1:
            lic_lines.append("Label:      " + label_line(meta["labels"][0]))
        elif meta["labels"]:
            lic_lines.append("Labels (back to front):")
            for i, lab in enumerate(meta["labels"], 1):
                lic_lines.append(f"  {i}. " + label_line(lab))
        z.writestr("LICENSE.txt", "\n".join(lic_lines))
    buf.seek(0)
    headers = {"Content-Disposition": f'attachment; filename="{name}-iconset.zip"'}
    return StreamingResponse(buf, media_type="application/zip", headers=headers)


# ---------------------------------------------------------------- design library
# Every icon composed in the page is filed here as JSON state + a thumbnail, so a
# previous icon can be reopened and tweaked instead of rebuilt. State is the same
# shape the page keeps in localStorage (bg/fg/shape/text/layers with the glyph SVG
# bodies inlined), which makes "load" a plain apply — no re-search, no network.
DESIGNS_DIR = DATA_DIR / "designs"
_DESIGN_ID = re.compile(r"^[0-9a-f]{12}$")
MAX_DESIGN_BYTES = 4 * 1024 * 1024


def _design_path(did: str) -> Path:
    return DESIGNS_DIR / f"{did}.json"


def _read_design(did: str) -> dict | None:
    p = _design_path(did)
    if not p.exists():
        return None
    try:
        rec = json.loads(p.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    return rec if isinstance(rec, dict) else None


def _write_design(rec: dict) -> None:
    DESIGNS_DIR.mkdir(parents=True, exist_ok=True)
    tmp = DESIGNS_DIR / f".{rec['id']}.json.tmp"
    tmp.write_text(json.dumps(rec, ensure_ascii=False), encoding="utf-8")
    tmp.replace(_design_path(rec["id"]))


def _design_summary(rec: dict) -> dict:
    return {
        "id": rec.get("id", ""),
        "name": rec.get("name", ""),
        "updated": rec.get("updated", 0),
        "created": rec.get("created", 0),
        "glyphs": rec.get("glyphs", []),
        "bg": rec.get("bg", ""),
        "shape": rec.get("shape", ""),
        "has_thumb": bool(rec.get("thumb")),
    }


@app.get("/api/designs")
def designs(limit: int = Query(200, ge=1, le=1000)):
    DESIGNS_DIR.mkdir(parents=True, exist_ok=True)
    recs = []
    for p in DESIGNS_DIR.glob("*.json"):
        try:
            recs.append(json.loads(p.read_text(encoding="utf-8")))
        except (OSError, ValueError):
            continue
    recs = [_design_summary(r) for r in recs if isinstance(r, dict) and r.get("id")]
    recs.sort(key=lambda r: r["updated"], reverse=True)
    return {"designs": recs[:limit], "total": len(recs)}


@app.get("/api/designs/{design_id}")
def design(design_id: str):
    if not _DESIGN_ID.match(design_id):
        raise HTTPException(400, "bad design id")
    rec = _read_design(design_id)
    if not rec:
        raise HTTPException(404, "no such design")
    return rec


@app.get("/api/designs/{design_id}/thumb.png")
def design_thumb(design_id: str):
    if not _DESIGN_ID.match(design_id):
        raise HTTPException(400, "bad design id")
    thumb = DESIGNS_DIR / f"{design_id}.png"
    if not thumb.exists():
        raise HTTPException(404, "no thumbnail")
    return FileResponse(thumb, media_type="image/png",
                        headers={"Cache-Control": "no-store"})


@app.post("/api/designs")
async def save_design(payload: dict):
    """Create or update one design. Called by the page's autosave."""
    state = payload.get("state")
    if not isinstance(state, dict):
        raise HTTPException(400, "state required")
    glyphs = [g for g in (payload.get("glyphs") or []) if isinstance(g, str)][:12]
    if not glyphs:
        raise HTTPException(400, "a design needs at least one glyph")
    encoded = json.dumps(state, ensure_ascii=False)
    if len(encoded.encode("utf-8")) > MAX_DESIGN_BYTES:
        raise HTTPException(413, "design too large")

    did = payload.get("id")
    if not (isinstance(did, str) and _DESIGN_ID.match(did)):
        did = uuid.uuid4().hex[:12]

    now = time.time()
    prev = _read_design(did) or {}
    name = re.sub(r"\s+", " ", str(payload.get("name") or "")).strip()[:60] or "untitled"

    rec = {
        "id": did,
        "name": name,
        "created": prev.get("created") or now,
        "updated": now,
        "glyphs": glyphs,
        "bg": str(payload.get("bg") or "")[:20],
        "shape": str(payload.get("shape") or "")[:20],
        "state": state,
        "thumb": bool(prev.get("thumb")),
    }

    raw = payload.get("thumb") or ""
    if isinstance(raw, str) and raw.startswith("data:image/png;base64,"):
        try:
            img = Image.open(io.BytesIO(base64.b64decode(raw.split(",", 1)[1]))).convert("RGBA")
            img.thumbnail((160, 160), RESAMPLE)
            DESIGNS_DIR.mkdir(parents=True, exist_ok=True)
            buf = io.BytesIO()
            img.save(buf, format="PNG", optimize=True)
            (DESIGNS_DIR / f"{did}.png").write_bytes(buf.getvalue())
            rec["thumb"] = True
        except Exception:
            pass  # a missing thumbnail only costs the card preview

    _write_design(rec)
    return {"id": did, "name": name, "updated": now, "created": rec["created"]}


@app.delete("/api/designs/{design_id}")
def delete_design(design_id: str):
    if not _DESIGN_ID.match(design_id):
        raise HTTPException(400, "bad design id")
    removed = False
    for p in (_design_path(design_id), DESIGNS_DIR / f"{design_id}.png"):
        if p.exists():
            try:
                p.unlink()
                removed = True
            except OSError as e:
                raise HTTPException(500, f"could not remove {p.name}: {e}")
    if not removed:
        raise HTTPException(404, "no such design")
    return {"deleted": design_id}


@app.post("/api/launcher-icon")
async def launcher_icon(payload: dict):
    """Hand a composed icon back to the launcher that asked for it.

    The launcher opens this page with ?launcher=<origin>&slug=<slug> (right-click
    a card → Replace icon…). The page posts the composite SVG here and this
    endpoint forwards it to <launcher>/api/icon/<slug> server-to-server, so the
    launcher needs no CORS headers and the browser never talks cross-origin.
    """
    launcher = (payload.get("launcher") or "").strip().rstrip("/")
    slug = (payload.get("slug") or "").strip()
    svg = payload.get("svg") or ""
    parts = urllib.parse.urlsplit(launcher)
    if parts.scheme not in ("http", "https") or not parts.netloc or parts.path or parts.query:
        raise HTTPException(400, "launcher must be an origin like http://host:port")
    if not re.fullmatch(r"[a-z0-9][a-z0-9._-]{0,63}", slug):
        raise HTTPException(400, "invalid app slug")
    if not isinstance(svg, str) or "<svg" not in svg[:600].lower():
        raise HTTPException(400, "svg required")
    if len(svg.encode("utf-8")) > 200_000:
        raise HTTPException(413, "icon too large")
    # every label's face, not just the first text node
    svg = embed_label_fonts(svg, label_groups({}, svg))

    req = urllib.request.Request(
        f"{launcher}/api/icon/{slug}",
        data=json.dumps({"svg": svg, "source": "icon-library"}).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            body = json.loads(r.read() or b"{}")
        return JSONResponse({**body, "launcher": launcher}, status_code=200)
    except urllib.error.HTTPError as e:
        # Relay the launcher's own reason ("Standard apps keep their system icon",
        # "svg needs a viewBox…") so the composer can show it verbatim.
        try:
            detail = json.loads(e.read() or b"{}")
        except Exception:
            detail = {}
        raise HTTPException(e.code, detail.get("message") or f"launcher returned {e.code}")
    except Exception as e:
        raise HTTPException(502, f"launcher unreachable: {e}")


@app.get("/")
def index():
    # no-store: the page is edited in place, and a heuristic-cached copy silently
    # serves the old layout after a change.
    #
    # `{{asset_v}}` stamps the stylesheet/app.js links with the newest asset mtime.
    # no-store on /static is not enough on its own: a copy cached before that
    # header existed is still reusable, and a stale app.js or styles.css makes a
    # new control invisible (the preset swatches collapsed to zero-size buttons) —
    # that looked exactly like the feature never shipped. A changed URL cannot be
    # served from cache.
    try:
        stamp = str(max(int(p.stat().st_mtime) for p in (
            STATIC / "app.js", STATIC / "styles.css",
            STATIC / "fonts" / "ui" / "ui.css", STATIC / "fonts" / "label" / "label.css",
        )))
    except OSError:
        stamp = "0"
    html = (ROOT / "index.html").read_text(encoding="utf-8").replace("{{asset_v}}", stamp)
    return Response(html, media_type="text/html",
                    headers={"Cache-Control": "no-store"})


class NoStoreStatic(StaticFiles):
    """Serve static assets with `no-store`.

    Starlette's StaticFiles sends only ETag/Last-Modified, which lets a browser
    reuse a heuristically cached app.js/styles.css — so a newly shipped panel
    (the launcher's colour-preset row) silently does not appear even after a
    page reload. These files are edited in place; always revalidate them.
    """

    async def get_response(self, path, scope):
        resp = await super().get_response(path, scope)
        resp.headers["Cache-Control"] = "no-store"
        return resp


@app.get("/api/launcher-groups")
def launcher_groups(launcher: str = Query(..., max_length=200)):
    """The launcher's group palette as `key~name~#hex|…`, for a stale editor link.

    The launcher normally passes this in the URL it opens (`presets=`), but a
    browser window still running an older launcher build passes nothing — then
    read it from the things that own it: `/api/groups` for the display names and
    the launcher's own `main.js` for GROUP_COLORS (that dict is the single source
    of truth for the colours). Server-side, so the page needs no CORS.
    """
    launcher = (launcher or "").strip().rstrip("/")
    parts = urllib.parse.urlsplit(launcher)
    if parts.scheme not in ("http", "https") or not parts.netloc or parts.path or parts.query:
        raise HTTPException(400, "launcher must be an origin like http://host:port")
    try:
        with urllib.request.urlopen(f"{launcher}/api/groups", timeout=8) as r:
            groups = json.loads(r.read() or b"{}")
        with urllib.request.urlopen(f"{launcher}/main.js", timeout=8) as r:
            js = r.read().decode("utf-8", "replace")
    except Exception as e:
        raise HTTPException(502, f"launcher unreachable: {e}")

    block = re.search(r"GROUP_COLORS\s*=\s*\{(.*?)\};", js, re.S)
    colours = dict(re.findall(r'"([a-z0-9-]+)"\s*:\s*"(#[0-9a-fA-F]{6})"', block.group(1))) if block else {}
    if not colours:
        raise HTTPException(404, "could not read GROUP_COLORS from the launcher")

    ordered = sorted(groups.items(), key=lambda kv: (kv[1] or {}).get("order", 99))
    presets = [f"{k}~{(meta or {}).get('name') or k}~{colours[k]}"
               for k, meta in ordered if k in colours]
    # Groups the colour dict knows but GROUPS does not (e.g. a just-removed group)
    # still get a swatch — losing a colour is worse than an extra swatch.
    presets += [f"{k}~{k}~{v}" for k, v in colours.items() if k not in groups]
    return {"presets": "|".join(presets)}


app.mount("/static", NoStoreStatic(directory=STATIC), name="static")


if __name__ == "__main__":
    import os

    import uvicorn

    PORT = int(os.environ.get("PORT", "7876"))
    HOST = os.environ.get("HOST", "127.0.0.1")
    if DB_PATH.exists():
        print(f"Icon Library on http://{HOST}:{PORT} - {len(COLLECTIONS)} collections, "
              f"{DB_PATH.stat().st_size / 1e6:.1f} MB index")
    else:
        print("Icon Library - index missing, run: python3 sync_data.py")
    uvicorn.run(app, host=HOST, port=PORT)
