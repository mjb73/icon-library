# -*- mode: python ; coding: utf-8 -*-
"""PyInstaller spec for the Windows desktop build of Icon Library.

Build (from a Windows CPython 3.12 64-bit with the requirements + pyinstaller):

    pyinstaller --noconfirm --clean build_win.spec

The result is `dist/Icon Library/` (onedir on purpose: the 66 MB SQLite index is
shipped as a plain file by the Inno Setup installer instead of being re-extracted
from a onefile archive on every launch).
"""

from PyInstaller.utils.hooks import collect_submodules

hiddenimports = collect_submodules("uvicorn") + collect_submodules("fontTools")

datas = [
    ("static", "static"),
    ("index.html", "."),
    ("data/icons.db", "data"),
]

a = Analysis(
    ["desktop.py"],
    pathex=[],
    binaries=[],
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    runtime_hooks=[],
    excludes=["tkinter", "matplotlib", "numpy", "pytest", "IPython"],
    noarchive=False,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="Icon Library",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=True,
    disable_windowed_traceback=False,
    icon="icon-library.ico",
)

coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=False,
    name="Icon Library",
)
