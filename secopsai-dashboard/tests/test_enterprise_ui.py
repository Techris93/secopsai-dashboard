import json
from pathlib import Path

import dashboard_server
import pytest


ROOT = Path(__file__).resolve().parents[1]


def test_enterprise_surface_has_monitor_assess_and_govern_workflows():
    html = (ROOT / "index.html").read_text(encoding="utf-8")
    app = (ROOT / "app.js").read_text(encoding="utf-8")
    server = (ROOT / "dashboard_server.py").read_text(encoding="utf-8")
    for marker in (
        "page-enterprise",
        "enterprise-summary",
        "enterprise-refresh-btn",
        "enterprise-connector-list",
        "enterprise-activity-list",
        "enterprise-vuln-run-btn",
        "enterprise-kubernetes-run-btn",
        "enterprise-dast-run-btn",
        "enterprise-control-save-btn",
        "enterprise-workflow-save-btn",
        "artifact-fleet-panel",
        "artifact-fleet-summary",
        "guide-enterprise",
    ):
        assert marker in html
    assert '"enterprise": "enterprise"' in app
    assert "loadEnterpriseStatus" in app
    assert "runEnterpriseAction" in app
    assert "Implemented</strong> means the parser or workflow exists" in html
    assert "enterprise-status" in server
    assert "enterprise-action" in server
    assert "artifact-fleet-status" in server
    assert "read-only" in html.lower()


def test_enterprise_cli_status_uses_the_enterprise_store():
    args = dashboard_server.enterprise_db_args()
    expected = ["--db-path", dashboard_server.SECOPSAI_ENTERPRISE_DB_PATH] if dashboard_server.SECOPSAI_ENTERPRISE_DB_PATH else []
    assert args == expected


def test_enterprise_actions_are_typed_and_do_not_accept_browser_paths():
    ingest = dashboard_server.build_enterprise_action_spec(
        "ingest-events",
        {"source": "aws.cloudtrail", "events": [{"eventID": "evt-1", "eventName": "ConsoleLogin"}]},
    )
    assert ingest["args"][:4] == ["enterprise", "ingest", "--source", "aws.cloudtrail"]
    assert "{input}" in ingest["args"]
    assert "/tmp/operator-supplied" not in ingest["args"]

    kubernetes = dashboard_server.build_enterprise_action_spec(
        "kubernetes-scan", {"manifest": "apiVersion: v1\nkind: Pod\nmetadata:\n  name: safe"}
    )
    assert kubernetes["args"][:3] == ["enterprise", "kubernetes-scan", "--path"]
    assert kubernetes["args"][3] == "{input}"

    dast = dashboard_server.build_enterprise_action_spec(
        "dast-validate",
        {"target_id": "web-1", "url": "https://app.example", "owner": "security", "authorized_by": "change-123", "mode": "passive"},
    )
    assert dast["args"][:4] == ["enterprise", "dast-validate", "--target-id", "web-1"]
    assert "--active-approved" not in dast["args"]
    with pytest.raises(ValueError, match="explicit approval"):
        dashboard_server.build_enterprise_action_spec(
            "dast-validate",
            {"target_id": "web-1", "url": "https://app.example", "owner": "security", "authorized_by": "change-123", "mode": "active"},
        )
    with pytest.raises(ValueError, match="explicit HTTPS"):
        dashboard_server.build_enterprise_action_spec(
            "dast-validate",
            {"target_id": "web-1", "url": "file:///tmp/operator-supplied", "owner": "security", "authorized_by": "change-123"},
        )
    with pytest.raises(ValueError, match="Unsupported enterprise telemetry source"):
        dashboard_server.build_enterprise_action_spec("ingest-events", {"source": "shell", "events": [{}]})


def test_enterprise_vulnerability_and_governance_actions_are_bounded():
    vulnerability = dashboard_server.build_enterprise_action_spec(
        "prioritize-vulnerability",
        {
            "advisory_id": "CVE-2026-1234",
            "package_name": "example/package",
            "package_version": "1.2.3",
            "cvss_score": 9.8,
            "exploitability_score": 8.0,
            "asset_criticality": "critical",
        },
    )
    assert vulnerability["args"][:3] == ["enterprise", "prioritize-vulnerability", "--input"]
    control = dashboard_server.build_enterprise_action_spec(
        "control",
        {"control_id": "AC-1", "framework": "soc2", "title": "Access review", "owner": "Security", "status": "in_progress"},
    )
    assert control["args"][:4] == ["enterprise", "control", "--control-id", "AC-1"]
    workflow = dashboard_server.build_enterprise_action_spec(
        "workflow",
        {"kind": "threat-model", "record": {"threat_model_id": "TM-1", "title": "API threats", "owner": "Security", "assets": ["API"], "threats": ["Replay"], "mitigations": ["Short-lived tokens"]}},
    )
    assert workflow["args"][:4] == ["enterprise", "workflow", "threat-model", "--input"]
    with pytest.raises(ValueError, match="0 to 10"):
        dashboard_server.build_enterprise_action_spec(
            "prioritize-vulnerability",
            {"advisory_id": "CVE-1", "package_name": "pkg", "cvss_score": 11, "exploitability_score": 0},
        )


def test_enterprise_questionnaire_action_round_trips_question_text(tmp_path, monkeypatch):
    db_path = tmp_path / "enterprise.db"
    monkeypatch.setattr(dashboard_server, "SECOPSAI_ENTERPRISE_DB_PATH", str(db_path))
    captured = {}

    def fake_run_cli_json(args, timeout):
        input_path = Path(args[args.index("--input") + 1])
        captured["input_path"] = input_path
        captured["payload"] = json.loads(input_path.read_text(encoding="utf-8"))
        return {"ok": True}, {"payload": captured["payload"]}

    monkeypatch.setattr(dashboard_server, "run_cli_json", fake_run_cli_json)
    result, payload = dashboard_server.run_enterprise_action(
        "workflow",
        {
            "kind": "questionnaire",
            "record": {
                "questionnaire_id": "Q-2026-001",
                "title": "Customer security review",
                "owner": "Product Security",
                "customer": "Example customer",
                "questions": [{"question_id": "Q-2026-001-Q1", "question": "How is privileged access reviewed?", "answer": "Quarterly.", "status": "draft"}],
            },
        },
    )
    assert result["ok"] is True
    assert payload["payload"]["questions"][0]["question"] == "How is privileged access reviewed?"
    assert captured["payload"]["questionnaire_id"] == "Q-2026-001"
    assert not captured["input_path"].exists()


def test_pages_deploy_workflow_is_token_safe_and_manual_or_main_only():
    html = (ROOT / "index.html").read_text(encoding="utf-8")
    app = (ROOT / "app.js").read_text(encoding="utf-8")
    server = (ROOT / "dashboard_server.py").read_text(encoding="utf-8")
    workflow_path = ROOT.parent / ".github/workflows/deploy-pages.yml"
    workflow = workflow_path.read_text(encoding="utf-8")
    assert "CLOUDFLARE_API_TOKEN" in workflow
    assert "CLOUDFLARE_ACCOUNT_ID" in workflow
    assert "wrangler@latest pages deploy . --project-name secopsai-dashboard --branch main" in workflow
    assert "set -euo pipefail" in workflow
    assert "Check Cloudflare deployment configuration" in workflow
    assert "steps.config.outputs.configured == 'true'" in workflow
    assert "echo $CLOUDFLARE" not in workflow
