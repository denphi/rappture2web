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


def _parse_nanohub_resources():
    """Parse nanoHUB SESSIONDIR/resources into a dict.

    Returns {} when not on nanoHUB or the file is missing.
    """
    session, sessiondir = _get_session()
    if not session or not sessiondir:
        return {}

    fn = os.path.join(sessiondir, "resources")
    if not os.path.exists(fn):
        return {}

    values = {"session": session}
    with open(fn) as f:
        for line in f:
            parts = line.strip().split(" ", 1)
            if len(parts) != 2:
                continue
            key, value = parts
            values[key] = value.strip().strip('"')
    return values


def _get_proxy_addr(port):
    """Parse nanoHUB resources file and return (base_path, proxy_url).

    Returns (None, None) when not running on nanoHUB or resources file missing.
    """
    resources = _parse_nanohub_resources()
    hub_url = resources.get("hub_url")
    fxc = resources.get("filexfer_cookie")
    session = resources.get("session")
    fxp = None
    if resources.get("filexfer_port"):
        try:
            full_port = int(resources["filexfer_port"])
            fxp = str(full_port % 1000)
        except ValueError:
            fxp = None

    if not (hub_url and fxp and fxc and session):
        return None, None

    base_path = "/weber/{}/{}/{}/".format(session, fxc, fxp).rstrip("/")
    proxy_url = "https://proxy." + hub_url.split("//", 1)[1] + base_path + "/"
    return base_path, proxy_url


def _nanohub_urls():
    """Return detected nanoHUB support/terminate URLs or empty strings."""
    resources = _parse_nanohub_resources()
    hub_url = resources.get("hub_url", "").rstrip("/")
    sessionid = resources.get("sessionid")
    app_name = resources.get("application_name", "").strip()
    if not app_name and resources.get("appname"):
        app_name = resources.get("appname", "").strip()
    if app_name.startswith("app-"):
        app_name = app_name[4:]
    app_name = app_name.strip().lower()

    support_url = ""
    terminate_url = ""
    if hub_url and app_name:
        support_url = f"{hub_url}/feedback/report_problems?group=app-{app_name}"
    if hub_url and app_name and sessionid:
        terminate_url = f"{hub_url}/tools/{app_name}/stop?sess={sessionid}"
    return support_url, terminate_url


def _resolve_nanohub_urls():
    """Resolve support/terminate URLs with environment overrides."""
    detected_support_url, detected_terminate_url = _nanohub_urls()
    support_url = os.environ.get("NANOHUB_SUPPORT_URL")
    terminate_url = os.environ.get("NANOHUB_TERMINATE_URL")
    if support_url is None:
        support_url = detected_support_url
    if terminate_url is None:
        terminate_url = detected_terminate_url
    return support_url or "", terminate_url or ""


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
    nanohub_support_url, nanohub_terminate_url = _resolve_nanohub_urls()

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
        nanohub_support_url=nanohub_support_url,
        nanohub_terminate_url=nanohub_terminate_url,
    )

    print("Loading tool: {}".format(tool_path))
    print("Starting server at {}".format(server_url))
    if args.library_mode:
        print("Library mode: tool scripts receive server URL instead of driver.xml")
    print("Run cache directory: {}".format(cache_dir))
    if proxy_url:
        print("nanoHUB proxy URL: {}".format(proxy_url))
    if nanohub_support_url:
        print("nanoHUB support URL: {}".format(nanohub_support_url))
    if nanohub_terminate_url:
        print("nanoHUB terminate URL: {}".format(nanohub_terminate_url))

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
