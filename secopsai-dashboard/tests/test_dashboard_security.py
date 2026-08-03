import re
import unittest
from pathlib import Path

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

    def test_manual_sandbox_download_uses_nosniff_and_no_store_headers(self):
        source = (ROOT / "dashboard_server.py").read_text(encoding="utf-8")
        self.assertIn("def attachment_response", source)
        self.assertIn("no-store, no-cache, must-revalidate", source)
        self.assertIn("X-Content-Type-Options', 'nosniff", source)
        self.assertIn("Content-Security-Policy', \"sandbox; default-src 'none'\"", source)


if __name__ == "__main__":
    unittest.main()
