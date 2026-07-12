"""Layout checks at MCP-iframe-like viewport sizes (TODO.md §9).

Each test saves a screenshot *before* asserting, so failing sizes still leave
visual evidence in tests/visual/screenshots/.

These tests encode the acceptance criteria for the small-window work in
TODO.md — some are expected to FAIL until §1 (height math) and §2 (early
stacking) are fixed.  A failure here is baseline evidence, not test rot.
"""
from __future__ import annotations

import pytest

from .conftest import (
    CRYSTAL_RUN_XML,
    CURVE_RUN_XML,
    FIELD_RUN_XML,
    SCREENSHOT_DIR,
    VIEWPORTS,
    load_tool_page,
    viewport_id,
)


@pytest.fixture(params=VIEWPORTS, ids=viewport_id)
def viewport(request):
    return request.param


@pytest.fixture
def tool_page(browser, server_url, viewport):
    """A tool page loaded at the parametrized viewport size."""
    context = browser.new_context(viewport=viewport)
    page = context.new_page()
    load_tool_page(page, server_url)
    yield page
    context.close()


def _shot(page, viewport, name: str = ""):
    suffix = f"_{name}" if name else ""
    page.screenshot(
        path=str(SCREENSHOT_DIR / f"{viewport_id(viewport)}{suffix}.png"),
        full_page=True,
    )


def _show_results(page, viewport):
    if viewport["width"] <= 900:
        page.locator('.rp-pane-switch-btn[data-pane="results"]').click()


def test_no_horizontal_overflow(tool_page, viewport):
    """The page body must never scroll horizontally (TODO §8)."""
    _shot(tool_page, viewport)
    scroll_w = tool_page.evaluate("document.documentElement.scrollWidth")
    assert scroll_w <= viewport["width"] + 1, (
        f"horizontal overflow at {viewport_id(viewport)}: "
        f"scrollWidth={scroll_w} > viewport={viewport['width']}"
    )


def test_footer_does_not_overlap_results(tool_page, viewport):
    """The fixed footer must not cover the results pane (TODO §1)."""
    _show_results(tool_page, viewport)
    _shot(tool_page, viewport)
    boxes = tool_page.evaluate(
        """() => {
            const c = document.querySelector('.rp-content');
            const f = document.getElementById('rp-footer');
            if (!c) return null;
            const cr = c.getBoundingClientRect();
            return {
                contentBottom: cr.bottom,
                footerTop: f && !f.hidden ? f.getBoundingClientRect().top : null,
            };
        }"""
    )
    assert boxes is not None, "results pane (.rp-content) not found"
    if boxes["footerTop"] is not None:
        assert boxes["contentBottom"] <= boxes["footerTop"] + 1, (
            f"footer overlaps results at {viewport_id(viewport)}: "
            f"content bottom {boxes['contentBottom']:.0f} > "
            f"footer top {boxes['footerTop']:.0f}"
        )


def test_results_pane_usable_width(tool_page, viewport):
    """The results pane needs enough width to show a plot (TODO §2)."""
    _show_results(tool_page, viewport)
    width = tool_page.evaluate(
        "document.querySelector('.rp-content').getBoundingClientRect().width"
    )
    # In a stacked layout the pane should get nearly the full viewport;
    # side-by-side it must not be starved below ~300px.
    min_expected = min(300, viewport["width"] - 60)
    assert width >= min_expected, (
        f"results pane too narrow at {viewport_id(viewport)}: "
        f"{width:.0f}px < {min_expected}px"
    )


def test_results_pane_visible_height(tool_page, viewport):
    """A useful slice of the results pane must be inside the viewport (TODO §1/§2)."""
    _show_results(tool_page, viewport)
    metrics = tool_page.evaluate(
        """() => {
            const c = document.querySelector('.rp-content');
            const r = c.getBoundingClientRect();
            const vh = window.innerHeight;
            return {
                top: r.top, bottom: r.bottom,
                visible: Math.min(r.bottom, vh) - Math.max(r.top, 0),
            };
        }"""
    )
    assert metrics["visible"] >= 150, (
        f"results pane nearly invisible at {viewport_id(viewport)}: only "
        f"{metrics['visible']:.0f}px visible (top={metrics['top']:.0f}, "
        f"bottom={metrics['bottom']:.0f})"
    )


def test_simulate_button_reachable(tool_page, viewport):
    """The Simulate button must be present and clickable-sized (TODO §8)."""
    btn = tool_page.locator("#rp-simulate-btn")
    assert btn.count() == 1
    box = btn.bounding_box()
    assert box is not None, "Simulate button has no layout box"
    assert box["height"] >= 32, f"Simulate button too short: {box['height']:.0f}px"
    if viewport["width"] <= 900:
        position = btn.locator('xpath=..').evaluate("el => getComputedStyle(el).position")
        assert position == 'sticky'


