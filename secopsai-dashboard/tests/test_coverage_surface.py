from pathlib import Path

import pytest

import dashboard_server


ROOT = Path(__file__).resolve().parents[1]


def test_coverage_actions_are_allowlisted():
    for action in (
        "collect-status",
        "collect-run",
        "collect-retry-failures",
        "collect-coverage",
        "collect-events",
        "collect-pause",
        "collect-resume",
        "score-run",
    ):
        assert action in dashboard_server.RESEARCH_DISCOVERY_ACTIONS


def test_collect_status_and_run_build_expected_cli_args():
    assert dashboard_server.build_research_discovery_args("collect-status") == ["research", "collect", "status"]
    run = dashboard_server.build_research_discovery_args("collect-run", {"ecosystem": "nuget", "max_pages": 25})
    assert run == ["research", "collect", "run", "--ecosystem", "nuget", "--max-pages", "25"]
    bounded = dashboard_server.build_research_discovery_args("collect-run", {"ecosystem": "pypi", "max_pages": 99999})
    assert bounded[-1] == "100"


def test_collect_pause_resume_require_valid_ecosystem():
    assert dashboard_server.build_research_discovery_args("collect-pause", {"ecosystem": "rubygems"}) == [
        "research", "collect", "pause", "--ecosystem", "rubygems",
    ]
    assert dashboard_server.build_research_discovery_args("collect-resume", {"ecosystem": "packagist"}) == [
        "research", "collect", "resume", "--ecosystem", "packagist",
    ]
    with pytest.raises(ValueError):
        dashboard_server.build_research_discovery_args("collect-pause", {"ecosystem": "npm; rm -rf /"})
    with pytest.raises(ValueError):
        dashboard_server.build_research_discovery_args("collect-run", {})


def test_collect_events_validates_collector_and_package_filters():
    args = dashboard_server.build_research_discovery_args(
        "collect-events", {"collector_id": "COL-NUGET-CATALOG", "package": "Newtonsoft.Json", "limit": 10}
    )
    assert args == [
        "research", "collect", "events", "--limit", "10",
        "--collector-id", "COL-NUGET-CATALOG", "--package", "Newtonsoft.Json",
    ]
    with pytest.raises(ValueError):
        dashboard_server.build_research_discovery_args("collect-events", {"collector_id": "bad id"})
    with pytest.raises(ValueError):
        dashboard_server.build_research_discovery_args("collect-events", {"package": "bad;package"})


def test_score_run_and_coverage_windows_build_expected_args():
    assert dashboard_server.build_research_discovery_args("score-run", {"ecosystem": "pypi", "limit": 500}) == [
        "research", "score", "run", "--ecosystem", "pypi", "--limit", "500",
    ]
    coverage = dashboard_server.build_research_discovery_args("collect-coverage", {"days": 365})
    assert coverage == ["research", "collect", "coverage", "--days", "90"]


def test_coverage_page_is_registered_in_frontend():
    app = (ROOT / "app.js").read_text(encoding="utf-8")
    html = (ROOT / "index.html").read_text(encoding="utf-8")
    assert '"coverage"' in app
    assert '"research/coverage"' in app
    assert 'id="page-coverage"' in html
    for element in (
        "coverage-stats",
        "coverage-collectors",
        "coverage-events",
        "coverage-windows",
        "coverage-score-run-btn",
        "coverage-retry-btn",
    ):
        assert f'id="{element}"' in html
    for action in ("collect-run", "score-run", "collect-retry-failures"):
        assert f"runCoverageAction('{action}'" in app
    assert "'collect-pause' : 'collect-resume'" in app
