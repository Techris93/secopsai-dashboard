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
        "select-model",
        {"model": "xai/grok-4.6"},
    )[:4] == ["intelligence", "bridge", "select-model", "xai/grok-4.6"]
    service_status = dashboard_server.build_intelligence_args("service", {"service_action": "status"})
    assert service_status[:4] == ["intelligence", "bridge", "service", "status"]
    assert service_status[-2:] == ["--db-path", dashboard_server.SECOPSAI_DB_PATH]
    install = dashboard_server.build_intelligence_args(
        "service",
        {"service_action": "install", "model": "kimi/kimi-k2.7-code-highspeed"},
    )
    assert install[:6] == [
        "intelligence",
        "bridge",
        "service",
        "install",
        "--model",
        "kimi/kimi-k2.7-code-highspeed",
    ]
    assert "--autonomy-mode" in install
    assert "agent_review" in install
    configure = dashboard_server.build_intelligence_args(
        "autopilot-configure",
        {
            "mode": "guarded",
            "model": "kimi/kimi-k2.7-code-highspeed",
            "min_auto_close_confidence": 98,
            "min_evidence_refs": 2,
            "max_records_per_cycle": 10,
            "auto_create_tuning_proposals": True,
        },
    )
    assert configure[:4] == ["intelligence", "autopilot", "configure", "--mode"]
    assert "guarded" in configure
    assert "--auto-activate-tuning" in configure
    assert dashboard_server.build_intelligence_args("autopilot-run-now", {})[:3] == [
        "intelligence",
        "autopilot",
        "run-now",
    ]
    assert dashboard_server.build_intelligence_args("investigation-run-due", {})[:4] == [
        "intelligence", "autopilot", "investigations", "run-due"
    ]
    assert dashboard_server.build_intelligence_args(
        "investigation-retry", {"run_id": "IAR-0123456789ABCDEF"}
    )[:6] == ["intelligence", "autopilot", "investigations", "retry", "--run-id", "IAR-0123456789ABCDEF"]
    assert dashboard_server.build_intelligence_args("learning-run-cycle", {})[:4] == ["intelligence","autopilot","learning","run-cycle"]
    assert dashboard_server.build_intelligence_args("learning-deploy", {"proposal_id":"DLP-0123456789ABCDEF","stage":"shadow"})[:8] == ["intelligence","autopilot","learning","deploy","--proposal-id","DLP-0123456789ABCDEF","--stage","shadow"]
    assert dashboard_server.build_intelligence_args("daily-run", {})[:4] == ["intelligence", "autopilot", "daily", "run"]
    daily_config = dashboard_server.build_intelligence_args(
        "daily-configure",
        {
            "enabled": True,
            "interval_seconds": 86400,
            "max_alert_reviews": 25,
            "max_investigations": 5,
            "max_candidate_cases": 25,
            "auto_promote_candidates": True,
            "run_learning": True,
        },
    )
    assert daily_config[:4] == ["intelligence", "autopilot", "daily", "configure"]
    assert "--interval-seconds" in daily_config


def test_local_intelligence_rejects_arbitrary_prompts_commands_and_ids():
    with pytest.raises(ValueError):
        dashboard_server.build_intelligence_args(
            "enqueue",
            {"intelligence_action": "run_shell", "target_id": "FND-ABC123"},
        )
    with pytest.raises(ValueError):
        dashboard_server.build_intelligence_args("investigation-cancel", {"run_id": "../../bad"})
    with pytest.raises(ValueError):
        dashboard_server.build_intelligence_args(
            "enqueue",
            {"intelligence_action": "explain_finding", "target_id": "FND-1; rm -rf /"},
        )
    with pytest.raises(ValueError):
        dashboard_server.build_intelligence_args("service", {"service_action": "exec"})
    with pytest.raises(ValueError):
        dashboard_server.build_intelligence_args(
            "service",
            {"service_action": "install", "model": "kimi/model;curl example.invalid"},
        )


