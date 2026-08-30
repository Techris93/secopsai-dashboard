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
    routing = dashboard_server.build_intelligence_args(
        "configure-models",
        {
            "primary_model": "xai/grok-4.6",
            "fallback_models": ["google-antigravity/gemini-3.5-flash-low", "gpt-5.6-sol"],
            "fallback_mode": "quota_auth",
        },
    )
    assert routing[:7] == [
        "intelligence", "bridge", "configure-models", "--primary", "xai/grok-4.6", "--fallback-mode", "quota_auth"
    ]
    assert routing.count("--fallback") == 2
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
    with pytest.raises(ValueError):
        dashboard_server.build_intelligence_args(
            "configure-models",
            {"primary_model": "xai/grok-4.6", "fallback_models": ["bad;curl"], "fallback_mode": "quota_auth"},
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
    assert "never installed, executed, or activated" in html


def test_source_first_research_actions_are_typed_and_allowlisted():
    preview = dashboard_server.build_source_first_research_args(
        "preview",
        {"ecosystem": "crates", "research_type": "package_compromise", "package": "proc-macro1", "version": "1.0.107", "comparison_package": "proc-macro2", "comparison_version": "1.0.107"},
    )
    assert preview[:6] == ["research", "investigate", "--ecosystem", "crates", "--research-type", "package_compromise"]
    assert "proc-macro1" in preview
    assert "--dry-run" in preview
    run = dashboard_server.build_source_first_research_args(
        "run",
        {"ecosystem": "npm", "research_type": "package_compromise", "package": "left-pad", "version": "1.3.0", "source_reference": "https://research.example/report", "persist_findings": True},
    )
    assert "--persist-findings" in run
    assert "--artifact-db-path" in run
    matrix = dashboard_server.build_source_first_research_args("matrix", {"case_id": "RSC-0123456789AB"})
    assert matrix[:4] == ["research", "workflow", "evidence-matrix", "RSC-0123456789AB"]
    draft = dashboard_server.build_source_first_research_args("draft", {"case_id": "RSC-0123456789AB"})
    assert draft[:4] == ["research", "case", "draft-blog", "RSC-0123456789AB"]
    queue = dashboard_server.build_source_first_research_args("queue", {"artifact_id": "ART-0123456789ABCDEF", "model": "xai/grok-4.6"})
    assert "--job-db-path" in queue
    assert "xai/grok-4.6" in queue
    with pytest.raises(ValueError):
        dashboard_server.build_source_first_research_args("run", {"ecosystem": "npm", "package": "bad;curl", "version": "1.0.0"})
    with pytest.raises(ValueError):
        dashboard_server.build_source_first_research_args("run", {"ecosystem": "crates", "package": "crate", "version": "1.0.0", "source_reference": "file:///tmp/private"})


def test_source_first_research_dashboard_surface_is_present():
    html = (ROOT / "index.html").read_text(encoding="utf-8")
    app = (ROOT / "app.js").read_text(encoding="utf-8")
    server = (ROOT / "dashboard_server.py").read_text(encoding="utf-8")
    for marker in ("source-first-research-panel", "source-research-ecosystem", "source-research-subject", "source-research-preview-btn", "source-research-run-btn", "source-research-matrix-btn", "source-research-queue-btn", "source-research-draft-btn", "source-research-open-case-btn", "source-research-copy-btn", "source-research-create-case", "source-research-output"):
        assert marker in html
    assert "runSourceFirstResearchAction" in app
    assert "/api/secopsai/source-first-research" in server
    assert "build_source_first_research_args" in server
    assert "EXACT CRATES.IO INTAKE" not in html
    assert "Run Rust package research" not in html
    assert 'id="automation-research-section"' in html
    assert 'data-automation-view="research"' in html
    assert 'id="enterprise-open-research-pipeline-btn"' in html
    assert html.count('id="source-first-research-panel"') == 1


def test_research_case_reliability_ui_exposes_adjudication_and_visual_metadata():
    html = (ROOT / "index.html").read_text(encoding="utf-8")
    app = (ROOT / "app.js").read_text(encoding="utf-8")
    server = (ROOT / "dashboard_server.py").read_text(encoding="utf-8")
    assert "research-reliability-adjudicate-btn" in app
    assert "research-adjudication-rationale" in app
    assert "Human adjudication required" in app
    assert "adjudicate_review: 'research-reliability-adjudicate-btn'" in app
    assert "Resolved by" in app
    for marker in ("research-evidence-visual-viewport", "research-evidence-alt-text", "research-evidence-license", "research-evidence-source-attribution"):
        assert marker in app
    assert "reliability-adjudicate" in server
    assert "--visual-viewport" in server


def test_operator_guide_documents_execution_grounded_research_flow():
    html = (ROOT / "index.html").read_text(encoding="utf-8")
    for marker in (
        'id="guide-reliability"',
        "Scaffold Research",
        "Verify Transition",
        "Human adjudication required",
        "Publication Safety",
    ):
        assert marker in html


def test_model_routing_ui_persists_the_new_selection_before_refresh():
    html = (ROOT / "index.html").read_text(encoding="utf-8")
    app = (ROOT / "app.js").read_text(encoding="utf-8")
    for marker in (
        "intelligence-model-select",
        "intelligence-fallback-mode",
        "intelligence-model-search",
        "intelligence-model-catalog",
        "intelligence-routing-save-btn",
        "intelligence-routing-recommended-btn",
    ):
        assert f'id="{marker}"' in html
    assert "pendingSelectedModel" in app
    assert "runIntelligenceAction('configure-models'" in app
    assert "fallback_models" in app
    assert "fallback_mode" in app
    assert "Other models are not probed or used" not in app
    assert "const initialPage = currentPageFromLocation();" in app
    assert "collapseSidebarForInitialRoute(initialPage);" in app
    assert "setPage(initialPage, { skipHistory: true, scrollToTarget: false })" in app
    assert 'name="secopsai-model-catalog-filter"' in html
    assert 'name="secopsai-automation-token"' in html
    assert 'id="intelligence-admin-token" type="password" autocomplete="current-password"' not in html
    assert "search.value = state.intelligence.modelSearch" in app


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
        "detection-learning-current",
        "detection-learning-adjudication",
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
    assert "intelligence-decision-card" in app
    assert "intelligencePipelineGroups" in app
    assert "research-decision-card" in app
    assert "const artifacts = researchCase.artifacts || [];" in app
    assert "publication_readiness_state" in app
    assert "const rawReadiness = researchCase.publication_readiness;" in app
    assert "id=\"research-detail-impact\"" in app
    assert "potential_impact: el('research-detail-impact')?.value" in app
    assert "data-intelligence-review" in app
    assert "function intelligenceResultView" in app
    assert "function renderIntelligenceResultModal" in app
    assert "function intelligenceResultMarkdown" in app
    assert "bridge.codex && typeof bridge.codex === 'object'" in app
    assert "Ready · stale probe" in app
    assert "Busy · lease active" in app
    assert "bridge.active_job_id" in app
    assert "bridge.active_model" in app
    assert "autopilot-configure" in app
    assert "data-agent-triage-rollback" in app
    assert "Agent finding and alert review" in html
    assert "High-priority investigations" in html
    assert "Detection Learning" in html
    assert "Adjudication</strong> means an operator still needs to decide a finding using evidence" in html
    assert "Rejected by guardrails</strong> means a proposed ranker failed a safety threshold" in html
    assert "Subjects needing evidence" in app
    assert "No production detector changed" in app
    assert "False-positive rate" in app
    assert "Evaluation history" in app
    assert "Stale evaluation" in app
    assert "Stop and retain audit" in app
    assert "learningSummary.awaiting_adjudication" in app
    assert "data-learning-review-finding" in app
    assert "learning-deploy" in app
    assert "daily-configure" in app
    assert "daily-run" in app
    assert "investigation-retry" in app
    assert "Missing local dependency exposure never proves an external package is safe" in html
    assert "Registry outages and collector failures use deterministic recovery checks" in html
    assert "target.source" in app
    assert "function renderAutopilotModelSelect" in app
    assert "configure-models" in app
    assert "Effective chain:" in app
    assert "No fallback models are enabled" in app
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
