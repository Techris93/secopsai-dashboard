#!/usr/bin/env python3
import json
import os
import re
import subprocess
import urllib.parse
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from urllib.parse import urlparse

DIR = Path(__file__).resolve().parent
SECOPSAI_ROOT = Path(os.environ.get('SECOPSAI_ROOT', '/Users/chrixchange/secopsai')).expanduser().resolve()
SECOPSAI_SESSION_DIR = Path(
    os.environ.get('SECOPSAI_SESSION_DIR', str(SECOPSAI_ROOT / 'data' / 'sessions'))
).expanduser().resolve()
SECOPSAI_DB_PATH = os.environ.get('SECOPSAI_DB_PATH', '').strip()
OPENCLAW_WORKSPACE = Path('/Users/chrixchange/.openclaw/workspace').resolve()
FINDING_ID_RE = re.compile(r'^[A-Z]{3}-[A-Z0-9]+$')
ACTION_ID_RE = re.compile(r'^ACT-\d+$')
SESSION_ID_RE = re.compile(r'^SES-[0-9a-f]{12}$')
APPROVAL_ID_RE = re.compile(r'^APR-[0-9a-f]{12}$')
ALLOWED_CLOSE_DISPOSITIONS = {'expected_behavior', 'needs_review', 'tune_policy', 'false_positive'}


def env_truthy(name: str, default: bool = False) -> bool:
    raw = os.environ.get(name)
    if raw is None or str(raw).strip() == '':
        return default
    return str(raw).strip().lower() in {'1', 'true', 'yes', 'on'}


def env_number(name: str, default: float) -> float:
    try:
        return float(str(os.environ.get(name, '')).strip())
    except Exception:
        return float(default)


def build_ai_guard():
    return {
        'hostedEnabled': env_truthy('HOSTED_AI_ENABLED', False),
        'defaultModel': os.environ.get('HOSTED_AI_MODEL', 'gpt-5.4-mini').strip() or 'gpt-5.4-mini',
        'maxCostUsd': env_number('HOSTED_AI_MAX_COST_USD', 3.0),
        'allowMutations': env_truthy('HOSTED_AI_ALLOW_MUTATIONS', False),
    }


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


def session_storage_path():
    return SECOPSAI_SESSION_DIR


def compact_session_payload(payload):
    if not isinstance(payload, dict):
        return None
    plan = payload.get('plan', [])
    approvals = payload.get('approvals', [])
    artifacts = payload.get('artifacts', [])
    events = payload.get('events', [])
    if not isinstance(plan, list):
        plan = []
    if not isinstance(approvals, list):
        approvals = []
    if not isinstance(artifacts, list):
        artifacts = []
    if not isinstance(events, list):
        events = []
    pending_approvals = [item for item in approvals if str(item.get('state') or '').lower() == 'pending']
    completed_steps = sum(1 for item in plan if str((item or {}).get('status') or '').lower() == 'completed')
    return {
        'session_id': payload.get('session_id'),
        'kind': payload.get('kind'),
        'title': payload.get('title'),
        'status': payload.get('status'),
        'created_at': payload.get('created_at'),
        'updated_at': payload.get('updated_at'),
        'subject': payload.get('subject') or {},
        'metadata': payload.get('metadata') or {},
        'plan': plan,
        'plan_total': len(plan),
        'plan_completed': completed_steps,
        'approvals': approvals,
        'pending_approvals': len(pending_approvals),
        'artifacts': artifacts,
        'artifact_count': len(artifacts),
        'latest_event': events[-1] if events else None,
        'recent_events': events[-3:],
    }


def load_session_payload(session_id: str):
    if not SESSION_ID_RE.match(session_id):
        raise ValueError('Invalid session_id')
    target = session_storage_path() / f'{session_id}.json'
    payload = read_json_file(target, None)
    if not isinstance(payload, dict):
        raise FileNotFoundError(f'session not found: {session_id}')
    return payload


