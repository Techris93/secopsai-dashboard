import json
from pathlib import Path
from types import SimpleNamespace

import pytest

import dashboard_server as server


@pytest.mark.parametrize("request_id,expected", [("review-request-fixture", 200), ("", 400)])
def test_operation_helper_preserves_exact_input_and_stable_identity(monkeypatch, request_id, expected):
    payload = {"action": "brief-approve", "actor": "human.editor", "request_id": request_id,
               "id": "BRIEF-fixture", "data": {"reviewed_draft": "Exact complete draft\nUnicode: λ", "expected_fingerprint": "a" * 64}}
    calls, response, files = [], [], []
    handler = SimpleNamespace(path="/api/secopsai/research-operation", _local_api_authorized=lambda parsed: True,
                              _has_sensitive_query=lambda query: False)
    monkeypatch.setattr(server, "read_request_json", lambda h: payload)
    monkeypatch.setattr(server, "require_intelligence_admin", lambda h: False)
    monkeypatch.setattr(server, "json_response", lambda h, status, body: response.append((status, body)))
    def run(args, timeout):
        calls.append(args)
        path = Path(args[args.index("--input") + 1])
        files.append(path)
        assert path.stat().st_mode & 0o777 == 0o600
        assert json.loads(path.read_text()) == payload["data"]
        return {"ok": True}, {"approved": True}
    monkeypatch.setattr(server, "run_cli_json", run)
    server.DashboardHandler.do_POST(handler)
    assert response[0][0] == expected
    if request_id:
        assert calls[0][calls[0].index("--command-id") + 1] == request_id
        assert not files[0].exists()
    else:
        assert not calls
