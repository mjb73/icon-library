"""Desktop entry point for the standalone (frozen) Windows build.

`server.py` is the app. This wrapper exists only for the packaged build:

* the icon index ships read-only next to the executable, while design records
  and the live-icon cache are written to ``%LOCALAPPDATA%\\IconLibrary`` so the
  app works from ``Program Files`` without admin rights;
* it opens the browser once the port answers, so double-clicking the icon is
  the whole install experience;
* it picks the next free port if 7876 is taken and prints the URL it settled on.

Running it from source behaves the same way, minus the LOCALAPPDATA redirect.
"""

from __future__ import annotations

import os
import socket
import sys
import threading
import time
import webbrowser
from pathlib import Path

PREFERRED_PORT = 7876
APP_NAME = "Icon Library"


def frozen_root() -> Path:
    """Directory holding the bundled index/static for a frozen build."""
    meipass = getattr(sys, "_MEIPASS", None)
    if meipass:
        return Path(meipass)
    return Path(__file__).resolve().parent


def user_data_dir() -> Path:
    base = os.environ.get("LOCALAPPDATA") or os.environ.get("APPDATA")
    if not base:
        base = str(Path.home() / ".local" / "share")
    d = Path(base) / "IconLibrary"
    d.mkdir(parents=True, exist_ok=True)
    return d


def free_port(preferred: int) -> int:
    for port in range(preferred, preferred + 40):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            try:
                s.bind(("127.0.0.1", port))
            except OSError:
                continue
            return port
    raise SystemExit(f"no free port in {preferred}-{preferred + 39}")


def wait_for_port(port: int, timeout: float = 60.0) -> bool:
    deadline = time.time() + timeout
    while time.time() < deadline:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.settimeout(0.5)
            if s.connect_ex(("127.0.0.1", port)) == 0:
                return True
        time.sleep(0.15)
    return False


def main() -> None:
    root = frozen_root()
    bundled_db = root / "data" / "icons.db"

    if getattr(sys, "frozen", False):
        data_dir = user_data_dir()
        os.environ.setdefault("ICON_LIBRARY_DATA", str(data_dir))
        if bundled_db.exists():
            os.environ.setdefault("ICON_LIBRARY_DB", str(bundled_db))
        # Anything else the app writes (live-icon cache) belongs with the designs.
        os.chdir(root)

    if not bundled_db.exists() and not Path(os.environ.get("ICON_LIBRARY_DB", "")).exists():
        print("The icon index (data\\icons.db) is missing from this installation.")
        input("Press Enter to close.")
        raise SystemExit(1)

    port = free_port(int(os.environ.get("PORT") or PREFERRED_PORT))
    os.environ["PORT"] = str(port)
    os.environ["HOST"] = "127.0.0.1"

    import uvicorn  # imported late: the path setup above must happen first

    import server  # noqa: E402  (builds the FastAPI app at import)

    print(f"\n  {APP_NAME} - http://127.0.0.1:{port}")
    print("  Keep this window open while you use the app; close it to stop.\n")

    config = uvicorn.Config(server.app, host="127.0.0.1", port=port,
                            log_level="warning", access_log=False)
    srv = uvicorn.Server(config)
    t = threading.Thread(target=srv.run, name="uvicorn", daemon=True)
    t.start()

    if wait_for_port(port, timeout=45):
        try:
            webbrowser.open(f"http://127.0.0.1:{port}/")
        except Exception:
            pass

    try:
        while t.is_alive():
            time.sleep(0.5)
    except KeyboardInterrupt:
        srv.should_exit = True
        t.join(timeout=5)


if __name__ == "__main__":
    main()
