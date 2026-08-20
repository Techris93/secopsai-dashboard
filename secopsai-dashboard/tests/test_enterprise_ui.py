from pathlib import Path

import dashboard_server


ROOT = Path(__file__).resolve().parents[1]


def test_enterprise_surface_is_present_and_read_only_by_default():
    html = (ROOT / "index.html").read_text(encoding="utf-8")
    app = (ROOT / "app.js").read_text(encoding="utf-8")
    server = (ROOT / "dashboard_server.py").read_text(encoding="utf-8")
    for marker in ("page-enterprise", "enterprise-summary", "enterprise-refresh-btn", "enterprise-connector-list", "enterprise-workflow-list", "artifact-fleet-panel", "artifact-fleet-summary"):
        assert marker in html
    assert '"enterprise": "enterprise"' in app
    assert "loadEnterpriseStatus" in app
    assert "enterprise-status" in server
    assert "artifact-fleet-status" in server
    assert "read-only" in html


def test_enterprise_cli_status_is_allowlisted():
    args = dashboard_server.secopsai_db_args()
    assert args == ["--db-path", dashboard_server.SECOPSAI_DB_PATH] if dashboard_server.SECOPSAI_DB_PATH else args == []


def test_pages_deploy_workflow_is_token_safe_and_manual_or_main_only():
    workflow_path = ROOT.parent / ".github/workflows/deploy-pages.yml"
    workflow = workflow_path.read_text(encoding="utf-8")
    assert "CLOUDFLARE_API_TOKEN" in workflow
    assert "CLOUDFLARE_ACCOUNT_ID" in workflow
    assert "wrangler@latest pages deploy . --project-name secopsai-dashboard --branch main" in workflow
    assert "set -euo pipefail" in workflow
    assert "Check Cloudflare deployment configuration" in workflow
    assert "steps.config.outputs.configured == 'true'" in workflow
    assert "echo $CLOUDFLARE" not in workflow
