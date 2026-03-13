from __future__ import annotations

from pathlib import Path

from rappture2web import cli


def _write_resources(sessiondir: Path, lines: list[str]) -> None:
    sessiondir.mkdir(parents=True, exist_ok=True)
    (sessiondir / "resources").write_text("\n".join(lines) + "\n", encoding="utf-8")


def test_get_proxy_addr_from_nanohub_resources(monkeypatch, tmp_path):
    sessiondir = tmp_path / "987654"
    _write_resources(sessiondir, [
        'hub_url "https://nanohub.org"',
        "filexfer_cookie abc123",
        "filexfer_port 38001",
    ])
    monkeypatch.setenv("SESSIONDIR", str(sessiondir))
    monkeypatch.delenv("SESSION_DIR", raising=False)

    base_path, proxy_url = cli._get_proxy_addr(8001)

    assert base_path == "/weber/987654/abc123/1"
    assert proxy_url == "https://proxy.nanohub.org/weber/987654/abc123/1/"


def test_nanohub_urls_from_resources(monkeypatch, tmp_path):
    sessiondir = tmp_path / "1234"
    _write_resources(sessiondir, [
        'hub_url "https://nanohub.org"',
        "sessionid 1234",
        "application_name app-rappture2web",
    ])
    monkeypatch.setenv("SESSIONDIR", str(sessiondir))
    monkeypatch.delenv("SESSION_DIR", raising=False)

    support_url, terminate_url = cli._nanohub_urls()

    assert support_url == "https://nanohub.org/feedback/report_problems?group=app-rappture2web"
    assert terminate_url == "https://nanohub.org/tools/rappture2web/stop?sess=1234"


def test_resolve_nanohub_urls_env_override(monkeypatch):
    monkeypatch.setattr(cli, "_nanohub_urls", lambda: ("https://detected/support", "https://detected/stop"))
    monkeypatch.setenv("NANOHUB_SUPPORT_URL", "https://override/support")
    monkeypatch.setenv("NANOHUB_TERMINATE_URL", "https://override/stop")

    support_url, terminate_url = cli._resolve_nanohub_urls()

    assert support_url == "https://override/support"
    assert terminate_url == "https://override/stop"


def test_resolve_nanohub_urls_missing(monkeypatch):
    monkeypatch.setattr(cli, "_nanohub_urls", lambda: ("", ""))
    monkeypatch.delenv("NANOHUB_SUPPORT_URL", raising=False)
    monkeypatch.delenv("NANOHUB_TERMINATE_URL", raising=False)

    support_url, terminate_url = cli._resolve_nanohub_urls()

    assert support_url == ""
    assert terminate_url == ""


def test_resolve_nanohub_tool_name_from_resources():
    name = cli._resolve_nanohub_tool_name(resources={
        "application_name": "app-quantumdot",
    })
    assert name == "quantumdot"


def test_resolve_nanohub_tool_name_from_path():
    name = cli._resolve_nanohub_tool_name(tool_xml_path="/apps/quantumdot/r5/rappture/tool.xml")
    assert name == "quantumdot"


def test_resolve_nanohub_tool_name_path_before_resources():
    name = cli._resolve_nanohub_tool_name(
        tool_xml_path="/apps/quantumdot/r5/rappture/tool.xml",
        resources={"application_name": "app-other"},
    )
    assert name == "quantumdot"


def test_resolve_nanohub_tool_name_env_override(monkeypatch):
    monkeypatch.setenv("NANOHUB_TOOL_NAME", "app-qdotlab")
    name = cli._resolve_nanohub_tool_name(
        tool_xml_path="/apps/quantumdot/r5/rappture/tool.xml",
        resources={"application_name": "app-other"},
    )
    assert name == "qdotlab"