def test_narrow_toolbar_does_not_consume_own_row(tool_page, viewport):
    if viewport["width"] > 600:
        return
    metrics = tool_page.evaluate(
        """() => {
            const toolbar = document.querySelector('.rp-toolbar');
            const brand = document.querySelector('.rp-brand-bar');
            const toggle = document.querySelector('.rp-toolbar-overflow-toggle');
            const br = brand.getBoundingClientRect();
            const tr = toggle.getBoundingClientRect();
            return {
                toolbarHeight: toolbar.getBoundingClientRect().height,
                toggleInsideBrand: tr.top >= br.top && tr.bottom <= br.bottom + 1,
            };
        }"""
    )
    assert metrics['toolbarHeight'] <= 1
    assert metrics['toggleInsideBrand']

    toggle = tool_page.locator('.rp-toolbar-overflow-toggle')
    toggle.click()
    actions = tool_page.locator('.rp-toolbar-actions')
    assert actions.is_visible()
    assert toggle.get_attribute('aria-expanded') == 'true'
    _shot(tool_page, viewport, 'menu_open')

    # Escape closes the menu and restores focus to its trigger.
    tool_page.keyboard.press('Escape')
    assert not actions.is_visible()
    assert toggle.get_attribute('aria-expanded') == 'false'
    assert toggle.evaluate('el => document.activeElement === el')


def test_narrow_pane_switch_reclaims_space(tool_page, viewport):
    """Pane selection hides one side and is remembered for this tool (TODO §3)."""
    switch = tool_page.locator('.rp-pane-switch')
    if viewport["width"] > 900:
        assert not switch.is_visible()
        return

    results_btn = tool_page.locator('.rp-pane-switch-btn[data-pane="results"]')
    inputs_btn = tool_page.locator('.rp-pane-switch-btn[data-pane="inputs"]')
    assert tool_page.locator('.rp-sidebar').is_visible()
    assert not tool_page.locator('.rp-content').is_visible()
    assert inputs_btn.get_attribute('aria-pressed') == 'true'
    _shot(tool_page, viewport, 'inputs')

    inputs_btn.focus()
    tool_page.keyboard.press('ArrowRight')
    assert tool_page.locator('.rp-content').is_visible()
    assert not tool_page.locator('.rp-sidebar').is_visible()
    assert results_btn.get_attribute('aria-pressed') == 'true'
    assert tool_page.evaluate("localStorage.getItem(rappture._paneStorageKey())") == 'results'
    _shot(tool_page, viewport, 'results')

    # Tabs are exclusive: clicking the active tab does not expose a split view.
    results_btn.click()
    assert tool_page.locator('.rp-content').is_visible()
    assert not tool_page.locator('.rp-sidebar').is_visible()

    inputs_btn.click()
    assert tool_page.locator('.rp-sidebar').is_visible()
    assert not tool_page.locator('.rp-content').is_visible()


# ── Inside a real <iframe> ───────────────────────────────────────────────────
# vh units and position:fixed behave differently inside an iframe than in a
# narrow top-level window — this is the embed case the TODO targets.

IFRAME_SIZES = [(420, 600), (500, 500)]


@pytest.mark.parametrize(
    "frame_size", IFRAME_SIZES, ids=lambda s: f"iframe{s[0]}x{s[1]}"
)
def test_inside_iframe(browser, server_url, frame_size):
    w, h = frame_size
    context = browser.new_context(viewport={"width": w + 120, "height": h + 120})
    page = context.new_page()
    try:
        page.set_content(
            f'<iframe src="{server_url}" width="{w}" height="{h}" '
            f'style="border:1px solid #94a3b8"></iframe>'
        )
        iframe_el = page.wait_for_selector("iframe")
        frame = iframe_el.content_frame()
        frame.wait_for_selector(".rp-layout", state="visible")
        page.wait_for_load_state("networkidle")

        frame.locator('.rp-pane-switch-btn[data-pane="results"]').click()

        iframe_el.screenshot(path=str(SCREENSHOT_DIR / f"iframe_{w}x{h}.png"))

        scroll_w = frame.evaluate("document.documentElement.scrollWidth")
        assert scroll_w <= w + 1, (
            f"horizontal overflow inside {w}x{h} iframe: scrollWidth={scroll_w}"
        )

        visible = frame.evaluate(
            """() => {
                const c = document.querySelector('.rp-content');
                const r = c.getBoundingClientRect();
                return Math.min(r.bottom, window.innerHeight) - Math.max(r.top, 0);
            }"""
        )
        assert visible >= 150, (
            f"results pane nearly invisible inside {w}x{h} iframe: "
            f"{visible:.0f}px visible"
        )
    finally:
        context.close()


# ── Real Rappture output fixtures ────────────────────────────────────────────

def _upload_run(page, xml_path):
    page.locator('#rp-upload-run-input').set_input_files(str(xml_path))
    page.wait_for_selector('.rp-output-selector', state='attached')
    page.wait_for_selector('.rp-main.rp-pane-results')
    page.wait_for_selector('.rp-output-selector', state='visible')
    assert page.locator('#rp-results-pane').evaluate('el => document.activeElement === el')


def _settle_renderer(page):
    """Let Plotly/Three.js finish their resize and compositing frames."""
    page.wait_for_timeout(600)
    page.evaluate("document.body.offsetHeight")


