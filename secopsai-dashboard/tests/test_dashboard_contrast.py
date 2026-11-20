"""The console design system: one palette, readable contrast, no decoration."""
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
CSS = (ROOT / "styles.css").read_text(encoding="utf-8")
DESIGN = CSS.split("SecOpsAI console design system", 1)[1]


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


def _token(name):
    match = re.search(rf"--{name}:\s*#([0-9a-f]{{6}});", DESIGN)
    assert match, name
    return match.group(1)


def test_design_system_is_the_last_word():
    assert CSS.index("SecOpsAI console design system") > len(CSS) // 2
    for name in ("bg", "surface", "border", "text", "text-2", "text-3", "accent", "danger", "warning", "info", "nav-bg"):
        _token(name)


def test_text_tokens_meet_wcag_aa_on_every_surface():
    for text in ("text", "text-2", "text-3"):
        for surface in ("surface", "surface-2", "bg"):
            assert _contrast_ratio(_token(text), _token(surface)) >= 4.5, (text, surface)


def test_status_colours_are_readable_on_their_tints():
    for strong, soft in (("danger", "danger-soft"), ("warning", "warning-soft"), ("info", "info-soft"), ("accent-text", "accent-soft")):
        assert _contrast_ratio(_token(strong), _token(soft)) >= 4.5, strong
    assert _contrast_ratio("ffffff", _token("accent")) >= 4.5
    assert _contrast_ratio("ffffff", _token("danger")) >= 4.5


def test_navigation_rail_text_is_readable():
    for text in ("nav-text", "nav-text-strong"):
        assert _contrast_ratio(_token(text), _token("nav-bg")) >= 4.5, text
        assert _contrast_ratio(_token(text), _token("nav-active")) >= 4.5, text
    assert _contrast_ratio(_token("nav-muted"), _token("nav-bg")) >= 4.5


def test_no_decoration_survives_anywhere():
    assert "gradient(" not in CSS.split("SecOpsAI console design system", 1)[0]
    assert "text-transform: uppercase" not in CSS
    assert "radar-texture" not in CSS
    assert "text-shadow:" not in CSS.replace("text-shadow: none", "")
    families = set(re.findall(r"font-family:\s*([^;!}]+)", CSS))
    assert families <= {"inherit", "var(--font-sans)", "var(--font-mono)"}, families


def test_every_colour_comes_from_the_palette():
    palette = {value.lower() for value in re.findall(r"--[\w-]+:\s*(#[0-9a-fA-F]{6})", DESIGN)}
    palette |= {"#ffffff", "#fff", "#f1f3f2", "#cdd4cf", "#e2e6e3", "#eef1ef", "#f8f9f8", "#131b17", "#45514b", "#66726b"}
    used = {value.lower() for value in re.findall(r"#[0-9a-fA-F]{6}\b", CSS)}
    stray = used - palette
    assert len(stray) <= 14, sorted(stray)


def test_focus_is_always_visible():
    assert ":focus-visible { outline: 2px solid var(--accent)" in DESIGN
    assert "var(--focus-ring)" in DESIGN


def test_stylesheet_cache_key_points_to_design_system_revision():
    html = (ROOT / "index.html").read_text(encoding="utf-8")
    assert "styles.css?v=20261120-design-system" in html
    assert "family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500" in html
    assert "Space+Grotesk" not in html and "Manrope" not in html
