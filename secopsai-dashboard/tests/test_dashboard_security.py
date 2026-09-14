import re
import unittest
from io import BytesIO
import json
from pathlib import Path
import tempfile
from urllib.parse import urlparse

import dashboard_server


ROOT = Path(__file__).resolve().parents[1]


class DashboardSecurityMigrationTests(unittest.TestCase):
    def test_current_findings_migration_does_not_grant_anonymous_access(self):
        sql = (ROOT / "supabase_migrations" / "2026-03-28_findings.sql").read_text(encoding="utf-8")
        self.assertNotIn('create policy "allow read findings"', sql.lower())
        self.assertNotRegex(sql.lower(), r"create\s+policy[\s\S]{0,180}to\s+anon")
        self.assertIn("to authenticated", sql.lower())

    def test_pilot_security_migration_covers_every_browser_table(self):
        sql = (ROOT / "supabase_migrations" / "2026-07-13_authenticated_pilot.sql").read_text(
            encoding="utf-8"
        )
        for table in (
            "agent_runs",
            "channel_routes",
            "dashboard_events",
            "findings",
            "run_requests",
            "work_items",
        ):
            self.assertRegex(sql, rf"'{re.escape(table)}'")
        self.assertIn("revoke all privileges on table", sql.lower())
        self.assertIn("from anon", sql.lower())
        self.assertIn("to authenticated", sql.lower())
        self.assertIn("is_anonymous", sql.lower())
        self.assertIn("security_invoker", sql.lower())

    def test_pilot_security_migration_has_no_unconditional_rls_predicate(self):
        sql = (ROOT / "supabase_migrations" / "2026-07-13_authenticated_pilot.sql").read_text(
            encoding="utf-8"
        )
        self.assertNotRegex(sql.lower(), r"(?:using|with\s+check)\s*\(\s*true\s*\)")

    def test_edge_workspace_surfaces_core_sync_freshness(self):
        app = (ROOT / "app.js").read_text(encoding="utf-8")
        self.assertIn("core.sync_state", app)
        self.assertIn("Edge to Core sync", app)
        self.assertIn("syncStale", app)

    def test_local_helper_rejects_credential_query_parameters(self):
        self.assertTrue(dashboard_server.DashboardHandler._has_sensitive_query("email=operator%40example.com&password=secret"))
        self.assertTrue(dashboard_server.DashboardHandler._has_sensitive_query("token=secret"))
        self.assertFalse(dashboard_server.DashboardHandler._has_sensitive_query("route=overview"))

    def test_local_static_fallback_is_allowlisted_and_excludes_dotfiles_and_logs(self):
        for path in ("/", "/index.html", "/app.js", "/url-safety.js", "/view-run-output.html"):
            self.assertTrue(dashboard_server.DashboardHandler._is_public_static_path(path), path)
        for path in ("/config.js", "/.env", "/.dev.vars.example", "/dashboard.log", "/dashboard_debug.log", "/logs/run.txt", "/tests/fixture.json", "/%2eenv"):
            self.assertFalse(dashboard_server.DashboardHandler._is_public_static_path(path), path)
        source = (ROOT / "dashboard_server.py").read_text(encoding="utf-8")
        self.assertIn("def _serve_local_bootstrap_config", source)
        self.assertIn("if parsed.path == '/config.js':", source)
        generator = (ROOT / "generate-config.py").read_text(encoding="utf-8")
        self.assertIn("json.dumps(str(value)", generator)

    def test_local_api_requires_bearer_even_on_loopback_but_health_is_public(self):
        self.assertTrue(dashboard_server.DashboardHandler._is_loopback_host('127.0.0.1'))
        self.assertTrue(dashboard_server.DashboardHandler._is_loopback_host('::1'))
        self.assertTrue(dashboard_server.DashboardHandler._is_loopback_host('localhost'))
        self.assertFalse(dashboard_server.DashboardHandler._is_loopback_host('0.0.0.0'))
        source = (ROOT / 'dashboard_server.py').read_text(encoding='utf-8')
        self.assertIn('Refusing non-loopback dashboard binding without DASHBOARD_LOCAL_AUTH_TOKEN', source)
        self.assertIn('X-SecOpsAI-Local-Token', source)

        class FakeServer:
            server_address = ('127.0.0.1', 45680)

        class FakeHandler:
            server = FakeServer()

            def __init__(self, command='GET', headers=None):
                self.command = command
                self.headers = headers or {}
                self.status = None
                self.response_headers = {}
                self.wfile = BytesIO()

            def send_response(self, status):
                self.status = status

            def send_header(self, name, value):
                self.response_headers[name] = value

            def end_headers(self):
                return None

        old_token = dashboard_server.DASHBOARD_LOCAL_AUTH_TOKEN
        try:
            dashboard_server.DASHBOARD_LOCAL_AUTH_TOKEN = ''
            no_token = FakeHandler()
            self.assertFalse(dashboard_server.DashboardHandler._local_api_authorized(no_token, urlparse('/api/integration-status')))
            self.assertEqual(no_token.status, 503)

            health = FakeHandler()
            self.assertTrue(dashboard_server.DashboardHandler._local_api_authorized(health, urlparse('/api/healthz')))
            post_health = FakeHandler(command='POST')
            self.assertFalse(dashboard_server.DashboardHandler._local_api_authorized(post_health, urlparse('/api/healthz')))
            self.assertEqual(post_health.status, 503)

            dashboard_server.DASHBOARD_LOCAL_AUTH_TOKEN = 'local-test-token'
            wrong_token = FakeHandler(headers={'Authorization': 'Bearer wrong'})
            self.assertFalse(dashboard_server.DashboardHandler._local_api_authorized(wrong_token, urlparse('/api/integration-status')))
            self.assertEqual(wrong_token.status, 401)
            bearer = FakeHandler(headers={'Authorization': 'Bearer local-test-token'})
            self.assertTrue(dashboard_server.DashboardHandler._local_api_authorized(bearer, urlparse('/api/integration-status')))
            local_header = FakeHandler(headers={'X-SecOpsAI-Local-Token': 'local-test-token'})
            self.assertTrue(dashboard_server.DashboardHandler._local_api_authorized(local_header, urlparse('/api/integration-status')))
        finally:
            dashboard_server.DASHBOARD_LOCAL_AUTH_TOKEN = old_token

    def test_local_bootstrap_is_explicit_and_rejects_server_credentials(self):
        class FakeHandler:
            def __init__(self):
                self.status = None
                self.headers = {}
                self.wfile = BytesIO()

            def send_response(self, status):
                self.status = status

            def send_header(self, name, value):
                self.headers[name] = value

            def end_headers(self):
                return None

        public_config = {
            'supabaseUrl': 'https://example.supabase.co',
            'supabaseAnonKey': 'public-anon-key',
            'appName': 'Test dashboard',
            'integrationStatusEndpoint': '/api/integration-status',
            'runOutputEndpoint': '/api/run-output',
            'triageOpsEndpoint': '/api/secopsai/triage-ops',
            'researchCasesEndpoint': '/api/secopsai/research-cases',
            'researchDiscoveryEndpoint': '/api/secopsai/research-discovery',
            'intelligenceEndpoint': '/api/secopsai/intelligence',
            'ontologyEndpoint': '/api/secopsai/ontology',
            'edgeWorkspaceEndpoint': '/api/secopsai/edge-workspace',
            'edgeDashboardUrl': '',
            'auth': {'required': True},
            'aiGuard': {'hostedEnabled': False, 'defaultModel': 'gpt-5.4-mini', 'maxCostUsd': 3, 'allowMutations': False},
            'departments': {'exec': '#06B6D4', 'platform': '#3B82F6', 'security': '#8B5CF6', 'product': '#6366F1', 'revenue': '#F59E0B', 'support': '#10B981'},
            'roleGroups': {'exec': [], 'platform': [], 'security': [], 'product': [], 'revenue': [], 'support': []},
        }
        old_dir = dashboard_server.DIR
        try:
            with tempfile.TemporaryDirectory() as temp_dir:
                dashboard_server.DIR = Path(temp_dir)
                config_path = Path(temp_dir) / 'config.js'
                config_path.write_text(f"window.SECOPSAI_CONFIG = {json.dumps(public_config)};\n", encoding='utf-8')
                good = FakeHandler()
                dashboard_server.DashboardHandler._serve_local_bootstrap_config(good)
                self.assertEqual(good.status, 200)
                self.assertIn(b'public-anon-key', good.wfile.getvalue())
                self.assertNotIn(b'DASHBOARD_LOCAL_AUTH_TOKEN', good.wfile.getvalue())

                private_config = dict(public_config)
                private_config['DASHBOARD_LOCAL_AUTH_TOKEN'] = 'server-secret'
                config_path.write_text(f"window.SECOPSAI_CONFIG = {json.dumps(private_config)};\n", encoding='utf-8')
                bad = FakeHandler()
                dashboard_server.DashboardHandler._serve_local_bootstrap_config(bad)
                self.assertEqual(bad.status, 503)
                self.assertNotIn(b'server-secret', bad.wfile.getvalue())
        finally:
            dashboard_server.DIR = old_dir

    def test_run_output_reader_rejects_oversized_files(self):
        old_limit = dashboard_server.LOCAL_RUN_OUTPUT_MAX_BYTES
        try:
            dashboard_server.LOCAL_RUN_OUTPUT_MAX_BYTES = 4
            with tempfile.TemporaryDirectory() as temp_dir:
                output = Path(temp_dir) / 'run.txt'
                output.write_bytes(b'12345')
                with self.assertRaises(dashboard_server.RunOutputTooLarge):
                    dashboard_server._read_bounded_run_output(output)
        finally:
            dashboard_server.LOCAL_RUN_OUTPUT_MAX_BYTES = old_limit

    def test_standalone_run_output_uses_existing_auth_and_same_origin_endpoint(self):
        viewer = (ROOT / 'view-run-output.html').read_text(encoding='utf-8')
        self.assertIn('getSession()', viewer)
        self.assertIn('sessionStorage.getItem(\'secopsai_dashboard_local_auth_token\')', viewer)
        self.assertIn("headers['X-SecOpsAI-Local-Token']", viewer)
        self.assertIn('headers.Authorization', viewer)
        self.assertIn('url.origin !== window.location.origin', viewer)
        self.assertNotIn('fetch(runOutputUrl(path))', viewer)

    def test_ontology_quality_unknown_percentages_remain_unknown(self):
        app = (ROOT / 'app.js').read_text(encoding='utf-8')
        self.assertIn("const qualityPercent = value => value == null ? '—' : `${value}%`;", app)
        self.assertNotIn('provenance_coverage_percent ?? 0', app)
        self.assertNotIn('findings_linked_percent ?? 0', app)

    def test_content_pack_generation_is_action_token_gated(self):
        source = (ROOT / "dashboard_server.py").read_text(encoding="utf-8")
        marker = "if parsed.path == '/api/secopsai/content-packs/generate':"
        start = source.index(marker)
        section = source[start:source.index("        if parsed.path == '/api/blog'", start)]
        self.assertIn("require_triage_ops_admin(self)", section)

    def test_authenticated_refresh_has_no_implicit_task_transition_write(self):
        source = (ROOT / "app.js").read_text(encoding="utf-8")
        self.assertNotIn("synchronizeSuccessfulTaskTransitions", source)
        refresh_start = source.index("async function backgroundRefreshLiveExecutionState()")
        refresh_end = source.index("async function refreshActiveSurface", refresh_start)
        refresh_section = source[refresh_start:refresh_end]
        self.assertNotIn("advanceTaskAfterSuccessfulRun", refresh_section)
        self.assertIn("advanceTaskAfterSuccessfulRun(data.related_work_item_id)", source)

    def test_dashboard_ci_runs_focused_security_contract_and_pins_tools(self):
        deploy = (ROOT.parent / ".github/workflows/deploy-pages.yml").read_text(encoding="utf-8")
        checks = (ROOT.parent / ".github/workflows/dashboard.yml").read_text(encoding="utf-8")
        self.assertIn("wrangler@4.131.1", deploy)
        self.assertNotIn("wrangler@latest", deploy)
        self.assertIn("Require Cloudflare deployment configuration", deploy)
        self.assertNotIn("configured=false", deploy)
        self.assertIn("Verify deployed Pages artifact and security headers", deploy)
        self.assertIn("pytest==9.0.2", checks)
        self.assertIn("tests/test_dashboard_security.py", checks)
        self.assertIn("npm run check", checks)
        self.assertIn("npm test", checks)

    def test_local_ontology_routes_dispatch_and_return_typed_json(self):
        import sys
        from unittest.mock import MagicMock
        class FakeServer:
            server_address = ("127.0.0.1", 45680)

        class FakeHandler(dashboard_server.DashboardHandler):
            server = FakeServer()
            def __init__(self, path="/", command="GET", headers=None):
                self.path = path
                self.command = command
                self.headers = headers or {}
                self.status = None
                self.response_headers = {}
                self.wfile = BytesIO()
            def send_response(self, status):
                self.status = status
            def send_header(self, name, value):
                self.response_headers[name] = value
            def end_headers(self):
                return None

        # Ensure ontology module is mocked so CI without Core repository passes cleanly
        mock_ontology = MagicMock()
        mock_ontology.search_entities.return_value = [{"entity_id": "pkg:pypi:example"}]
        mock_ontology.quality.return_value = {"entities": 1}
        mock_ontology.get_entity.side_effect = lambda eid, **kw: {"entity_id": eid} if eid != "missing:test:id" else None
        mock_ontology.neighbors.return_value = {"nodes": [], "relationships": []}
        mock_ontology.timeline.return_value = []
        mock_ontology.lineage.return_value = {"paths": []}
        mock_ontology.risk_context.return_value = {"risk_score": 50}

        orig_secopsai = sys.modules.get("secopsai")
        orig_ontology = sys.modules.get("secopsai.ontology")
        sys.modules["secopsai"] = MagicMock()
        sys.modules["secopsai.ontology"] = mock_ontology

        old_token = dashboard_server.DASHBOARD_LOCAL_AUTH_TOKEN
        try:
            dashboard_server.DASHBOARD_LOCAL_AUTH_TOKEN = "local-test-token"
            # Public healthz
            health = FakeHandler(path="/api/healthz")
            health.do_GET()
            self.assertEqual(health.status, 200)
            self.assertEqual(json.loads(health.wfile.getvalue().decode())["status"], "ok")

            # Authenticated search
            search = FakeHandler(path="/api/secopsai/ontology/search?limit=5", headers={"X-SecOpsAI-Local-Token": "local-test-token"})
            search.do_GET()
            self.assertEqual(search.status, 200)
            search_payload = json.loads(search.wfile.getvalue().decode())
            self.assertTrue(search_payload.get("ok"))
            self.assertEqual(search_payload.get("schema_version"), "secopsai.ontology.v1")
            self.assertIn("entities", search_payload)

            # Authenticated quality
            quality = FakeHandler(path="/api/secopsai/ontology/quality", headers={"X-SecOpsAI-Local-Token": "local-test-token"})
            quality.do_GET()
            self.assertEqual(quality.status, 200)
            quality_payload = json.loads(quality.wfile.getvalue().decode())
            self.assertTrue(quality_payload.get("ok"))
            self.assertIn("quality", quality_payload)

            # Missing entity returns clean 404 JSON
            missing = FakeHandler(path="/api/secopsai/ontology/entities/missing:test:id", headers={"X-SecOpsAI-Local-Token": "local-test-token"})
            missing.do_GET()
            self.assertEqual(missing.status, 404)
            missing_payload = json.loads(missing.wfile.getvalue().decode())
            self.assertEqual(missing_payload.get("code"), "ontology_entity_not_found")

            # Unsupported route returns clean 404 JSON
            unsupported = FakeHandler(path="/api/secopsai/ontology/unknown_subroute", headers={"X-SecOpsAI-Local-Token": "local-test-token"})
            unsupported.do_GET()
            self.assertEqual(unsupported.status, 404)
            unsupported_payload = json.loads(unsupported.wfile.getvalue().decode())
            self.assertEqual(unsupported_payload.get("code"), "ontology_route_not_found")
        finally:
            dashboard_server.DASHBOARD_LOCAL_AUTH_TOKEN = old_token
            if orig_secopsai is not None:
                sys.modules["secopsai"] = orig_secopsai
            else:
                sys.modules.pop("secopsai", None)
            if orig_ontology is not None:
                sys.modules["secopsai.ontology"] = orig_ontology
            else:
                sys.modules.pop("secopsai.ontology", None)

    def test_manual_sandbox_download_uses_nosniff_and_no_store_headers(self):
        source = (ROOT / "dashboard_server.py").read_text(encoding="utf-8")
        self.assertIn("def attachment_response", source)
        self.assertIn("no-store, no-cache, must-revalidate", source)
        self.assertIn("X-Content-Type-Options', 'nosniff", source)
        self.assertIn("Content-Security-Policy', \"sandbox; default-src 'none'\"", source)


if __name__ == "__main__":
    unittest.main()
