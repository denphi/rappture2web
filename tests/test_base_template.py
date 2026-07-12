from __future__ import annotations

from rappture2web.app import templates


class _Request:
    def __init__(self, query_params=None):
        self.query_params = query_params or {}


def test_base_template_renders_brand_and_toolbar_links():
    html = templates.env.get_template("base.html").render(
        tool={"title": "Quantum Dot Tool"},
        base_path="/mytool",
        is_nanohub=True,
        nanohub_about_url="https://nanohub.org/tools/quantumdot",
        nanohub_questions_url="https://nanohub.org/resources/quantumdot/questions",
        nanohub_support_url="https://nanohub.org/support",
        nanohub_terminate_url="https://nanohub.org/stop",
    )

    assert "nanoHUB" in html
    assert "Quantum Dot Tool" in html
    assert "/mytool/static/img/nanohub_logo_color.jpg" in html
    assert "About This Tool" in html
    assert "Questions" in html
    assert "Support" in html
    assert "Close Session" in html
    assert "Upload XML" not in html
    assert 'class="rp-toolbar' in html
    assert "/mytool/static/js/rp-renderer-drawing.js" in html


def test_base_template_hides_toolbar_without_links_on_nanohub():
    html = templates.env.get_template("base.html").render(
        tool={"title": "Fermi"},
        base_path="",
        is_nanohub=True,
        nanohub_about_url="",
        nanohub_questions_url="",
        nanohub_support_url="",
        nanohub_terminate_url="",
    )

    assert "nanoHUB" in html
    assert "Fermi" in html
    assert "Close Session" not in html
    assert "Support" not in html
    assert "Upload XML" not in html
    assert 'class="rp-toolbar' not in html


def test_base_template_shows_upload_menu_off_nanohub():
    html = templates.env.get_template("base.html").render(
        tool={"title": "Local Tool"},
        base_path="",
        is_nanohub=False,
        nanohub_about_url="",
        nanohub_questions_url="",
        nanohub_support_url="",
        nanohub_terminate_url="",
    )

    assert "Upload XML" in html
    assert "About This Tool" not in html
    assert "Questions" not in html
    assert 'class="rp-toolbar' in html


def test_base_template_supports_minimal_embed_chrome():
    html = templates.env.get_template("base.html").render(
        request=_Request({"embed": "1"}),
        tool={"title": "Embedded Tool"},
        base_path="",
        is_nanohub=False,
        nanohub_about_url="",
        nanohub_questions_url="",
        nanohub_support_url="",
        nanohub_terminate_url="",
    )

    assert '<body class="rp-compact-chrome">' in html
    assert "rp-toolbar-overflow-toggle" in html


def test_base_template_uses_one_status_live_region():
    html = templates.env.get_template("base.html").render(
        tool={"title": "Accessible Tool"},
        base_path="",
        is_nanohub=False,
        nanohub_about_url="",
        nanohub_questions_url="",
        nanohub_support_url="",
        nanohub_terminate_url="",
        cache_configured=True,
    )

    assert '<footer id="rp-footer" class="rp-footer">' in html
    assert 'aria-label="Disable simulation cache"' in html
