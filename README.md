# Icon Library

Search 127,000+ open-source icons across 30 bundled collections, then compose one
into a finished app icon: colour-wheel background, contrast-matched or custom icon
colour, optional grayscale, shape (squircle / circle / square / full), optional
label, icon scale and rotation — rendered at 1024², previewed at 200 px, exported
as a ready icon set.

Sibling app to Icon Studio (:7895), which generates icon *artwork* with FLUX. This one
takes existing open-source *glyphs* and composes them.

Everything needed to run is in the repo: the icon index, 40 label fonts, the UI
fonts, and the Python wheels. Install and start it with no downloads.

## Requirements

- Python **3.12, 3.13 or 3.14** (64-bit) — nothing else, no network.
- A current Chrome, Edge, Firefox or Safari.

## Run

**Windows — installer**

Download `IconLibrary-Setup-<version>.exe` from
[Releases](https://github.com/mjb73/icon-library/releases) and run it. No Python
is needed: the installer carries the interpreter, the index and the fonts, and
installs per-user (no admin prompt). It puts an Icon Library shortcut in the
Start menu (and on the Desktop if you tick the box) and opens
http://127.0.0.1:7876. Designs are kept in `%LocalAppData%\IconLibrary\designs`,
so uninstalling never deletes them.

**Windows — from source**

```bat
install.bat
run.bat
```

`run.bat` opens http://127.0.0.1:7876 once the server is up. If Windows asks
about Python, install it from python.org and tick *Add python.exe to PATH*.
Building the installer yourself: see `WINDOWS-BUILD.md`.

**Linux / macOS**

```bash
./install.sh
./run.sh          # http://127.0.0.1:7876
```

Both installers create `venv/` and install the pinned versions from
`vendor/wheels/` (Linux x86-64 and Windows x64, CPython 3.12–3.14). The server
binds to localhost by default; `HOST=0.0.0.0 ./run.sh` exposes it on the LAN and
`PORT=8000` changes the port.

## What is bundled

| Path | What | Why it is committed |
| --- | --- | --- |
| `data/icons.db` | 127,374 icons, 66 MB SQLite + FTS5 index | search and rendering work on first launch |
| `static/fonts/label/` | 40 label families (TTF/OTF, regular + bold) | identical preview and export on every OS |
| `static/fonts/ui/` | the 10 UI families (WOFF2) | no Google Fonts CDN at runtime |
| `vendor/wheels/` | FastAPI, Uvicorn, Pillow, fontTools + transitives | offline `pip install` |
| `static/icons` / code | the app | — |

`data/raw/` (92 MB of upstream collection JSON) is not committed: it is a cache
for `sync_data.py`, and the built database is what the app reads. Rebuilding
needs network access:

```bash
python3 sync_data.py            # 30 curated collections (rebuilds data/icons.db)
python3 sync_data.py --all      # every Iconify collection (243, ~415k icons)
python3 sync_data.py lucide mdi # rebuild with a specific subset
python3 sync_data.py --refresh  # re-download cached collection JSON
```

`data/live/` caches icons fetched from Iconify; `data/designs/` holds saved
designs. Neither is committed.

Hidden (`"hidden": true`) icons are skipped: they are deprecated/duplicate variants that
only add noise to search.

## Fonts

The label picker has 40 families — 10 sans, 4 serif, 6 mono, 12 display, 3 script,
5 retro/pixel — and every name in the list is drawn in its own face. The faces are
served from `static/fonts/label/label.css`, so the browser canvas, the exported
PNG and an SVG viewer all get the same file on Windows, macOS and Linux. No font
installation step exists (or is needed).

The dropdown is a custom listbox, not a native `<select>`: browsers disagree on
whether `font-family` on `<option>` is honoured (Firefox/GTK opens a system menu).
The hidden `<select>` remains the source of truth and the list is attached to
`<body>` so no scrolling panel can clip it.

Adding a family means editing three things: an entry in `FONT_STACKS`
(`static/app.js`), an `<option>` under the matching `<optgroup>` (`index.html`),
and a font file + `@font-face` rule in `static/fonts/label/`. Ids are persisted in
saved designs, so keep old keys. Avoid Bitstream Vera and the non-`Mono`
Fantasque cut: they are pixel-identical to DejaVu and Fantasque Mono.

`static/fonts/label/manifest.json` is the machine-readable list (id, family,
regular/bold files, variable flag). The server uses it to embed the label font in
exported SVG.

## API

| Endpoint | Purpose |
| --- | --- |
| `GET /api/health` | icon count, collections, db size, live-fallback reachable |
| `GET /api/collections` | bundled collections with licence metadata + counts |
| `GET /api/search?q=&limit=&offset=&sets=a,b&live=1` | FTS5 search; bodies inline for bundled hits, `remote` URL for live hits |
| `GET /api/icon/{prefix}/{name}` | single icon as SVG (local, else proxied) |
| `POST /api/export` | body: `{png: dataURL, svg, name, icon, collection, license, ...}` → zip |
| `GET /api/designs` | saved designs, newest first (id, name, glyphs, bg, shape, updated) |
| `GET /api/designs/{id}` | one design, full state (colours, shape, label, every layer) |
| `GET /api/designs/{id}/thumb.png` | 160 px stage thumbnail for the card |
| `POST /api/designs` | body: `{id?, name, glyphs[], bg, shape, state, thumb}` → create/update |
| `DELETE /api/designs/{id}` | remove a design and its thumbnail |

Search is local-first. Anything the bundle does not cover is pulled from
`api.iconify.design/search` and thumbnailed straight from the Iconify CDN, so the app
still searches all 243 collections when online and works fully offline for the 30
bundled ones.

## Saved designs

Every icon that reaches a composable state files itself into a library about a second
after the last change (`data/designs/<id>.json` + `<id>.png`), so a previous icon is
reopened and adjusted instead of rebuilt. The record holds the whole composer state —
background, icon colour, shape, transparency, every layer's glyph with its own size,
position and rotation, and the label — plus the SVG bodies, so restoring needs no
re-search and works offline.

- The **Saved** tab lists them as cards (stage thumbnail, name, glyph, age). Tap to
  open; it becomes the working design, and further edits update that same record.
- `+ New design` keeps the background colour and shape (the family look) and clears
  the glyphs and label.
- The record id rides in `localStorage`, so a reload continues the same design rather
  than spawning a duplicate, and an old single-design `localStorage` payload is filed
  into the library on first load.
- Deleting is a two-tap arm-then-confirm on the card's ✕ (no dialog).
- Export always saves first, so every exported icon is in the library.

## Export

`POST /api/export` returns `<name>-iconset.zip`:

- PNG 1024, 512, 384, 256, 192, 180, 144, 128, 96, 72, 48, 32 (Lanczos, transparent
  outside the shape)
- `<name>.ico` with 16/24/32/48/64/128/256 frames
- `<name>.svg` — the same composite, vector, with a `saturate=0` filter when grayscale
  and the label font subset to the label's characters, embedded as a data URI
- `LICENSE.txt` — icon id, collection, licence + URL, author, and the settings used
- `recipe.json` — machine-readable copy of the same (includes inset and rotation)

The label subset keeps the SVG portable: the text survives on a machine that has
none of the 40 faces, which matters most on Windows. A two-character label adds
roughly 5–15 KB instead of the 200 KB–2.6 MB a whole face would cost.

## Copy to clipboard

The `Copy` button puts the finished icon on the clipboard as a 256 × 256 PNG
(plus `text/html` and the SVG markup as `text/plain`), so pasting into a document,
a chat or an image editor gives the picture rather than the SVG source.

A browser only allows an image on the clipboard from a **secure context**:
`http://127.0.0.1:7876` or an `https://` URL. Over a plain-`http` LAN or tailnet
address no browser API can write a bitmap, so the button copies the SVG markup
instead and says why in the export note.

## Sizing

200 × 200 is not a platform size — it is a comfortable preview tile, and the stage shows
200 px. The master render is 1024² (vector-driven, so lossless), which is what iOS/macOS
want as a source; 512 covers Play Store and PWA, 192 the PWA minimum and Android
xxxhdpi, 180 the Apple touch icon, 256 the .ico ceiling, 48/32/16 favicons.

## Rendering notes

- The stage is a 1024² canvas; the icon is rasterised from its own SVG at target size,
  then (optionally) luminance-converted with alpha preserved, then composited.
- Grayscale only visibly changes multicolour sets (logos, devicon, game-icons,
  simple-icons); monochrome stroke icons are single-colour already.
- Icon colour is **per layer**: each glyph in a composite carries its own `ink`, so a
  two-glyph icon can be red + cyan. `auto` on a layer means "follow the background"
  (WCAG contrast pick of white / near-black) and tracks a background change live; a
  picked colour is frozen onto that layer and survives background changes and glyph
  swaps. `all layers` copies the active layer's colour onto every glyph. It paints
  `currentColor` only — palette icons keep their own colours.
- Ink is stored per layer as `ink` (`null` = auto). A record saved before per-layer ink
  existed is migrated by freezing its one global `fg` onto every layer when `autoFg`
  was off, so old designs look identical.
- The exported SVG uses the same rounded box and pixel origin as the canvas, so SVG and
  PNG agree to within edge antialiasing (~0.4% of pixels, 1 px wide).
- Shapes: squircle = sampled superellipse (n=4), circle (n=2), square r=10%, full r=0.
- Rotation (0–359°) is applied about the canvas centre, icon only — background unaffected.
  Canvas and SVG use the same transform chain, so a rotated export matches the preview:
  `translate(512,512) rotate(deg) translate(-w2/2,-h2/2) scale(...)`. Diffed at 37°:
  0.27% of pixels differ, 1 interior pixel — antialiasing only.
- Control order is fixed by workflow: Icon size, Rotation, Background, Icon colour,
  Grayscale, Shape, Export. Keep the scale and rotation sliders above the wheel — at
  1366×768 anything below the wheel is off-screen.
- Transparent background: `Background [switch] transparent` omits the shape entirely — canvas
  stays alpha-0 outside the icon, the SVG drop the background element, and the wheel and shape
  picker go inert (dimmed, not hidden, so the panel does not reflow). The contrast read-out
  becomes `no bg` because there is nothing to measure against.
- Label text is measured only after its face is loaded (`document.fonts.load`), so the
  first paint of a switched font cannot freeze fallback metrics into the export.
- Both colours are edited the same way: hex text field + native swatch, uppercase hex
  (#1E6F8C / #FFFFFF), never RGB. There is exactly one writer per colour
  (`applyBg()` → `syncFgUI()` for the icon, `syncFgUI()` alone for background-driven
  auto-contrast), so the field, the swatch and the contrast ratio can never disagree.

## The viewBox trap (important if you touch sync_data.py)

An Iconify collection's **top-level** `width`/`height` hold the viewBox — not
`info.height`, which is the *display* height. They disagree for ph (24 vs 256), ion
(32 vs 512), carbon (16 vs 32) and others; using `info.height` renders those icons
invisible because their geometry is drawn far outside a 24-unit viewBox. Sets that omit
top-level dimensions (bi, tabler) do use `info.height`. Rule applied:

```python
cw = raw.get("width") or raw.get("height") or info.get("height") or 16
```

## Launcher integration (optional)

The app can act as an icon picker for a local dashboard: open it with
`?launcher=http://host:port&slug=…`, and *Save* posts the composite SVG to
`/api/launcher-icon`, which forwards it server-to-server. Nothing is required for
standalone use.

## Licence

The app's code is MIT — see `LICENSE`. Bundled icons, fonts and wheels keep their
own licences; see `THIRD-PARTY-NOTICES.md` and the `licenses/` folders under
`static/fonts/`.
