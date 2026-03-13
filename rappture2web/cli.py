"""CLI entry point for Rappture2Web."""

from __future__ import annotations

import argparse
import os
import shutil
import sys
from pathlib import Path


def _find_wrwroxy():
    # type: () -> str or None
    """
    Find an available wrwroxy version using 'use'.

    The 'use' command prints available packages to stderr.
    Returns the version string (e.g. 'wrwroxy-0.3') or None if not found.
    """
    import subprocess

    try:
        result = subprocess.run(
            ["bash", "-lc", "use"],
            capture_output=True, text=True, timeout=10
        )
        available = result.stderr.strip()
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired, FileNotFoundError):
        return None

    # Collect all wrwroxy-* entries
    # The 'use' output format is "package-version:" so strip trailing colons
    versions = []
    for token in available.split():
        token = token.strip().rstrip(":")
        if token.startswith("wrwroxy-"):
            versions.append(token)

    if not versions:
        return None

    # Sort descending so the newest version is tried first
    versions.sort(reverse=True)
    print("Available wrwroxy versions: {}".format(", ".join(versions)), flush=True)
    return versions[0]


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


def _resolve_nanohub_tool_name(resources: dict | None = None):
    """Return normalized nanoHUB tool name used in /tools/* and /resources/* URLs."""
    env_name = os.environ.get("NANOHUB_TOOL_NAME")
    if env_name:
        name = env_name.strip().lower()
        return name[4:] if name.startswith("app-") else name

    resources = resources or _parse_nanohub_resources()
    app_name = (resources.get("application_name") or resources.get("appname") or "").strip().lower()
    if app_name.startswith("app-"):
        app_name = app_name[4:]
    return app_name


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
    parser.add_argument(
        "--app-name",
        default=None,
        help="Application name (used for nanoHUB URLs, e.g. 'mytool'). "
             "Overrides auto-detected tool name.",
    )
    parser.add_argument(
        "--cache-url",
        default="",
        help="Base URL of a remote cache service (e.g. http://cache-host:8080). "
             "When set, results are looked up before running and stored after success.",
    )
    parser.add_argument(
        "--verbose",
        action="store_true",
        help="Enable verbose/debug logging to stdout.",
    )

    args = parser.parse_args()

    tool_path = Path(args.tool_xml).resolve()
    if not tool_path.exists():
        print("Error: {} not found".format(tool_path), file=sys.stderr)
        sys.exit(1)

    # Default cache dir: prefer $RESULTSDIR (writable on nanoHUB), then tool dir
    _results_dir = os.environ.get("RESULTSDIR", "").strip()
    _default_cache = str(Path(_results_dir) / ".rappture2web") if _results_dir else str(tool_path.parent / ".rappture2web")
    cache_dir = args.cache_dir or _default_cache

    # ── Proxy / base-path detection ──────────────────────────────────────────
    base_path = args.base_path.rstrip("/")
    proxy_url = None

    if not base_path:
        detected_path, detected_proxy = _get_proxy_addr(args.port)
        if detected_path:
            base_path = detected_path
            proxy_url = detected_proxy

    # On nanoHUB the app runs on args.port (8001) and wrwroxy forwards from 8000.
    # wrwroxy is loaded via the `use` package system, so plain which() often fails.
    # Use _find_wrwroxy() to discover the package name via `use` output.
    use_wrwroxy = False
    wrwroxy_pkg = None
    if args.wrwroxy:
        if shutil.which("wrwroxy") is not None:
            # Already on PATH — use directly (pkg name not needed)
            wrwroxy_pkg = "wrwroxy"
        else:
            wrwroxy_pkg = _find_wrwroxy()
        use_wrwroxy = wrwroxy_pkg is not None
    resources = _parse_nanohub_resources()
    is_nanohub = bool(resources)
    nanohub_tool_name = args.app_name or _resolve_nanohub_tool_name(resources)
    nanohub_about_url = ""
    nanohub_questions_url = ""
    if is_nanohub and nanohub_tool_name:
        nanohub_about_url = f"https://nanohub.org/tools/{nanohub_tool_name}"
        nanohub_questions_url = f"https://nanohub.org/resources/{nanohub_tool_name}/questions"
    nanohub_support_url, nanohub_terminate_url = _resolve_nanohub_urls()

    from .app import app, set_tool

    server_url = proxy_url if proxy_url else "http://{}:{}{}".format(
        args.host, args.port, base_path
    )

    # ── Cache URL auto-detection ──────────────────────────────────────────────
    # Manual --cache-url overrides both read and write.
    # On nanoHUB, auto-detect from resources file if not manually set.
    cache_url = args.cache_url.strip()
    cache_write_url = ""
    if not cache_url and is_nanohub:
        _read_host = resources.get("cache_hosts", "").strip()
        _write_host = resources.get("cache_write_host", "").strip()
        if _read_host:
            cache_url = "http://{}".format(_read_host)
        if _write_host:
            cache_write_url = "http://{}".format(_write_host)

    set_tool(
        xml_path=str(tool_path),
        cache_dir=cache_dir,
        server_url=server_url,
        use_library_mode=args.library_mode,
        use_cache=not args.no_cache,
        base_path=base_path,
        is_nanohub=is_nanohub,
        nanohub_support_url=nanohub_support_url,
        nanohub_terminate_url=nanohub_terminate_url,
        nanohub_about_url=nanohub_about_url,
        nanohub_questions_url=nanohub_questions_url,
        cache_url=cache_url,
        cache_write_url=cache_write_url,
    )

    print("Loading tool: {}".format(tool_path))
    print("Starting server at {}".format(server_url))
    if args.library_mode:
        print("Library mode: tool scripts receive server URL instead of driver.xml")
    print("Run cache directory: {}".format(cache_dir))
    if cache_url:
        print("Remote cache (read):  {}".format(cache_url))
    if cache_write_url:
        print("Remote cache (write): {}".format(cache_write_url))
    if proxy_url:
        print("nanoHUB proxy URL: {}".format(proxy_url))
    if nanohub_about_url:
        print("nanoHUB about URL: {}".format(nanohub_about_url))
    if nanohub_questions_url:
        print("nanoHUB questions URL: {}".format(nanohub_questions_url))
    if nanohub_support_url:
        print("nanoHUB support URL: {}".format(nanohub_support_url))
    if nanohub_terminate_url:
        print("nanoHUB terminate URL: {}".format(nanohub_terminate_url))

    # Open browser only when not behind a proxy and not suppressed
    if not args.no_browser and not base_path:
        import webbrowser
        import threading
        threading.Timer(1.2, webbrowser.open, args=[server_url]).start()

    # Start wrwroxy if available on nanoHUB (forwards port 8000 → args.port).
    # If wrwroxy_pkg is a versioned package name (e.g. 'wrwroxy-0.3') we must
    # load it via `use` first since it may not be on PATH yet.
    if use_wrwroxy and wrwroxy_pkg:
        import subprocess
        print("Starting wrwroxy ({}) {} -> 8000 [{}]".format(
            wrwroxy_pkg, args.port, base_path.lstrip("/") or "/"), flush=True)
        if wrwroxy_pkg == "wrwroxy":
            # Already on PATH — launch directly
            subprocess.Popen([
                "wrwroxy",
                str(args.port),
                "8000",
                base_path.lstrip("/"),
            ])
        else:
            # Load via `use` then exec wrwroxy in the same shell
            cmd = "use -e -r {pkg} && wrwroxy {port} 8000 {path}".format(
                pkg=wrwroxy_pkg,
                port=args.port,
                path=base_path.lstrip("/"),
            )
            subprocess.Popen(["bash", "-lc", cmd])

    import uvicorn
    log_level = "debug" if args.verbose else "info"
    uvicorn.run(app, host=args.host, port=args.port, log_level=log_level,
                root_path=base_path)


if __name__ == "__main__":
    main()
