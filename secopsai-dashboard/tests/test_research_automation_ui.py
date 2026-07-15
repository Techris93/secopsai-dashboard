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
