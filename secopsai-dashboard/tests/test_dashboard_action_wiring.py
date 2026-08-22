from pathlib import Path
import re


ROOT = Path(__file__).resolve().parents[1]


def test_investigation_open_case_uses_one_shared_case_opener():
    app = (ROOT / "app.js").read_text(encoding="utf-8")

    assert "navigateTo(" not in app
    assert app.count("async function openResearchCase(") == 1
    assert "await openResearchCase(openCase.dataset.investigationCase)" in app
    assert "await openResearchCase(caseId)" in app
    assert "await loadResearchCaseDetail(normalizedCaseId, { render: false })" in app
    assert "Research case ${normalizedCaseId} is invalid or unavailable." in app


def test_discovery_inbox_refresh_has_a_visible_action_handler():
    html = (ROOT / "index.html").read_text(encoding="utf-8")
    app = (ROOT / "app.js").read_text(encoding="utf-8")

    assert re.search(r'<button[^>]+id="research-inbox-refresh-btn"', html)
    assert "el('research-inbox-refresh-btn')?.addEventListener('click'" in app
    assert "Candidate refresh failed" in app
    assert "() => loadResearchDiscovery()" in app


def test_static_buttons_are_referenced_or_use_the_allowlisted_data_action_binding():
    html = (ROOT / "index.html").read_text(encoding="utf-8")
    app = (ROOT / "app.js").read_text(encoding="utf-8")
    button_ids = re.findall(r'<button\b[^>]*\bid="([^"]+)"[^>]*>', html)
    data_bound_ids = {
        "artifact-fleet-cycle-btn",
        "artifact-fleet-index-btn",
        "artifact-fleet-scan-btn",
        "artifact-fleet-triage-btn",
        "artifact-fleet-analyst-btn",
        "artifact-fleet-rules-btn",
        "artifact-fleet-benchmark-btn",
    }

    missing = [
        button_id
        for button_id in button_ids
        if button_id not in data_bound_ids
        and button_id not in app
    ]
    assert missing == [], f"static buttons without a dashboard binding: {missing}"


def test_external_wallet_injection_collision_does_not_mask_dashboard_errors():
    app = (ROOT / "app.js").read_text(encoding="utf-8")

    assert "function isExternalBrowserInjectionError(event)" in app
    assert r"/cannot redefine property:\s*ethereum/i.test(message)" in app
    assert r"/^(?:chrome|moz|safari)-extension:\/\//i.test(filename)" in app
    assert "if (isExternalBrowserInjectionError(event)) return;" in app
    assert "JS error: ${event.message || 'unknown error'}" in app


def test_initial_route_collapses_sidebar_subnavigation_until_operator_opens_it():
    app = (ROOT / "app.js").read_text(encoding="utf-8")

    assert app.count("function collapseSidebarForInitialRoute(") == 1
    assert app.count("collapseSidebarForInitialRoute(initialPage);") >= 2
    assert "collapsedSidebarPrimaryPage = primaryPageFor(pageId);" in app
    assert "setPage(initialPage, { skipHistory: true, scrollToTarget: false });" in app
    assert "setPage(initialPage, { skipHistory: true });" in app