def test_artifact_fleet_actions_are_allowlisted_and_bounded():
    cycle = dashboard_server.build_artifact_fleet_args("cycle", {"since": "24h", "limit": 1000, "workers": 4})
    assert cycle[:5] == ["artifact-fleet", "cycle", "--since", "24h", "--limit"]
    assert "--workers" in cycle
    triage = dashboard_server.build_artifact_fleet_args("triage", {"limit": 500, "model": "xai/grok-4.6"})
    assert "--enqueue-model" in triage
    assert "xai/grok-4.6" in triage
    benchmark = dashboard_server.build_artifact_fleet_args("benchmark", {"artifacts": 1000000, "workers": 99})
    assert "250000" in benchmark
    assert "32" in benchmark
    with pytest.raises(ValueError):
        dashboard_server.build_artifact_fleet_args("shell", {})
    with pytest.raises(ValueError):
        dashboard_server.build_artifact_fleet_args("cycle", {"since": "24h;rm -rf /"})
    assert dashboard_server.SECOPSAI_ARTIFACT_FLEET_DB_PATH != dashboard_server.SECOPSAI_DB_PATH
    assert dashboard_server.artifact_fleet_db_args()[-1] == dashboard_server.SECOPSAI_ARTIFACT_FLEET_DB_PATH


def test_artifact_fleet_click_surface_is_present_and_static_only():
    html = (ROOT / "index.html").read_text(encoding="utf-8")
    app = (ROOT / "app.js").read_text(encoding="utf-8")
    server = (ROOT / "dashboard_server.py").read_text(encoding="utf-8")
    for marker in (
        "artifact-fleet-cycle-btn",
        "artifact-fleet-index-btn",
        "artifact-fleet-scan-btn",
        "artifact-fleet-triage-btn",
        "artifact-fleet-analyst-btn",
        "artifact-fleet-rules-btn",
        "artifact-fleet-benchmark-btn",
        "artifact-fleet-output",
    ):
        assert marker in html
    assert "runArtifactFleetAction" in app
    assert "/api/secopsai/artifact-fleet" in server
    assert "never install, execute, or activate" in html


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
        "intelligence-result-modal",
        "intelligence-result-body",
        "intelligence-result-copy",
        "intelligence-result-open-case",
        "intelligence-autopilot-mode",
        "intelligence-autopilot-model",
        "intelligence-autopilot-save",
        "intelligence-autopilot-run",
        "intelligence-autopilot-runs",
        "intelligence-autopilot-proposals",
        "investigation-autopilot-summary",
        "investigation-autopilot-runs",
        "investigation-run-due",
        "detection-learning-summary",
        "detection-learning-proposals",
        "detection-learning-deployments",
        "detection-learning-run",
        "daily-automation-summary",
        "daily-automation-save",
        "daily-automation-run",
        "daily-automation-steps",
    ):
        assert f'id="{element}"' in html
    assert "runIntelligenceAction('enqueue'" in app
    assert "Open full analysis" in app
    assert "data-intelligence-review" in app
    assert "function intelligenceResultView" in app
    assert "function renderIntelligenceResultModal" in app
    assert "function intelligenceResultMarkdown" in app
    assert "bridge.codex && typeof bridge.codex === 'object'" in app
    assert "Ready · stale probe" in app
    assert "autopilot-configure" in app
    assert "data-agent-triage-rollback" in app
    assert "Agent finding and alert review" in html
    assert "High-priority investigations" in html
    assert "Detection Learning" in html
    assert "learning-deploy" in app
    assert "daily-configure" in app
    assert "daily-run" in app
    assert "investigation-retry" in app
    assert "Missing local dependency exposure never proves an external package is safe" in html
    assert "Registry outages and collector failures use deterministic recovery checks" in html
    assert "target.source" in app
    assert "function renderAutopilotModelSelect" in app
    assert "select-model" in app
    assert "Other models are not probed" in app
    assert "Health checks and jobs use only this selection" in html
    assert "el('intelligence-autopilot-model')?.value" in app
    assert "function securitySourceLabel" in app
    assert "SecOpsAI Supply Chain" in app
    for section in (
        "Confirmed facts",
        "Reasonable inferences",
        "Unsupported claims",
        "Missing evidence",
        "Recommended next steps",
        "Publication risks",
        "Job audit history",
        "Normalized result",
    ):
        assert section in app
    assert "data-intelligence-service" in html
    assert "arbitrary prompt" not in html.lower()
    # Brief and publication-safety jobs are advisory records, not final
    # verdicts. Keep this contract explicit so a generic 0% field cannot be
    # rendered as a misleading decision.
    assert "finalVerdictAction" in app
    assert "verdictScopeMessage" in app
    assert "This action produced advisory analysis" in app
    assert "recovery_available" in app
    assert "Authentication session needs refresh." in app


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
