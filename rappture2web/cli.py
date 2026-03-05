"""CLI entry point for Rappture2Web."""

import argparse
import sys
from pathlib import Path


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
        default=8081,
        help="Port to serve on (default: 8081)",
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
             "(e.g. /mytool). No trailing slash.",
    )

    args = parser.parse_args()

    tool_path = Path(args.tool_xml).resolve()
    if not tool_path.exists():
        print(f"Error: {tool_path} not found", file=sys.stderr)
        sys.exit(1)

    # Default cache dir: .rappture2web/ next to the tool XML
    cache_dir = args.cache_dir or str(tool_path.parent / ".rappture2web")

    from .app import app, set_tool

    base_path = args.base_path.rstrip("/")
    server_url = f"http://{args.host}:{args.port}{base_path}"

    set_tool(
        xml_path=str(tool_path),
        cache_dir=cache_dir,
        server_url=server_url,
        use_library_mode=args.library_mode,
        use_cache=not args.no_cache,
        base_path=base_path,
    )

    print(f"Loading tool: {tool_path}")
    print(f"Starting server at {server_url}")
    if args.library_mode:
        print("Library mode: tool scripts receive server URL instead of driver.xml")
    print(f"Run cache directory: {cache_dir}")

    if not args.no_browser:
        import webbrowser
        import threading
        threading.Timer(1.2, webbrowser.open, args=[server_url]).start()

    import uvicorn
    uvicorn.run(app, host=args.host, port=args.port, log_level="info",
                root_path=base_path)


if __name__ == "__main__":
    main()
