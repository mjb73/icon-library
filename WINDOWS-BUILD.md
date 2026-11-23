# Windows build and installer

The Windows artifact is a frozen PyInstaller build wrapped in an Inno Setup
installer. End users get `IconLibrary-Setup-<version>.exe`: no Python, no
network, no admin rights (it installs per-user by default).

## What the installed app does

- Installs to `%LocalAppData%\Programs\Icon Library` (or `Program Files` when
  started as admin).
- Contains the frozen interpreter, `static/` (40 label fonts, 10 UI fonts) and
  the 66 MB `data/icons.db` index — nothing is downloaded at run time.
- Writes design records and the live-icon cache to
  `%LocalAppData%\IconLibrary\{designs,live}` (`server.py` reads
  `ICON_LIBRARY_DATA` / `ICON_LIBRARY_DB` for this), so the app keeps working
  from a read-only install directory and uninstalling never deletes designs.
- `desktop.py` binds `127.0.0.1:7876` (next free port if taken), opens the
  default browser, and logs to the console window; closing the window stops the
  server.

## Build (must run on Windows x64)

Python 3.12–3.14, 64-bit. `desktop.py` and `build_win.spec` are in the repo root.

```bat
py -3.12 -m venv .build
.build\Scripts\python -m pip install -r requirements.txt pyinstaller
.build\Scripts\python -m PyInstaller --noconfirm --clean ^
    --distpath build\win --workpath build\tmp build_win.spec
```

Result: `build\win\Icon Library\Icon Library.exe` + `_internal\`.

`build_win.spec` bundles `static/`, `index.html` and `data/icons.db` and collects
all `uvicorn` / `fontTools` submodules (both import parts of themselves by string,
so a plain analysis misses `uvicorn.loops.auto`, `uvicorn.protocols.*` and the
fontTools table modules).

## Installer

Install [Inno Setup 6](https://jrsoftware.org/isdl.php), then from the repo root:

```bat
"C:\Program Files (x86)\Inno Setup 6\ISCC.exe" icon-library.iss
```

Result: `Output\IconLibrary-Setup-<version>.exe`. The version lives in
`#define AppVersion` at the top of `icon-library.iss`; bump it and the spec
before publishing, then attach the setup exe to a GitHub release:

```bat
gh release create v1.0.0 Output\IconLibrary-Setup-1.0.0.exe ^
   --title "Icon Library 1.0.0" --notes "Windows installer"
```

The `.iss` uses `Compression=lzma2/max`, which takes several minutes on a 138 MB
payload — that is normal.

## Cross-building on Linux (what was actually used, Wine 11 + CPython 3.12.10)

```bash
export WINEPREFIX=$HOME/.wine-iconlib WINEDEBUG=-all
wine python-3.12.10-amd64.exe /quiet InstallAllUsers=0 Include_test=0
PY=$WINEPREFIX/drive_c/users/$USER/AppData/Local/Programs/Python/Python312/python.exe
wine "$PY" -m pip install --no-index --find-links vendor/wheels \
     -r requirements.txt                      # Windows wheels are committed
/usr/bin/python3 -m pip download -d wheels-win --only-binary=:all: \
     --platform win_amd64 --python-version 3.12 pyinstaller pefile pywin32-ctypes pyinstaller-hooks-contrib
```

Two traps: `pip download` on Linux honours platform markers, so `pefile` and
`pywin32-ctypes` (win32-only PyInstaller deps) must be fetched explicitly; and
Inno Setup binaries are no longer on `files.jrsoftware.org` — they ship as
GitHub release assets on `jrsoftware/issrc` (`is-6_7_4/innosetup-6.7.4.exe`).

## Verification performed (Wine, frozen build)

- `GET /api/health` → 127,374 icons, 30 collections, 68.9 MB index.
- `GET /api/search?q=umbrella` → 81 hits, 5 returned.
- `POST /api/export` → 16-entry zip (12 PNGs, `.ico`, `.svg`, `recipe.json`,
  `LICENSE.txt`); the SVG carries an embedded subset `@font-face`, which proves
  `fontTools` and the bundled label fonts survived freezing.
- `POST /api/designs` → record + 160 px thumbnail written to
  `%LocalAppData%\IconLibrary\designs`.

Not verified anywhere: a real Windows machine, and the wizard UI of the
installer (it was compiled headless and tested silent-installed).