def list_session_payloads(status=None, finding_id=None, limit=20):
    root = session_storage_path()
    if not root.exists():
        return []
    rows = []
    for candidate in root.glob('SES-*.json'):
        payload = read_json_file(candidate, None)
        if not isinstance(payload, dict):
            continue
        if status and str(payload.get('status') or '').lower() != str(status).lower():
            continue
        subject = payload.get('subject') or {}
        if finding_id and str(subject.get('finding_id') or '') != str(finding_id):
            continue
        compact = compact_session_payload(payload)
        if compact:
            rows.append(compact)
    rows.sort(key=lambda item: str(item.get('updated_at') or ''), reverse=True)
    return rows[:limit]


def run_secopsai_triage_summary():
    python_bin = SECOPSAI_ROOT / '.venv' / 'bin' / 'python3'
    if not python_bin.exists():
        return None
    try:
        args = [str(python_bin), '-m', 'secopsai.cli', 'triage', 'summary', '--json']
        if SECOPSAI_DB_PATH:
            args.extend(['--db-path', SECOPSAI_DB_PATH])
        result = subprocess.run(
            args,
            cwd=str(SECOPSAI_ROOT),
            capture_output=True,
            text=True,
            timeout=45,
            check=True,
        )
        return json.loads(result.stdout)
    except Exception:
        return None


