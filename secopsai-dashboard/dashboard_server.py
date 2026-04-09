#!/usr/bin/env python3
import json
import os
import subprocess
import urllib.parse
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from urllib.parse import urlparse

DIR = Path(__file__).resolve().parent
SECOPSAI_ROOT = Path(os.environ.get('SECOPSAI_ROOT', '/Users/chrixchange/secopsai')).expanduser().resolve()
OPENCLAW_WORKSPACE = Path('/Users/chrixchange/.openclaw/workspace').resolve()


def read_json_file(path: Path, default=None):
    if not path.exists() or not path.is_file():
        return default
    try:
        return json.loads(path.read_text(encoding='utf-8'))
    except Exception:
        return default


def latest_json_files(directory: Path, pattern: str, limit: int = 5):
    if not directory.exists():
        return []
    return sorted(directory.glob(pattern), key=lambda item: item.stat().st_mtime, reverse=True)[:limit]


def run_secopsai_triage_summary():
    python_bin = SECOPSAI_ROOT / '.venv' / 'bin' / 'python3'
    if not python_bin.exists():
        return None
    try:
        result = subprocess.run(
            [str(python_bin), '-m', 'secopsai.cli', 'triage', 'summary', '--json'],
            cwd=str(SECOPSAI_ROOT),
            capture_output=True,
            text=True,
            timeout=45,
            check=True,
        )
        return json.loads(result.stdout)
    except Exception:
        return None


def collect_secopsai_triage_state():
    summary = run_secopsai_triage_summary()
    if not isinstance(summary, dict):
        latest_summary_files = latest_json_files(SECOPSAI_ROOT / 'reports' / 'triage' / 'orchestrator', '*.json', limit=1)
        summary = read_json_file(latest_summary_files[0], {}) if latest_summary_files else {}
    raw_summary_findings = summary.get('findings', []) if isinstance(summary, dict) else []
    if not isinstance(raw_summary_findings, list):
        raw_summary_findings = []
    active_summary_findings = [
        item for item in raw_summary_findings
        if str((item or {}).get('status') or '').lower() in {'open', 'in_review'}
    ][:10]
    if isinstance(summary, dict):
        summary = {
            **summary,
            'findings': active_summary_findings,
            'historical_findings_count': len(raw_summary_findings),
        }

    queue_file = SECOPSAI_ROOT / 'data' / 'triage' / 'action_queue.json'
    queue_actions = read_json_file(queue_file, [])
    if not isinstance(queue_actions, list):
        queue_actions = []
    pending = [item for item in queue_actions if str(item.get('status') or '').lower() == 'pending']
    applied = [item for item in queue_actions if str(item.get('status') or '').lower() == 'applied']

    recent_orchestrator = []
    for path in latest_json_files(SECOPSAI_ROOT / 'reports' / 'triage' / 'orchestrator', '*.json', limit=5):
        payload = read_json_file(path, {})
        if not isinstance(payload, dict):
            continue
        recent_orchestrator.append(
            {
                'path': str(path),
                'name': path.name,
                'generated_at': payload.get('generated_at'),
                'processed': payload.get('processed', payload.get('open_findings')),
                'auto_applied': payload.get('auto_applied'),
                'queued': payload.get('queued', payload.get('pending_actions')),
                'open_findings': payload.get('open_findings'),
                'pending_actions': payload.get('pending_actions'),
                'applied_actions': payload.get('applied_actions'),
                'findings': [
                    item for item in (payload.get('findings', []) if isinstance(payload.get('findings', []), list) else [])
                    if str((item or {}).get('status') or '').lower() in {'open', 'in_review'}
                ][:10],
            }
        )

    findings_artifact = None
    latest_artifacts = latest_json_files(SECOPSAI_ROOT / 'data' / 'openclaw' / 'findings', 'openclaw-findings-*.json', limit=1)
    if latest_artifacts:
        artifact_path = latest_artifacts[0]
        artifact = read_json_file(artifact_path, {})
        if isinstance(artifact, dict):
            findings_artifact = {
                'path': str(artifact_path),
                'name': artifact_path.name,
                'generated_at': artifact.get('generated_at'),
                'total_findings': artifact.get('total_findings'),
                'total_detections': artifact.get('total_detections'),
                'candidate_findings': artifact.get('candidate_findings'),
            }

    return {
        'ok': True,
        'secopsai_root': str(SECOPSAI_ROOT),
        'summary': summary or {},
        'queue': {
            'path': str(queue_file),
            'pending_count': len(pending),
            'applied_count': len(applied),
            'pending': pending[:20],
            'applied_recent': applied[-10:],
        },
        'orchestrator': {
            'latest': recent_orchestrator[0] if recent_orchestrator else None,
            'recent': recent_orchestrator,
        },
        'findings_artifact': findings_artifact,
    }


def json_response(handler, code, payload):
    body = json.dumps(payload).encode('utf-8')
    handler.send_response(code)
    handler.send_header('Content-Type', 'application/json')
    handler.send_header('Content-Length', str(len(body)))
    handler.send_header('Cache-Control', 'no-store')
    handler.end_headers()
    handler.wfile.write(body)


class DashboardHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, directory=None, **kwargs):
        super().__init__(*args, directory=str(DIR), **kwargs)

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == '/api/integration-status':
            payload = {
                'ok': True,
                'helper': {
                    'mode': 'local-control-panel',
                    'run_output_api': True,
                    'secopsai_triage_api': True,
                },
            }
            return json_response(self, 200, payload)

        if parsed.path == '/api/secopsai/triage-state':
            try:
                return json_response(self, 200, collect_secopsai_triage_state())
            except Exception as exc:
                return json_response(self, 500, {'ok': False, 'error': str(exc)})

        if parsed.path == '/api/run-output':
            # Serve run output text from within the OpenClaw workspace only.
            qs = urllib.parse.parse_qs(parsed.query or '')
            rel = (qs.get('path') or [None])[0]
            if not rel:
                return json_response(self, 400, {'ok': False, 'error': 'Missing path'})

            try:
                target = (OPENCLAW_WORKSPACE / rel).resolve()
                if OPENCLAW_WORKSPACE not in target.parents and target != OPENCLAW_WORKSPACE:
                    return json_response(self, 403, {'ok': False, 'error': 'Path outside workspace'})
                if not target.exists() or not target.is_file():
                    return json_response(self, 404, {'ok': False, 'error': 'File not found'})
                text = target.read_text(encoding='utf-8', errors='ignore')
                return json_response(self, 200, {'ok': True, 'text': text})
            except Exception as exc:
                return json_response(self, 500, {'ok': False, 'error': str(exc)})

        return super().do_GET()

    def do_POST(self):
        return json_response(self, 404, {'ok': False, 'error': 'Not found'})





if __name__ == '__main__':
    host = os.environ.get('HOST', '127.0.0.1')
    port = int(os.environ.get('PORT', '45680'))
    print(f'Serving SecOpsAI dashboard from: {DIR}')
    print(f'URL: http://{host}:{port}')
    ThreadingHTTPServer((host, port), DashboardHandler).serve_forever()
