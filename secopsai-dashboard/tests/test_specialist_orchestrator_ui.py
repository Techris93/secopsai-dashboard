import json
import re
from html.parser import HTMLParser
from pathlib import Path

import pytest

import dashboard_server


ROOT = Path(__file__).resolve().parents[1]


class _IdAndButtonParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.ids = []
        self.specialist_buttons = []

    def handle_starttag(self, tag, attrs):
        values = dict(attrs)
        element_id = values.get("id", "")
        if element_id:
            self.ids.append(element_id)
        if tag == "button" and "specialist" in element_id:
            self.specialist_buttons.append(values)


def _decoded_task(args):
    return json.loads(args[args.index("--input-json") + 1])


def test_specialist_routes_are_typed_bounded_and_allowlisted():
    route = dashboard_server.build_specialist_args(
        "route",
        {
            "task": {
                "task_id": "WRK-123",
                "title": "Repair failing CI release gate",
                "description": "Use the failed job evidence and preserve blocking security checks.",
                "repo_alias": "secopsai",
                "evidence_refs": ["run:473"],
            },
            "tier": "read_only",
            "profile_id": "engineering/devops-automator",
        },
    )
    assert route[:2] == ["specialists", "route"]
    assert route[route.index("--tier") + 1] == "read_only"
    assert route[route.index("--profile") + 1] == "engineering/devops-automator"
    assert _decoded_task(route)["repo_alias"] == "secopsai"
    assert "--db-path" in route

    create = dashboard_server.build_specialist_args(
        "create",
        {"task": {"title": "Review telemetry query"}, "tier": "read_only", "enqueue": True},
    )
    assert "--enqueue" in create
    assert create[create.index("--requested-by") + 1] == "mission-control"

    automatic = dashboard_server.build_specialist_args(
        "auto-route", {"task": {"title": "Investigate an incident"}}
    )
    assert automatic[:2] == ["specialists", "auto-route"]
    assert automatic[automatic.index("--requested-by") + 1] == "mission-control-policy"


@pytest.mark.parametrize(
    ("action", "payload"),
    [
        ("route", {"task": {"title": "x", "repo_alias": "../../private"}}),
        ("route", {"task": {"title": "x", "evidence_refs": "not-a-list"}}),
        ("route", {"task": {"title": "x"}, "profile_id": "security/senior-secops;curl"}),
        ("create", {"task": {"title": "x"}, "tier": "worktree", "enqueue": True}),
        ("approve", {"run_id": "../../bad"}),
        ("execute", {"run_id": "SOR-123"}),
        ("policy", {"mode": "guarded", "maximum_automatic_tier": "worktree"}),
        ("shell", {"task": {"title": "x"}}),
    ],
)
def test_specialist_routes_reject_untrusted_or_unsafe_inputs(action, payload):
    with pytest.raises(ValueError):
        dashboard_server.build_specialist_args(action, payload)


def test_specialist_policy_never_automates_repository_edits():
    args = dashboard_server.build_specialist_args(
        "policy", {"mode": "guarded", "maximum_automatic_tier": "read_only"}
    )
    assert args[:4] == ["specialists", "policy", "--mode", "guarded"]
    assert args[args.index("--maximum-automatic-tier") + 1] == "read_only"
    assert args[args.index("--actor") + 1] == "mission-control"


def test_specialist_policy_form_preserves_and_verifies_operator_selection():
    app = (ROOT / "app.js").read_text(encoding="utf-8")
    assert "policyDirty: false" in app
    assert "policySaving: false" in app
    assert "!state.specialists.policyDirty && !state.specialists.policySaving" in app
    assert "state.specialists.policyDirty = true" in app
    assert "The saved specialist policy did not match your selection" in app
    assert "Specialist automatic routing policy saved and verified" in app


def test_specialist_response_redaction_removes_local_paths_and_raw_patches():
    payload = {
        "run_id": "SOR-0123456789ABCDEF",
        "worktree_path": "/private/worktree",
        "result": {
            "worktree": {"path": "/private/worktree", "branch": "safe-branch"},
            "git": {"patch": "secret local patch", "status": [" M app.js"]},
        },
    }
    cleaned = dashboard_server.redact_specialist_payload(payload)
    assert "worktree_path" not in cleaned
    assert "path" not in cleaned["result"]["worktree"]
    assert cleaned["result"]["worktree"]["branch"] == "safe-branch"
    assert "patch" not in cleaned["result"]["git"]
    assert cleaned["result"]["git"]["patch_available_locally"] is True


def test_specialist_work_surface_is_complete_accessible_and_single_instance():
    html = (ROOT / "index.html").read_text(encoding="utf-8")
    app = (ROOT / "app.js").read_text(encoding="utf-8")
    styles = (ROOT / "styles.css").read_text(encoding="utf-8")
    server = (ROOT / "dashboard_server.py").read_text(encoding="utf-8")

    for marker in (
        "specialist-orchestrator-title",
        "specialist-status-grid",
        "specialist-policy-mode",
        "specialist-policy-tier",
        "specialist-policy-save-btn",
        "specialist-route-next-btn",
        "specialist-roster",
        "specialist-runs",
        "prompt-specialist-select",
        "prompt-specialist-tier",
        "prompt-specialist-summary",
        "prompt-specialist-create-btn",
        "prompt-specialist-approve-btn",
        "prompt-specialist-execute-btn",
        "prompt-specialist-cancel-btn",
    ):
        assert f'id="{marker}"' in html
        assert html.count(f'id="{marker}"') == 1

    parser = _IdAndButtonParser()
    parser.feed(html)
    assert len(parser.ids) == len(set(parser.ids)), "dashboard IDs must remain unique"
    assert parser.specialist_buttons
    assert all(button.get("type") == "button" for button in parser.specialist_buttons)

    for function_name in (
        "renderSpecialistOverview",
        "loadSpecialists",
        "specialistApiAction",
        "saveSpecialistPolicy",
        "autoRouteNextWorkItem",
        "routePromptSpecialist",
        "createPromptSpecialistRun",
        "refreshPromptSpecialistRun",
        "mutatePromptSpecialistRun",
    ):
        assert f"function {function_name}" in app

    assert "X-SecOpsAI-Intelligence-Token" in app
    assert "No persisted OpenCodex model is available" in app
    assert "no silent model switching" in app.lower()
    assert "Reviewed base:" in app
    assert "network and external tools disabled" in app
    assert "OpenClaw and Hermes remain optional compatibility dispatch runtimes" in html
    assert "requestConfirmation('Approve this isolated worktree run?'" in app
    assert "requestConfirmation('Run the approved specialist in its isolated worktree now?'" in app
    assert "setInterval(() => refreshPromptSpecialistRun(), 4000)" in app
    assert "/api/secopsai/specialists" in server
    assert "if action != 'route' and require_intelligence_admin(self):" in server
    assert "subprocess" not in app
    assert ".specialist-orchestrator-card" in styles
    assert ".professional-ui .modal-head h3 { color: #17211e; }" in styles


def test_specialist_contract_copy_is_clear_about_model_and_safety_boundaries():
    html = (ROOT / "index.html").read_text(encoding="utf-8")
    app = (ROOT / "app.js").read_text(encoding="utf-8")
    combined = html + app
    for phrase in (
        "persisted OpenCodex model",
        "explicit fallback policy",
        "Independent reviewer",
        "Isolated worktree",
        "Merge, deploy, publish, disclosure",
    ):
        assert re.search(re.escape(phrase), combined, re.IGNORECASE)