def test_real_curve_output_at_embed_size(browser, server_url):
    context = browser.new_context(viewport={"width": 500, "height": 500})
    page = context.new_page()
    try:
        load_tool_page(page, server_url)
        _upload_run(page, CURVE_RUN_XML)
        page.locator('.rp-output-selector').select_option(label='Single curve')
        page.wait_for_selector('.rp-output-panel.active .rp-output-plot', state='visible')
        _settle_renderer(page)
        page.screenshot(path=str(SCREENSHOT_DIR / 'qa_curve_500x500.png'))

        page.locator('.rp-pane-switch-btn[data-pane="inputs"]').click()
        run_row = page.locator('.rp-run-row').first
        assert run_row.get_attribute('role') == 'listitem'
        assert run_row.get_attribute('draggable') == 'false'
        assert run_row.locator('.rp-run-check').get_attribute('aria-label').startswith('Select ')
        run_label = run_row.locator('.rp-run-label')
        assert run_label.get_attribute('role') == 'button'
        assert run_label.get_attribute('tabindex') == '0'
        run_label.focus()
        page.keyboard.press('F2')
        assert run_row.locator('.rp-run-rename-input').is_visible()
        page.keyboard.press('Escape')

        color_button = run_row.locator('.rp-run-color')
        color_button.click()
        assert run_row.locator('.rp-color-popup').get_attribute('role') == 'dialog'
        assert run_row.locator('.rp-color-dot').first.get_attribute('aria-label').startswith(
            'Use color '
        )
        page.locator('.rp-title').click()

        page.locator('.rp-pane-switch-btn[data-pane="results"]').click()
        fullscreen = page.locator('.rp-output-panel.active .rp-fullscreen-btn')
        assert fullscreen.is_visible()
        fullscreen.click()
        item = page.locator('.rp-output-item.rp-output-fullscreen')
        box = item.bounding_box()
        assert box is not None
        assert box['x'] <= 1 and box['y'] <= 1
        assert box['width'] >= 499 and box['height'] >= 499
        page.screenshot(path=str(SCREENSHOT_DIR / 'qa_curve_fullscreen_500x500.png'))
    finally:
        context.close()


def test_real_2d_and_3d_fields_at_embed_size(browser, server_url):
    context = browser.new_context(viewport={"width": 500, "height": 500})
    page = context.new_page()
    try:
        load_tool_page(page, server_url)
        _upload_run(page, FIELD_RUN_XML)
        selector = page.locator('.rp-output-selector')

        selector.select_option(label='2D Field')
        page.wait_for_selector('.rp-output-panel.active .rp-output-plot', state='visible')
        _settle_renderer(page)
        page.screenshot(path=str(SCREENSHOT_DIR / 'qa_field2d_500x500.png'))

        selector.select_option(label='3D Field')
        page.wait_for_selector('.rp-output-panel.active .rp-3d-panel-wrap', state='visible')
        _settle_renderer(page)
        assert page.locator('.rp-output-panel.active .rp-3d-panel-wrap').evaluate(
            "el => el.classList.contains('collapsed')"
        )
        tab = page.locator('.rp-output-panel.active .rp-3d-panel-tab')
        assert tab.get_attribute('role') == 'button'
        assert tab.get_attribute('tabindex') == '0'
        assert tab.get_attribute('aria-expanded') == 'false'
        assert tab.bounding_box()['width'] >= 40
        page.screenshot(path=str(SCREENSHOT_DIR / 'qa_field3d_500x500.png'))
        position = page.locator('.rp-output-panel.active .rp-3d-panel-wrap').evaluate(
            "el => getComputedStyle(el).position"
        )
        assert position == 'absolute'
    finally:
        context.close()


def test_real_crystal_viewer_output_at_embed_size(browser, server_url):
    context = browser.new_context(viewport={"width": 500, "height": 500})
    page = context.new_page()
    try:
        load_tool_page(page, server_url)
        _upload_run(page, CRYSTAL_RUN_XML)
        page.locator('.rp-output-selector').select_option(index=0)
        page.wait_for_selector('.rp-output-panel.active canvas', state='visible')
        _settle_renderer(page)
        panel = page.locator('.rp-output-panel.active .rp-3d-panel-wrap')
        assert panel.evaluate("el => el.classList.contains('collapsed')")
        # Element capture avoids a Chromium/SwiftShader artifact that paints
        # black outside a WebGL canvas during full-page screenshots.
        page.locator('.rp-content').screenshot(
            path=str(SCREENSHOT_DIR / 'qa_crystalviewer_500x500.png')
        )
        page.locator('.rp-output-panel.active .rp-3d-panel-tab').click()
        _settle_renderer(page)
        assert not panel.evaluate("el => el.classList.contains('collapsed')")
        assert page.locator('.rp-output-panel.active .rp-3d-panel-tab').get_attribute(
            'aria-expanded'
        ) == 'true'
        assert page.locator('.rp-output-panel.active .rp-fullscreen-btn').is_visible()
    finally:
        context.close()
