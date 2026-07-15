from pathlib import Path

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
        "prepare-disclosure",
        "sandbox-request",
        "job-retry",
        "job-cancel",
    ):
        assert f"runResearchCaseAction('{action}'" in source
    assert "Run Safe Package Intake" in source
    assert "Attach Verified Evidence" in source


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