def run_secopsai_triage_list(status='open', limit=20):
    python_bin = SECOPSAI_ROOT / '.venv' / 'bin' / 'python3'
    if not python_bin.exists():
        return None
    try:
        args = [str(python_bin), '-m', 'secopsai.cli', 'triage', 'list', '--status', status, '--json', '--limit', str(limit)]
        if SECOPSAI_DB_PATH:
            args.extend(['--db-path', SECOPSAI_DB_PATH])
        result = subprocess.run(
            args,
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

    active_list_payload = run_secopsai_triage_list(status='open', limit=50)
    active_findings = active_list_payload.get('findings', []) if isinstance(active_list_payload, dict) else []
    if not isinstance(active_findings, list):
        active_findings = []

    raw_summary_findings = summary.get('findings', []) if isinstance(summary, dict) else []
    if not isinstance(raw_summary_findings, list):
        raw_summary_findings = []

    active_severity_counts = {}
    for item in active_findings:
        severity = str((item or {}).get('severity') or 'unknown').lower()
        active_severity_counts[severity] = active_severity_counts.get(severity, 0) + 1

    if isinstance(summary, dict):
        summary = {
            **summary,
            'findings': active_findings[:10],
            'severity_counts': active_severity_counts,
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

    sessions = list_session_payloads(limit=25)
    open_sessions = [item for item in sessions if str(item.get('status') or '').lower() == 'open']
    pending_session_approvals = sum(int(item.get('pending_approvals') or 0) for item in sessions)

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
        'sessions': {
            'path': str(session_storage_path()),
            'total_count': len(sessions),
            'open_count': len(open_sessions),
            'pending_approvals': pending_session_approvals,
            'recent': sessions,
            'latest_updated_at': sessions[0].get('updated_at') if sessions else None,
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


def sse_send(handler, event_name, payload):
    body = f"event: {event_name}\ndata: {json.dumps(payload)}\n\n".encode('utf-8')
    handler.wfile.write(body)
    handler.wfile.flush()


def read_request_json(handler):
    content_length = int(handler.headers.get('Content-Length', '0') or '0')
    if content_length <= 0:
        return {}
    raw = handler.rfile.read(content_length)
    if not raw:
        return {}
    try:
        return json.loads(raw.decode('utf-8'))
    except Exception:
        return {}


def secopsai_python_bin():
    python_bin = SECOPSAI_ROOT / '.venv' / 'bin' / 'python3'
    return python_bin if python_bin.exists() else None


def secopsai_db_args():
    return ['--db-path', SECOPSAI_DB_PATH] if SECOPSAI_DB_PATH else []


def secopsai_session_args():
    return ['--session-dir', str(session_storage_path())]


def run_secopsai_cli(args, timeout=120):
    python_bin = secopsai_python_bin()
    if not python_bin:
        raise RuntimeError('SecOpsAI venv python not found')
    result = subprocess.run(
        [str(python_bin), '-m', 'secopsai.cli', *args],
        cwd=str(SECOPSAI_ROOT),
        capture_output=True,
        text=True,
        timeout=timeout,
        check=False,
    )
    return {
        'ok': result.returncode == 0,
        'returncode': result.returncode,
        'stdout': result.stdout,
        'stderr': result.stderr,
    }


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
                    'secopsai_sessions_api': True,
                    'secopsai_research_api': True,
                    'secopsai_events_api': True,
                },
                'ai_guard': build_ai_guard(),
            }
            return json_response(self, 200, payload)

        if parsed.path == '/api/secopsai/triage-state':
            try:
                return json_response(self, 200, collect_secopsai_triage_state())
            except Exception as exc:
                return json_response(self, 500, {'ok': False, 'error': str(exc)})

        if parsed.path == '/api/secopsai/sessions':
            try:
                qs = urllib.parse.parse_qs(parsed.query or '')
                limit = int((qs.get('limit') or ['20'])[0] or '20')
                status = (qs.get('status') or [None])[0]
                finding_id = (qs.get('finding_id') or [None])[0]
                sessions = list_session_payloads(status=status, finding_id=finding_id, limit=max(1, min(limit, 100)))
                return json_response(
                    self,
                    200,
                    {
                        'ok': True,
                        'path': str(session_storage_path()),
                        'total': len(sessions),
                        'sessions': sessions,
                    },
                )
            except Exception as exc:
                return json_response(self, 500, {'ok': False, 'error': str(exc)})

        if parsed.path == '/api/secopsai/session':
            try:
                qs = urllib.parse.parse_qs(parsed.query or '')
                session_id = str((qs.get('session_id') or [''])[0] or '').strip()
                session = load_session_payload(session_id)
                return json_response(self, 200, {'ok': True, 'session': session})
            except FileNotFoundError as exc:
                return json_response(self, 404, {'ok': False, 'error': str(exc)})
            except Exception as exc:
                return json_response(self, 400, {'ok': False, 'error': str(exc)})

        if parsed.path == '/api/secopsai/events':
            qs = urllib.parse.parse_qs(parsed.query or '')

            def bounded_int(value, default, lower, upper):
                try:
                    parsed_value = int(value or default)
                except (TypeError, ValueError):
                    parsed_value = default
                return max(lower, min(parsed_value, upper))

            interval = bounded_int((qs.get('interval') or ['5'])[0], 5, 1, 30)
            ticks = bounded_int((qs.get('ticks') or ['60'])[0], 60, 1, 720)
            self.send_response(200)
            self.send_header('Content-Type', 'text/event-stream')
            self.send_header('Cache-Control', 'no-store')
            self.send_header('Connection', 'keep-alive')
            self.end_headers()
            last_signature = None
            try:
                for _ in range(ticks):
                    payload = collect_secopsai_triage_state()
                    signature = json.dumps(
                        {
                            'sessions': payload.get('sessions', {}).get('latest_updated_at'),
                            'pending_actions': payload.get('queue', {}).get('pending_count'),
                            'applied_actions': payload.get('queue', {}).get('applied_count'),
                            'latest_orchestrator': payload.get('orchestrator', {}).get('latest', {}).get('generated_at')
                            if payload.get('orchestrator', {}).get('latest') else None,
                        },
                        sort_keys=True,
                    )
                    event_name = 'triage-state' if signature != last_signature else 'heartbeat'
                    sse_send(self, event_name, payload if event_name == 'triage-state' else {'ok': True, 'ts': time.time()})
                    last_signature = signature
                    time.sleep(interval)
            except (BrokenPipeError, ConnectionResetError):
                return
            except Exception as exc:
                try:
                    sse_send(self, 'error', {'ok': False, 'error': str(exc)})
                except Exception:
                    return
            return

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
        parsed = urlparse(self.path)
        payload = read_request_json(self)

        if parsed.path == '/api/secopsai/investigate':
            finding_id = str(payload.get('finding_id') or '').strip()
            session_id = str(payload.get('session_id') or '').strip()
            if not FINDING_ID_RE.match(finding_id):
                return json_response(self, 400, {'ok': False, 'error': 'Invalid finding_id'})
            if session_id and not SESSION_ID_RE.match(session_id):
                return json_response(self, 400, {'ok': False, 'error': 'Invalid session_id'})
            try:
                cli_args = ['triage', 'investigate', finding_id, '--search-root', str(SECOPSAI_ROOT), '--json', *secopsai_db_args(), *secopsai_session_args()]
                if session_id:
                    cli_args.extend(['--session-id', session_id])
                else:
                    cli_args.append('--open-session')
                result = run_secopsai_cli(
                    cli_args,
                    timeout=180,
                )
                parsed_stdout = None
                try:
                    parsed_stdout = json.loads(result['stdout']) if result['stdout'].strip() else None
                except Exception:
                    parsed_stdout = None
                return json_response(
                    self,
                    200 if result['ok'] else 500,
                    {
                        'ok': result['ok'],
                        'finding_id': finding_id,
                        'result': parsed_stdout,
                        'stdout': result['stdout'],
                        'stderr': result['stderr'],
                        'returncode': result['returncode'],
                    },
                )
            except Exception as exc:
                return json_response(self, 500, {'ok': False, 'error': str(exc)})

        if parsed.path == '/api/secopsai/research-finding':
            finding_id = str(payload.get('finding_id') or '').strip()
            session_id = str(payload.get('session_id') or '').strip()
            search_root = str(payload.get('search_root') or str(SECOPSAI_ROOT)).strip() or str(SECOPSAI_ROOT)
            if not FINDING_ID_RE.match(finding_id):
                return json_response(self, 400, {'ok': False, 'error': 'Invalid finding_id'})
            if session_id and not SESSION_ID_RE.match(session_id):
                return json_response(self, 400, {'ok': False, 'error': 'Invalid session_id'})
            try:
                cli_args = [
                    'research',
                    'finding',
                    finding_id,
                    '--search-root',
                    search_root,
                    *secopsai_db_args(),
                    *secopsai_session_args(),
                ]
                if session_id:
                    cli_args.extend(['--session-id', session_id])
                result = run_secopsai_cli(cli_args, timeout=180)
                parsed_stdout = None
                try:
                    parsed_stdout = json.loads(result['stdout']) if result['stdout'].strip() else None
                except Exception:
                    parsed_stdout = None
                return json_response(
                    self,
                    200 if result['ok'] else 500,
                    {
                        'ok': result['ok'],
                        'finding_id': finding_id,
                        'result': parsed_stdout,
                        'stdout': result['stdout'],
                        'stderr': result['stderr'],
                        'returncode': result['returncode'],
                    },
                )
            except Exception as exc:
                return json_response(self, 500, {'ok': False, 'error': str(exc)})

        if parsed.path == '/api/secopsai/apply-action':
            action_id = str(payload.get('action_id') or '').strip()
            session_id = str(payload.get('session_id') or '').strip()
            if not ACTION_ID_RE.match(action_id):
                return json_response(self, 400, {'ok': False, 'error': 'Invalid action_id'})
            if session_id and not SESSION_ID_RE.match(session_id):
                return json_response(self, 400, {'ok': False, 'error': 'Invalid session_id'})
            try:
                cli_args = ['triage', 'apply-action', action_id, '--yes', *secopsai_db_args(), *secopsai_session_args()]
                if session_id:
                    cli_args.extend(['--session-id', session_id])
                result = run_secopsai_cli(cli_args, timeout=180)
                return json_response(
                    self,
                    200 if result['ok'] else 500,
                    {
                        'ok': result['ok'],
                        'action_id': action_id,
                        'stdout': result['stdout'],
                        'stderr': result['stderr'],
                        'returncode': result['returncode'],
                    },
                )
            except Exception as exc:
                return json_response(self, 500, {'ok': False, 'error': str(exc)})

        if parsed.path == '/api/secopsai/close-finding':
            finding_id = str(payload.get('finding_id') or '').strip()
            disposition = str(payload.get('disposition') or '').strip()
            note = ' '.join(str(payload.get('note') or '').split())
            status = str(payload.get('status') or 'closed').strip() or 'closed'
            session_id = str(payload.get('session_id') or '').strip()
            if not FINDING_ID_RE.match(finding_id):
                return json_response(self, 400, {'ok': False, 'error': 'Invalid finding_id'})
            if disposition not in ALLOWED_CLOSE_DISPOSITIONS:
                return json_response(self, 400, {'ok': False, 'error': 'Invalid or unsupported disposition'})
            if status not in {'closed', 'triaged'}:
                return json_response(self, 400, {'ok': False, 'error': 'Invalid status'})
            if len(note) < 12:
                return json_response(self, 400, {'ok': False, 'error': 'Analyst note is required'})
            if session_id and not SESSION_ID_RE.match(session_id):
                return json_response(self, 400, {'ok': False, 'error': 'Invalid session_id'})
            try:
                cli_args = [
                    'triage', 'close', finding_id,
                    '--disposition', disposition,
                    '--note', note,
                    '--status', status,
                    *secopsai_db_args(),
                    *secopsai_session_args(),
                ]
                if session_id:
                    cli_args.extend(['--session-id', session_id])
                result = run_secopsai_cli(
                    cli_args,
                    timeout=180,
                )
                return json_response(
                    self,
                    200 if result['ok'] else 500,
                    {
                        'ok': result['ok'],
                        'finding_id': finding_id,
                        'disposition': disposition,
                        'status': status,
                        'note': note,
                        'stdout': result['stdout'],
                        'stderr': result['stderr'],
                        'returncode': result['returncode'],
                    },
                )
            except Exception as exc:
                return json_response(self, 500, {'ok': False, 'error': str(exc)})

        if parsed.path == '/api/secopsai/resolve-approval':
            session_id = str(payload.get('session_id') or '').strip()
            approval_id = str(payload.get('approval_id') or '').strip()
            decision = str(payload.get('decision') or '').strip().lower()
            decided_by = str(payload.get('decided_by') or '').strip()
            note = ' '.join(str(payload.get('note') or '').split())
            apply_change = bool(payload.get('apply'))
            if not SESSION_ID_RE.match(session_id):
                return json_response(self, 400, {'ok': False, 'error': 'Invalid session_id'})
            if not APPROVAL_ID_RE.match(approval_id):
                return json_response(self, 400, {'ok': False, 'error': 'Invalid approval_id'})
            if decision not in {'approved', 'rejected'}:
                return json_response(self, 400, {'ok': False, 'error': 'Decision must be approved or rejected'})
            try:
                cli_args = [
                    'session', 'resolve-approval', session_id, approval_id,
                    '--approve' if decision == 'approved' else '--reject',
                    '--json',
                    *secopsai_db_args(),
                    *secopsai_session_args(),
                ]
                if note:
                    cli_args.extend(['--note', note])
                if decided_by:
                    cli_args.extend(['--decided-by', decided_by])
                if apply_change and decision == 'approved':
                    cli_args.append('--apply')
                result = run_secopsai_cli(cli_args, timeout=180)
                parsed_stdout = None
                try:
                    parsed_stdout = json.loads(result['stdout']) if result['stdout'].strip() else None
                except Exception:
                    parsed_stdout = None
                return json_response(
                    self,
                    200 if result['ok'] else 500,
                    {
                        'ok': result['ok'],
                        'session_id': session_id,
                        'approval_id': approval_id,
                        'decision': decision,
                        'result': parsed_stdout,
                        'stdout': result['stdout'],
                        'stderr': result['stderr'],
                        'returncode': result['returncode'],
                    },
                )
            except Exception as exc:
                return json_response(self, 500, {'ok': False, 'error': str(exc)})

        return json_response(self, 404, {'ok': False, 'error': 'Not found'})





if __name__ == '__main__':
    host = os.environ.get('HOST', '127.0.0.1')
    port = int(os.environ.get('PORT', '45680'))
    print(f'Serving SecOpsAI dashboard from: {DIR}')
    print(f'URL: http://{host}:{port}')
    ThreadingHTTPServer((host, port), DashboardHandler).serve_forever()
