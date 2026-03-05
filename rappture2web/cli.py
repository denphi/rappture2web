"""CLI entry point for Rappture2Web."""

from __future__ import annotations

import argparse
import os
import shutil
import sys
from pathlib import Path


def _get_session():
    """Return (session_id, sessiondir) from nanoHUB environment variables."""
    sessiondir = os.environ.get("SESSIONDIR") or os.environ.get("SESSION_DIR", "")
    if not sessiondir:
        return None, None
    # Session ID is the last path component of sessiondir
    session = os.path.basename(sessiondir.rstrip("/"))
    return session, sessiondir


def _get_proxy_addr(port):
    """Parse nanoHUB resources file and return (base_path, proxy_url).

    Returns (None, None) when not running on nanoHUB or resources file missing.
    """
    session, sessiondir = _get_session()
    if not session or not sessiondir:
        return None, None

    fn = os.path.join(sessiondir, "resources")
    if not os.path.exists(fn):
        return None, None

    hub_url = fxp = fxc = None
    with open(fn) as f:
        for line in f:
            if line.startswith("hub_url"):
                hub_url = line.split(" ", 1)[1].strip().replace('"', "")
            elif line.startswith("filexfer_port"):
                full_port = int(line.split()[1])
                fxp = str(full_port % 1000)
            elif line.startswith("filexfer_cookie"):
                fxc = line.split()[1]

    if not (hub_url and fxp and fxc):
        return None, None

    base_path = "/weber/{}/{}/{}/".format(session, fxc, fxp).rstrip("/")
    proxy_url = "https://proxy." + hub_url.split("//", 1)[1] + base_path + "/"
    return base_path, proxy_url


def main():
    parser = argparse.ArgumentParser(
        description="Rappture2Web: Run Rappture tools as web applications",
    )
    parser.add_argument(
        "tool_xml",
        help="Path to the Rappture tool.xml file",
    )
    parser.add_argument(
        "--port", "-p",
        type=int,
        default=8001,
        help="Port to serve on (default: 8001)",
    )
    parser.add_argument(
        "--host",
        default="127.0.0.1",
        help="Host to bind to (default: 127.0.0.1)",
    )
    parser.add_argument(
        "--no-browser",
        action="store_true",
        help="Don't open browser automatically",
    )
    parser.add_argument(
        "--cache-dir",
        default=None,
        help="Directory for persisting run history to disk",
    )
    parser.add_argument(
        "--no-cache",
        action="store_true",
        help="Disable run caching (re-run even for identical inputs)",
    )
    parser.add_argument(
        "--library-mode",
        action="store_true",
        help="Pass server URL as argv[1] to tool scripts instead of driver.xml "
             "(requires tool script to use rappture2web.rp_library)",
    )
    parser.add_argument(
        "--base-path",
        default="",
        help="Base URL path prefix when served behind a reverse proxy "
             "(e.g. /mytool). No trailing slash. Auto-detected on nanoHUB.",
    )
    parser.add_argument(
        "--wrwroxy",
        action="store_true",
        help="Enable automatic wrwroxy launch on nanoHUB (disabled by default).",
    )

    args = parser.parse_args()

    tool_path = Path(args.tool_xml).resolve()
    if not tool_path.exists():
        print("Error: {} not found".format(tool_path), file=sys.stderr)
        sys.exit(1)

    # Default cache dir: .rappture2web/ next to the tool XML
    cache_dir = args.cache_dir or str(tool_path.parent / ".rappture2web")

    # ── Proxy / base-path detection ──────────────────────────────────────────
    base_path = args.base_path.rstrip("/")
    proxy_url = None

    if not base_path:
        detected_path, detected_proxy = _get_proxy_addr(args.port)
        if detected_path:
            base_path = detected_path
            proxy_url = detected_proxy

    # On nanoHUB the app runs on args.port (8001) and wrwroxy forwards from 8000
    use_wrwroxy = args.wrwroxy and (shutil.which("wrwroxy") is not None)

    from .app import app, set_tool

    server_url = proxy_url if proxy_url else "http://{}:{}{}".format(
        args.host, args.port, base_path
    )

    set_tool(
        xml_path=str(tool_path),
        cache_dir=cache_dir,
        server_url=server_url,
        use_library_mode=args.library_mode,
        use_cache=not args.no_cache,
        base_path=base_path,
    )

    print("Loading tool: {}".format(tool_path))
    print("Starting server at {}".format(server_url))
    if args.library_mode:
        print("Library mode: tool scripts receive server URL instead of driver.xml")
    print("Run cache directory: {}".format(cache_dir))
    if proxy_url:
        print("nanoHUB proxy URL: {}".format(proxy_url))

    # Open browser only when not behind a proxy and not suppressed
    if not args.no_browser and not base_path:
        import webbrowser
        import threading
        threading.Timer(1.2, webbrowser.open, args=[server_url]).start()

    # Start wrwroxy if available on nanoHUB (forwards port 8000 → args.port)
    if use_wrwroxy:
        import subprocess
        subprocess.Popen([
            "wrwroxy",
            str(args.port),       # upstream port
            "8000",               # listen port
            base_path.lstrip("/"),
        ])

    import uvicorn
    uvicorn.run(app, host=args.host, port=args.port, log_level="info",
                root_path=base_path)


if __name__ == "__main__":
    main()
