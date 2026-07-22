from pathlib import Path

import pytest

import dashboard_server


ROOT = Path(__file__).resolve().parents[1]


def test_local_intelligence_actions_are_allowlisted():
    assert dashboard_server.build_intelligence_args(
        "enqueue",
        {"intelligence_action": "explain_finding", "target_id": "FND-ABC123"},
    )[:4] == ["intelligence", "enqueue", "--action", "explain_finding"]
    assert dashboard_server.build_intelligence_args("run-once", {})[:4] == ["intelligence", "bridge", "run", "--once"]
    assert dashboard_server.build_intelligence_args(
        "service", {"service_action": "status"}
    ) == ["intelligence", "bridge", "service", "status"]


def test_local_intelligence_rejects_arbitrary_prompts_commands_and_ids():
    with pytest.raises(ValueError):
        dashboard_server.build_intelligence_args(
            "enqueue",
            {"intelligence_action": "run_shell", "target_id": "FND-ABC123"},
        )
    with pytest.raises(ValueError):
        dashboard_server.build_intelligence_args(
            "enqueue",
            {"intelligence_action": "explain_finding", "target_id": "FND-1; rm -rf /"},
        )
    with pytest.raises(ValueError):
        dashboard_server.build_intelligence_args("service", {"service_action": "exec"})


def test_intelligence_operator_surface_is_present_and_not_prompt_driven():
    html = (ROOT / "index.html").read_text(encoding="utf-8")
    app = (ROOT / "app.js").read_text(encoding="utf-8")
    for element in (
        "intelligence-summary",
        "intelligence-action-select",
        "intelligence-target-id",
        "intelligence-queue-btn",
        "intelligence-jobs-table",
        "intelligence-copy-mcp-btn",
    ):
        assert f'id="{element}"' in html
    assert "runIntelligenceAction('enqueue'" in app
    assert "data-intelligence-service" in html
    assert "arbitrary prompt" not in html.lower()
