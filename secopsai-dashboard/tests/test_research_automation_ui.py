from pathlib import Path
import pytest

import dashboard_server


ROOT = Path(__file__).resolve().parents[1]


def test_research_actions_are_typed_and_not_shell_commands():
    source = (ROOT / "app.js").read_text(encoding="utf-8")
    for action in (
        "intake-preview",
        "intake-run",
        "intake-attach",
        "evidence-matrix",
        "analyst-brief",
        "verdict",
        "publication-check",
        "publication-approve",
        "suggest-disclosure",
        "prepare-disclosure",
        "sandbox-request",
        "job-retry",
        "job-cancel",
        "pipeline-start",
        "pipeline-resume",
        "pipeline-review",
        "resolution-configure",
        "resolution-run",
        "resolution-review",
    ):
        assert f"runResearchCaseAction('{action}'" in source
    assert "Run Safe Package Intake" in source
    assert "Attach Verified Evidence" in source
    assert "Run Investigation Pipeline" in source
    assert "Local Codex Bridge" in source
    assert "This view updates automatically." in source
    assert "syncResearchPipelinePolling()" in source
    assert "Add reference and rerun analysis" in source
    assert "revisionPrefix" in source
    assert "pipeline.status === 'awaiting_review'" in source
    assert "groupedItems" in source
    assert "No export or upload" not in source
    assert "without exporting files or copying prompts" in source
    preview = (ROOT / "tests" / "fixtures" / "research-pipeline-preview.html").read_text(encoding="utf-8")
    assert "GUARDED AGENT REVIEW" in preview
    assert "Evidence and agent decision queue" in preview
    assert "Complete Agent Review" in source
    assert "Resolved by agents" in source
    assert "Agent resolution policy" in source
    assert "researchCaseActionQueues" in source
    assert "Core did not persist" in source
    assert "Core did not confirm alert" in source
    assert "applyNativeFindingStatuses" in source
    assert "finding?.finding_id || finding?.id" in source
    assert "nativeCloseDraft" in source
    styles = (ROOT / "styles.css").read_text(encoding="utf-8")
    assert ".research-pipeline-targets {\n  grid-template-columns: repeat(2, minmax(0, 1fr));" in styles


def test_helper_research_actions_map_to_allowlisted_cli_args():
    args = dashboard_server.build_research_case_args(
        "intake-run",
        {"case_id": "RSC-AAAAAAAAAAAA", "ecosystem": "npm", "package": "chalk-tempalte"},
    )
    assert args[:4] == ["research", "intake", "run", "--case"]
    assert "--package" in args
    assert all("shell" not in item.lower() for item in args)

    preview = dashboard_server.build_research_case_args(
        "intake-preview", {"ecosystem": "pypi", "package": "example"}
    )
    assert preview == ["research", "intake", "preview", "--ecosystem", "pypi", "--package", "example"]


def test_helper_rejects_untrusted_case_arguments():
    try:
        dashboard_server.build_research_case_args(
            "intake-run",
            {"case_id": "RSC-AAAAAAAAAAAA", "ecosystem": "npm", "package": "bad;rm -rf /"},
        )
    except ValueError:
        return
    raise AssertionError("unsafe package input was accepted")


def test_dashboard_uses_one_explicit_core_database_for_persistent_actions():
    assert dashboard_server.SECOPSAI_DB_PATH.endswith(
        "/secopsai/data/openclaw/findings/openclaw_soc.db"
    )
    assert dashboard_server.secopsai_db_args() == [
        "--db-path",
        dashboard_server.SECOPSAI_DB_PATH,
    ]


def test_finding_id_validator_accepts_all_core_namespace_lengths():
    accepted = (
        "OCF-AAAAAAAAAAAAAAAA",
        "AIDG-BBBBBBBBBBBBBBBB",
        "EDGE-CCCCCCCCCCCCCCCC",
        "SCM-DDDDDDDDDDDDDDDD",
    )
    for value in accepted:
        assert dashboard_server.FINDING_ID_RE.fullmatch(value), value
    assert not dashboard_server.FINDING_ID_RE.fullmatch("edge-CCCCCCCCCCCCCCCC")
    assert not dashboard_server.FINDING_ID_RE.fullmatch("EDGE-")
    assert not dashboard_server.FINDING_ID_RE.fullmatch("EDGE bad-CCCC")


