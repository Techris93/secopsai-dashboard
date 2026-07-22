import io
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock

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


def test_local_action_credential_is_adjacent_to_service_controls():
    html = (ROOT / "index.html").read_text(encoding="utf-8")
    assert html.count('id="intelligence-token-field"') == 1
    assert html.count('id="intelligence-admin-token"') == 1
    bridge_start = html.index('id="local-bridge-title"')
    credential = html.index('id="intelligence-token-field"', bridge_start)
    service_actions = html.index('id="intelligence-service-actions"', credential)
    request_analysis = html.index('id="intelligence-request-title"', service_actions)
    assert bridge_start < credential < service_actions < request_analysis
    assert 'id="intelligence-token-hint"' in html


def test_intelligence_unauthorized_response_has_scoped_error_code(monkeypatch):
    monkeypatch.setenv("INTELLIGENCE_ADMIN_TOKEN", "expected-action-token")
    handler = SimpleNamespace(
        headers={"X-SecOpsAI-Intelligence-Token": "wrong-action-token"},
        send_response=Mock(),
        send_header=Mock(),
        end_headers=Mock(),
        wfile=io.BytesIO(),
    )

    assert dashboard_server.require_intelligence_admin(handler) is True
    handler.send_response.assert_called_once_with(401)
    payload = handler.wfile.getvalue().decode("utf-8")
    assert '"code": "intelligence_action_unauthorized"' in payload
    assert "operator_session" not in payload
