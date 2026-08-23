from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def _relative_luminance(hex_color):
    rgb = [int(hex_color[index : index + 2], 16) / 255 for index in (0, 2, 4)]
    channels = [
        value / 12.92 if value <= 0.03928 else ((value + 0.055) / 1.055) ** 2.4
        for value in rgb
    ]
    return (0.2126 * channels[0]) + (0.7152 * channels[1]) + (0.0722 * channels[2])


def _contrast_ratio(foreground, background):
    first = _relative_luminance(foreground)
    second = _relative_luminance(background)
    return (max(first, second) + 0.05) / (min(first, second) + 0.05)


def test_bright_contrast_layer_defines_readable_tokens_and_controls():
    css = (ROOT / "styles.css").read_text(encoding="utf-8")
    assert "/* Bright contrast correction." in css
    assert "--contrast-text: #17211e" in css
    assert "--contrast-text-soft: #40534b" in css
    assert "--contrast-text-muted: #53645d" in css
    assert "--contrast-green: #087963" in css
    assert "--surface-muted" in css
    assert "body.professional-ui .main :is(button, a, input, select, textarea, summary):focus-visible" in css
    assert "body.professional-ui .main :is(button, input, select, textarea)[disabled]" in css
    assert "body.professional-ui #page-tasks .task-card" in css
    assert "body.professional-ui .main .metric-scope" in css
    assert "body.professional-ui .main :is(.operations-cockpit, .cockpit-panel, .cockpit-summary)" in css
    assert "body.professional-ui .main .table-link" in css
    assert "body.professional-ui .main :is(.severity-urgent, .severity-critical)" in css
    assert "body.professional-ui .main option" in css
    assert "body.professional-ui .main .research-evidence-row > span:first-child" in css
    assert "opacity: 0.9 !important" in css
    assert "body.professional-ui .main .badge" in css
    assert "body.professional-ui .main .inline-action-menu > div" in css
    assert "body.professional-ui .main #work-scope-note" in css
    assert "body.professional-ui .sidebar .sidebar-footer" in css
    assert "body.professional-ui .sidebar #global-status" in css
    assert "background: #173229 !important" in css
    assert "color: #f4f8f6 !important" in css
    assert "body.professional-ui #page-triage-ops :is(" in css
    assert ".triage-alert-card" in css
    assert "body.professional-ui #page-operator-guide .guide-pill" in css


def test_bright_theme_text_and_green_tokens_meet_wcag_aa_on_white():
    for token in ("17211e", "40534b", "53645d", "62716b", "087963", "086b58", "0f4c81", "8a5a00", "9e1b1b"):
        assert _contrast_ratio(token, "ffffff") >= 4.5, token


def test_operator_status_panel_keeps_rail_text_readable():
    assert _contrast_ratio("f4f8f6", "173229") >= 4.5
    assert _contrast_ratio("9fbbb2", "173229") >= 4.5


def test_bright_theme_does_not_use_hover_as_the_only_readability_fix():
    css = (ROOT / "styles.css").read_text(encoding="utf-8")
    bright_layer = css.split("/* Bright contrast correction.", 1)[1]
    assert "color: var(--contrast-text-soft) !important" in bright_layer
    assert "opacity: 1 !important" in bright_layer
    assert "cursor: not-allowed !important" in bright_layer
    # The final layer uses a stable resting color for controls; hover is only
    # an interaction affordance and cannot be the source of text visibility.
    assert ".main :is(.secondary-btn, .mini-btn" in bright_layer
    assert "color: var(--contrast-text) !important" in bright_layer


def test_stylesheet_cache_key_points_to_contrast_revision():
    html = (ROOT / "index.html").read_text(encoding="utf-8")
    assert 'styles.css?v=20260823-bright-contrast-v3' in html
    assert 'styles.css?v=20260803-subsection-navigation' not in html