def test_triage_state_exposes_persisted_native_statuses(monkeypatch):
    monkeypatch.setattr(
        dashboard_server,
        "run_secopsai_triage_summary",
        lambda: {"open_findings": 1, "findings": []},
    )

    def fake_list(status="open", limit=20):
        if status == "open":
            return {"findings": [{"finding_id": "EDGE-AAAAAAAAAAAAAAAA", "status": "open", "severity": "low"}]}
        return {
            "findings": [
                {
                    "finding_id": "EDGE-AAAAAAAAAAAAAAAA",
                    "status": "closed",
                    "disposition": "expected_behavior",
                    "last_seen": "2026-08-02T12:00:00Z",
                },
                {
                    "finding_id": "SCM-BBBBBBBBBBBBBBBB",
                    "status": "in_review",
                    "disposition": "unreviewed",
                    "last_seen": "2026-08-02T12:01:00Z",
                },
            ]
        }

    monkeypatch.setattr(dashboard_server, "run_secopsai_triage_list", fake_list)
    monkeypatch.setattr(dashboard_server, "list_session_payloads", lambda limit=25: [])
    dashboard_server.invalidate_native_status_cache()
    payload = dashboard_server.collect_secopsai_triage_state()
    statuses = {item["finding_id"]: item for item in payload["native_statuses"]}
    assert statuses["EDGE-AAAAAAAAAAAAAAAA"]["status"] == "closed"
    assert statuses["EDGE-AAAAAAAAAAAAAAAA"]["disposition"] == "expected_behavior"
    assert statuses["SCM-BBBBBBBBBBBBBBBB"]["status"] == "in_review"


def test_pipeline_actions_map_to_typed_core_commands():
    start = dashboard_server.build_research_case_args(
        "pipeline-start",
        {
            "case_id": "RSC-AAAAAAAAAAAA",
            "reference_ecosystem": "nuget",
            "reference_package": "Braintree",
            "reference_version": "5.30.0",
            "actor": "dashboard-operator",
        },
    )
    assert start[:4] == ["research", "pipeline", "start", "RSC-AAAAAAAAAAAA"]
    assert "--reference-package" in start

    resume = dashboard_server.build_research_case_args(
        "pipeline-resume",
        {"pipeline_id": "RPL-AAAAAAAAAAAAAAAA", "reference_ecosystem": "npm", "reference_package": "braintree-web"},
    )
    assert resume[:4] == ["research", "pipeline", "resume", "RPL-AAAAAAAAAAAAAAAA"]

    review = dashboard_server.build_research_case_args(
        "pipeline-review",
        {
            "pipeline_id": "RPL-AAAAAAAAAAAAAAAA",
            "item_id": "RVI-BBBBBBBBBBBBBBBB",
            "decision": "accepted",
            "edited_content": "Evidence-backed edited proposal.",
        },
    )
    assert review[:5] == ["research", "pipeline", "review", "RPL-AAAAAAAAAAAAAAAA", "RVI-BBBBBBBBBBBBBBBB"]
    assert "--decision" in review

    agent_complete = dashboard_server.build_research_case_args(
        "pipeline-auto-review",
        {"pipeline_id": "RPL-AAAAAAAAAAAAAAAA", "actor": "secopsai-agent-autonomy"},
    )
    assert agent_complete[:4] == ["research", "pipeline", "agent-complete", "RPL-AAAAAAAAAAAAAAAA"]
    assert agent_complete[-2:] == ["--actor", "secopsai-agent-autonomy"]


def test_agent_resolution_actions_are_typed_guarded_and_reversible():
    configure = dashboard_server.build_research_case_args(
        "resolution-configure",
        {
            "mode": "guarded",
            "min_confidence": 92,
            "min_evidence_refs": 4,
            "max_cases_per_cycle": 10,
            "auto_retract_rules": True,
        },
    )
    assert configure[:4] == ["research", "resolution", "configure", "--mode"]
    assert "guarded" in configure
    assert "--auto-retract-rules" in configure

    run = dashboard_server.build_research_case_args(
        "resolution-run", {"pipeline_id": "RPL-AAAAAAAAAAAAAAAA"}
    )
    assert run[:4] == ["research", "resolution", "run", "RPL-AAAAAAAAAAAAAAAA"]

    reopen = dashboard_server.build_research_case_args(
        "resolution-review", {"run_id": "ARR-BBBBBBBBBBBBBBBB", "decision": "reopen"}
    )
    assert reopen[:4] == ["research", "resolution", "review", "ARR-BBBBBBBBBBBBBBBB"]
    assert reopen[-4:] == ["--decision", "reopen", "--actor", "mission-control"]

    with pytest.raises(ValueError):
        dashboard_server.build_research_case_args(
            "resolution-review", {"run_id": "ARR-BBBBBBBBBBBBBBBB", "decision": "publish"}
        )


def test_pipeline_gateway_rejects_untrusted_targets_and_decisions():
    with pytest.raises(ValueError):
        dashboard_server.build_research_case_args(
            "pipeline-start",
            {"case_id": "RSC-AAAAAAAAAAAA", "reference_ecosystem": "npm", "reference_package": "bad; curl evil"},
        )
    with pytest.raises(ValueError):
        dashboard_server.build_research_case_args(
            "pipeline-review",
            {"pipeline_id": "RPL-AAAAAAAAAAAAAAAA", "item_id": "RVI-BBBBBBBBBBBBBBBB", "decision": "publish"},
        )


def test_research_discovery_commands_are_allowlisted_and_cross_ecosystem():
    assert dashboard_server.build_research_discovery_args("capabilities") == ["research", "ecosystems"]
    args = dashboard_server.build_research_discovery_args(
        "watchlist-add",
        {"ecosystem": "nuget", "watch_type": "brand", "identifier": "Braintree", "threshold": 78},
    )
    assert args[:6] == ["research", "watchlist", "add", "--ecosystem", "nuget", "--watch-type"]
    assert "Braintree" in args
    assert ";" not in " ".join(args)
    assert dashboard_server.build_research_discovery_args("monitor-run-due", {"limit": 10})[-1] == "10"
    policy = dashboard_server.build_research_discovery_args(
        "promotion-policy-set",
        {"ecosystem": "nuget", "enabled": True, "score_threshold": 94, "minimum_evidence": 3, "require_publisher": True, "mode": "draft_case"},
    )
    assert policy[:4] == ["research", "candidate", "promotion-policy", "--ecosystem"]
    assert "--set" in policy and "--require-publisher" in policy
    apply_policy = dashboard_server.build_research_discovery_args("promotion-policy-apply", {"ecosystem": "nuget", "limit": 20})
    assert apply_policy[:4] == ["research", "candidate", "run-promotion-policy", "--ecosystem"]
    assert "--apply" in apply_policy


def test_research_discovery_selector_tracks_the_selected_ecosystem():
    source = (ROOT / "app.js").read_text(encoding="utf-8")
    assert "function syncResearchDiscoveryWatchlistOptions()" in source
    assert "addEventListener('change', syncResearchDiscoveryWatchlistOptions)" in source
    assert "watchlist.ecosystem !== ecosystem" in source
    assert "Select a ${escapeHtml(ecosystem)} watchlist" in source


def test_sandbox_approval_requires_public_acknowledgement():
    with pytest.raises(ValueError):
        dashboard_server.build_research_case_args(
            "sandbox-approve",
            {"request_id": "SBX-AAAAAAAAAAAAAAAA", "public_submission_acknowledged": False},
        )


def test_manual_sandbox_handoff_is_approval_gated_and_hash_identified():
    app = (ROOT / "app.js").read_text(encoding="utf-8")
    server = (ROOT / "dashboard_server.py").read_text(encoding="utf-8")
    assert "downloadApprovedSandboxArtifact" in app
    assert "Download exact sample" in app
    assert "Record manual Tria.ge result" in app
    assert "Attach sanitized result" in app
    assert "public_submission_acknowledged: true" in app
    assert "/api/secopsai/research-artifacts/manual-sandbox-download" in app
    assert "/api/secopsai/research-artifacts/manual-sandbox-download" in server
    assert "research', 'sandbox', 'prepare-manual'" in server
    assert "X-SecOpsAI-Artifact-SHA256" in server
    assert "require_triage_ops_admin(self)" in server
    assert "shutil.rmtree(export_dir, ignore_errors=True)" in server


def test_research_case_recommendation_is_conservative_and_explains_create_route():
    recommendation = dashboard_server.build_research_case_recommendation(
        {
            "finding_id": "SCM-CASE123",
            "campaign": {
                "campaign_id": "payment-skimmer-campaign",
                "title": "Payment package impersonation",
                "source_urls": ["https://research.example/report"],
                "behavioral_indicators": ["credential theft"],
                "packages": [
                    {"ecosystem": "npm", "package": "payments-helper", "version": "1.2.3"},
                    {"ecosystem": "npm", "package": "payments-helper-lite", "version": "1.2.3"},
                ],
            },
            "orchestrator": {
                "recommended_route": "campaign_research",
                "confidence": "high",
                "validated_iocs": {"domains": ["checkout-telemetry.example"]},
            },
        }
    )

    assert recommendation["route"] == "create_draft_case"
    assert recommendation["suggested_case"]["case_type"] == "supply_chain_campaign"
    assert len(recommendation["suggested_case"]["subjects"]) == 2
    assert recommendation["checks"]["source_finding_id"] == "SCM-CASE123"
    assert any("normalized package subject" in reason for reason in recommendation["reasons"])


def test_research_case_recommendation_keeps_non_package_route_in_triage():
    recommendation = dashboard_server.build_research_case_recommendation(
        {
            "campaign": {
                "title": "CVE tracking lead",
                "packages": [{"ecosystem": "npm", "package": "example-package", "version": "1.0.0"}],
            },
            "orchestrator": {"recommended_route": "vulnerability_tracking"},
        }
    )

    assert recommendation["route"] == "keep_in_triage"
    assert any("vulnerability tracking" in blocker for blocker in recommendation["blockers"])


def test_research_case_recommendation_does_not_promote_empty_lead():
    recommendation = dashboard_server.build_research_case_recommendation(
        {"campaign": {"title": "Unresolved lead", "packages": []}}
    )

    assert recommendation["route"] == "keep_in_triage"
    assert recommendation["suggested_case"]["subjects"] == []
    assert any("Add or validate a package" in blocker for blocker in recommendation["blockers"])
