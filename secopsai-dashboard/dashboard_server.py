#!/usr/bin/env python3
import hmac
import json
import os
import re
import shutil
import subprocess
import tempfile
import urllib.parse
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
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
RESEARCH_CASE_ID_RE = re.compile(r'^RSC-[A-F0-9]{12}$')
BLOG_DRAFT_ID_RE = re.compile(r'^[A-Za-z0-9_.-]{1,260}$')
ALLOWED_CLOSE_DISPOSITIONS = {'expected_behavior', 'needs_review', 'tune_policy', 'false_positive', 'not_applicable'}
ALLOWED_TRIAGE_OPS_WRITE_ACTIONS = {
    'close',
    'escalate',
    'create-blog-draft',
    'campaign-persist-findings',
    'campaign-blog-draft',
    'campaign-watchlist',
}
BLOG_OPS_WRITE_ACTIONS = {
    'news-run',
    'news-fetch',
    'news-draft',
    'publish-approved',
    'rebuild-feeds',
    'deploy',
    'attach-source-media',
    'approve',
    'reject',
    'needs-review',
    'save',
}
RESEARCH_CASE_ACTIONS = {
    'create',
    'update',
    'add-subject',
    'add-evidence',
    'add-ioc',
    'add-rule',
    'link-finding',
    'note',
    'retract',
    'export',
    'draft-blog',
    'intake-preview',
    'intake-run',
    'intake-attach',
    'jobs',
    'job-retry',
    'job-cancel',
    'evidence-matrix',
    'analyst-brief',
    'verdict',
    'publication-check',
    'publication-approve',
    'prepare-disclosure',
    'disclosure-status',
    'sandbox-request',
    'sandbox-status',
    'sandbox-approve',
}
RESEARCH_DISCOVERY_ACTIONS = {
    'capabilities',
    'watchlist-list',
    'watchlist-add',
    'monitor-list',
    'monitor-create',
    'monitor-run-due',
    'candidate-list',
    'candidate-show',
    'campaign-correlate',
    'campaign-list',
    'compare-packages',
    'alert-list',
    'alert-deliver',
    'collect-status',
    'collect-run',
    'collect-retry-failures',
    'collect-coverage',
    'collect-events',
    'collect-pause',
    'collect-resume',
    'score-run',
}
CAMPAIGN_TRIAGE_OPS_ACTIONS = {
    'campaign-discover',
    'campaign-autopilot',
    'campaign-promote',
    'campaign-orchestrate',
    'campaign-watchlist',
    'research-recommendation',
    'research-campaign',
    'campaign-persist-findings',
    'campaign-blog-draft',
}
ALLOWED_CAMPAIGN_ECOSYSTEMS = {
    'npm',
    'pypi',
    'crates',
    'chrome-web-store',
    'packagist',
    'go',
    'huggingface',
    'maven',
    'nuget',
    'open-vsx',
    'rubygems',
}
ECOSYSTEM_RE = re.compile(r'^(npm|pypi|crates|chrome-web-store|packagist|go|huggingface|maven|nuget|open-vsx|rubygems)$', re.IGNORECASE)
COLLECTOR_ID_RE = re.compile(r'^COL-[A-Z0-9-]{3,40}$')
CAMPAIGN_ID_RE = re.compile(r'^[A-Za-z0-9_.-]{1,140}$')
PACKAGE_RE = re.compile(r'^[A-Za-z0-9@._:/-]{1,260}$')
NPM_WATCHLIST_PACKAGE_RE = re.compile(r'^(?:npm:)?(?:@[a-z0-9._~-]+/)?[a-z0-9._~-]+$', re.IGNORECASE)
VERSION_RE = re.compile(r'^[A-Za-z0-9.+:_~!*-]{1,160}$')
SAFE_SOURCE_URL_RE = re.compile(r'^https?://[^\s<>"\']{3,500}$', re.IGNORECASE)
PAGES_PROJECT_RE = re.compile(r'^[A-Za-z0-9][A-Za-z0-9_-]{0,62}$')
BRANCH_RE = re.compile(r'^[A-Za-z0-9._/-]{1,120}$')
SECRETISH_RE = re.compile(r'(?i)\b([a-z0-9_ -]*(?:token|secret|api[_ -]?key|password|authorization)[a-z0-9_ -]*)\s*[:=]\s*([^\s,"\']{8,})')
INTELLIGENCE_JOB_ID_RE = re.compile(r'^AIJ-[A-F0-9]{16}$')
INTELLIGENCE_TARGET_RE = re.compile(r'^[A-Za-z0-9:._-]{0,240}$')
INTELLIGENCE_BRIDGE_ACTIONS = {
    'explain_finding',
    'prioritize_findings',
    'analyze_asset_change',
    'analyze_research_case',
    'generate_analyst_brief',
    'review_publication_safety',
    'recommend_remediation',
}
INTELLIGENCE_SERVICE_ACTIONS = {'install', 'start', 'stop', 'status', 'logs', 'uninstall'}
CAMPAIGN_FIXTURE_PATHS = [
    SECOPSAI_ROOT / 'tests' / 'fixtures' / 'deadcode09284814-campaign.json',
]
KNOWN_COMPROMISED_VERSIONS = {
    ('pypi', 'litellm'): {'1.82.7', '1.82.8'},
    ('pypi', 'mistralai'): {'2.4.6'},
}
MIN_SAFE_VERSION_HINTS = {
    ('pypi', 'litellm'): '1.83.7',
}
KNOWN_IOC_HINTS = {
    ('pypi', 'litellm'): [
        'litellm_init.pth',
        'models.litellm.cloud',
        'checkmarx.zone',
        'tpcp.tar.gz',
        '/tmp/pglog',
        '/tmp/.pg_state',
        'sysmon.py',
    ],
    ('pypi', 'mistralai'): [
        'git-tanstack.com',
        'googleapis.cloud',
        '83.142.209.194',
        '/tmp/transformers.pyz',
        'transformers.pyz',
        'router_init.js',
        'setup.mjs',
        'python3 /tmp/transformers.pyz',
    ],
}
DEPENDENCY_FILE_NAMES = {
    'package.json',
    'package-lock.json',
    'pnpm-lock.yaml',
    'yarn.lock',
    'pyproject.toml',
    'Pipfile',
    'poetry.lock',
    'uv.lock',
}
IGNORED_DEP_PATHS = {
    '.git',
    '.venv',
    'venv',
    'env',
    'node_modules',
    'site-packages',
    'dist',
    'build',
    '__pycache__',
}
_DEPENDENCY_MANIFEST_CACHE = None
_DEPENDENCY_TEXT_CACHE = {}


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


DEFAULT_LATEST_FIRST_FIELDS = (
    'last_seen',
    'last_seen_at',
    'updated_at',
    'detected_at',
    'observed_at',
    'created_at',
    'first_seen',
    'first_seen_at',
    'published_at',
    'fetched_at',
    'generated_at',
    'completed_at',
    'started_at',
    'queued_at',
)
TRIAGE_FINDING_DATE_FIELDS = (
    'last_seen',
    'last_seen_at',
    'updated_at',
    'detected_at',
    'observed_at',
    'created_at',
    'first_seen',
    'first_seen_at',
)
BLOG_DRAFT_DATE_FIELDS = (
    'source_metadata.published_at',
    'published_at',
    'updated_at',
    'created_at',
    'source_metadata.fetched_at',
    'fetched_at',
)
BLOG_RUN_DATE_FIELDS = ('updated_at', 'created_at', 'completed_at', 'started_at', 'run_started_at')


def _nested_value(item, dotted_path):
    current = item
    for key in str(dotted_path).split('.'):
        if not isinstance(current, dict):
            return None
        current = current.get(key)
    return current


def sort_timestamp(value):
    if value is None or isinstance(value, bool):
        return 0.0
    if isinstance(value, (int, float)):
        raw = float(value)
        return raw / 1000.0 if raw > 10_000_000_000 else raw
    text = str(value).strip()
    if not text:
        return 0.0
    if re.fullmatch(r'\d+(\.\d+)?', text):
        raw = float(text)
        return raw / 1000.0 if raw > 10_000_000_000 else raw
    normalized = text.replace('Z', '+00:00')
    try:
        parsed = datetime.fromisoformat(normalized)
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed.timestamp()
    except Exception:
        pass
    for fmt in ('%Y-%m-%d %H:%M:%S', '%Y-%m-%d', '%d/%m/%Y, %H:%M:%S', '%d/%m/%Y %H:%M:%S'):
        try:
            parsed = datetime.strptime(text, fmt).replace(tzinfo=timezone.utc)
            return parsed.timestamp()
        except Exception:
            continue
    return 0.0


def latest_sort_timestamp(item, fields=DEFAULT_LATEST_FIRST_FIELDS):
    if not isinstance(item, dict):
        return 0.0
    for field in fields:
        timestamp = sort_timestamp(_nested_value(item, field))
        if timestamp:
            return timestamp
    return 0.0


def sort_latest_first(items, fields=DEFAULT_LATEST_FIRST_FIELDS):
    if not isinstance(items, list):
        return []
    indexed = [(index, item) for index, item in enumerate(items)]
    return [
        item
        for index, item in sorted(
            indexed,
            key=lambda pair: (-latest_sort_timestamp(pair[1], fields), pair[0]),
        )
    ]


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
    active_findings = sort_latest_first(active_findings, TRIAGE_FINDING_DATE_FIELDS)

    raw_summary_findings = summary.get('findings', []) if isinstance(summary, dict) else []
    if not isinstance(raw_summary_findings, list):
        raw_summary_findings = []
    raw_summary_findings = sort_latest_first(raw_summary_findings, TRIAGE_FINDING_DATE_FIELDS)

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
    pending = sort_latest_first(pending)
    applied = sort_latest_first(applied)

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
                'findings': sort_latest_first([
                    item for item in (payload.get('findings', []) if isinstance(payload.get('findings', []), list) else [])
                    if str((item or {}).get('status') or '').lower() in {'open', 'in_review'}
                ], TRIAGE_FINDING_DATE_FIELDS)[:10],
            }
        )
    recent_orchestrator = sort_latest_first(recent_orchestrator, ('generated_at',))

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
            'applied_recent': applied[:10],
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
    try:
        handler.send_response(code)
        handler.send_header('Content-Type', 'application/json')
        handler.send_header('Content-Length', str(len(body)))
        handler.send_header('Cache-Control', 'no-store')
        handler.end_headers()
        handler.wfile.write(body)
    except (BrokenPipeError, ConnectionResetError):
        return


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


def parse_cli_json(result):
    try:
        return json.loads(result.get('stdout') or '{}')
    except Exception:
        return None


def triage_ops_expected_token():
    return (
        os.environ.get('TRIAGE_OPS_ADMIN_TOKEN', '').strip()
        or os.environ.get('BLOG_OPS_ADMIN_TOKEN', '').strip()
    )


def intelligence_expected_token():
    return os.environ.get('INTELLIGENCE_ADMIN_TOKEN', '').strip() or triage_ops_expected_token()


def blog_ops_expected_token():
    return os.environ.get('BLOG_OPS_ADMIN_TOKEN', '').strip()


def require_blog_ops_admin(handler):
    expected = blog_ops_expected_token()
    if not expected:
        json_response(
            handler,
            501,
            {
                'ok': False,
                'error': 'Blog Ops admin token is not configured. Set BLOG_OPS_ADMIN_TOKEN.',
                'code': 'not_configured',
            },
        )
        return True
    supplied = handler.headers.get('X-Blog-Ops-Admin-Token', '').strip()
    auth = handler.headers.get('Authorization', '').strip()
    if auth.lower().startswith('bearer '):
        supplied = supplied or auth[7:].strip()
    if not hmac.compare_digest(supplied, expected):
        json_response(handler, 401, {'ok': False, 'error': 'Unauthorized Blog Ops action'})
        return True
    return False


def require_triage_ops_admin(handler):
    expected = triage_ops_expected_token()
    if not expected:
        json_response(
            handler,
            501,
            {
                'ok': False,
                'error': 'Triage Ops admin token is not configured. Set TRIAGE_OPS_ADMIN_TOKEN or BLOG_OPS_ADMIN_TOKEN.',
                'code': 'not_configured',
            },
        )
        return True
    supplied = (
        handler.headers.get('X-Triage-Ops-Admin-Token', '').strip()
        or handler.headers.get('X-Blog-Ops-Admin-Token', '').strip()
    )
    auth = handler.headers.get('Authorization', '').strip()
    if auth.lower().startswith('bearer '):
        supplied = supplied or auth[7:].strip()
    if supplied != expected:
        json_response(handler, 401, {'ok': False, 'error': 'Unauthorized Triage Ops action'})
        return True
    return False


def require_intelligence_admin(handler):
    expected = intelligence_expected_token()
    if not expected:
        json_response(
            handler,
            501,
            {
                'ok': False,
                'error': 'Intelligence actions are not configured. Set INTELLIGENCE_ADMIN_TOKEN or TRIAGE_OPS_ADMIN_TOKEN.',
                'code': 'not_configured',
            },
        )
        return True
    supplied = handler.headers.get('X-SecOpsAI-Intelligence-Token', '').strip()
    if supplied != expected:
        json_response(handler, 401, {'ok': False, 'error': 'Unauthorized intelligence action'})
        return True
    return False


def build_intelligence_args(action, payload):
    action = str(action or '').strip().lower()
    if action == 'enqueue':
        intelligence_action = str(payload.get('intelligence_action') or '').strip()
        if intelligence_action not in INTELLIGENCE_BRIDGE_ACTIONS:
            raise ValueError('Unsupported intelligence action')
        target_id = str(payload.get('target_id') or '').strip()
        if not INTELLIGENCE_TARGET_RE.fullmatch(target_id):
            raise ValueError('Invalid intelligence target')
        args = ['intelligence', 'enqueue', '--action', intelligence_action, '--requested-by', 'mission-control']
        if target_id:
            args.extend(['--target-id', target_id])
        return [*args, *secopsai_db_args()]
    if action == 'cancel':
        job_id = str(payload.get('job_id') or '').strip()
        if not INTELLIGENCE_JOB_ID_RE.fullmatch(job_id):
            raise ValueError('Invalid intelligence job ID')
        return ['intelligence', 'jobs', 'cancel', job_id, '--actor', 'mission-control', *secopsai_db_args()]
    if action == 'run-once':
        return ['intelligence', 'bridge', 'run', '--once', *secopsai_db_args()]
    if action == 'service':
        service_action = str(payload.get('service_action') or '').strip().lower()
        if service_action not in INTELLIGENCE_SERVICE_ACTIONS:
            raise ValueError('Unsupported bridge service action')
        args = ['intelligence', 'bridge', 'service', service_action]
        if service_action == 'install':
            args.extend(['--db-path', SECOPSAI_DB_PATH] if SECOPSAI_DB_PATH else [])
        return args
    raise ValueError('Unsupported intelligence operation')


def collect_intelligence_status():
    mcp_url = os.environ.get('SECOPSAI_MCP_URL', '').strip()
    result, parsed = run_cli_json(
        ['intelligence', 'status', '--limit', '50', *secopsai_db_args()],
        timeout=45,
    )
    if not result.get('ok') or not isinstance(parsed, dict):
        compact = compact_cli_result(result)
        raise RuntimeError(compact.get('stderr') or compact.get('stdout') or 'Intelligence status is unavailable')
    return {
        'ok': True,
        'mode': 'local-helper',
        **parsed,
        'chatgpt_app': {'mode': 'hosted-mcp', 'configured': bool(mcp_url), 'url': mcp_url},
    }


def validate_triage_ops_target(payload):
    finding_id = str(payload.get('finding_id') or '').strip()
    ecosystem = str(payload.get('ecosystem') or '').strip().lower()
    package = str(payload.get('package') or '').strip()
    version = str(payload.get('version') or payload.get('new_version') or '').strip()
    if finding_id and not FINDING_ID_RE.match(finding_id):
        raise ValueError('Invalid finding_id')
    if ecosystem and not ECOSYSTEM_RE.match(ecosystem):
        raise ValueError('Invalid ecosystem')
    if package and not PACKAGE_RE.match(package):
        raise ValueError('Invalid package')
    if version and not VERSION_RE.match(version):
        raise ValueError('Invalid version')
    return finding_id, ecosystem, package, version


def build_research_case_args(action, payload):
    if action not in RESEARCH_CASE_ACTIONS:
        raise ValueError('Unsupported research case action')

    def add(args, flag, key, limit=4096):
        value = _clean_string(payload.get(key), limit)
        if value:
            args.extend([flag, value])

    if action == 'create':
        title = _clean_string(payload.get('title'), 240)
        if not title:
            raise ValueError('Research case title is required')
        args = ['research', 'case', 'create', '--title', title]
        for flag, key, limit in [
            ('--summary', 'summary', 8000),
            ('--type', 'case_type', 80),
            ('--severity', 'severity', 20),
            ('--confidence', 'confidence', 20),
            ('--owner', 'owner', 160),
        ]:
            add(args, flag, key, limit)
        return args

    if action == 'intake-preview':
        ecosystem = _clean_string(payload.get('ecosystem'), 40).lower()
        package = _clean_string(payload.get('package'), 512)
        if not ecosystem or not package:
            raise ValueError('ecosystem and package are required')
        if not PACKAGE_RE.match(package):
            raise ValueError('Invalid package')
        args = ['research', 'intake', 'preview', '--ecosystem', ecosystem, '--package', package]
        add(args, '--version', 'version', 160)
        return args

    if action == 'intake-attach':
        job_id = _clean_string(payload.get('job_id'), 40).upper()
        if not job_id:
            raise ValueError('job_id is required')
        args = ['research', 'intake', 'attach', job_id]
        add(args, '--actor', 'actor', 160)
        return args

    if action == 'disclosure-status':
        disclosure_id = _clean_string(payload.get('disclosure_id'), 40).upper()
        if not disclosure_id:
            raise ValueError('disclosure_id is required')
        args = ['research', 'workflow', 'disclosure-status', disclosure_id]
        add(args, '--status', 'status', 40)
        add(args, '--actor', 'actor', 160)
        if '--status' not in args:
            raise ValueError('status is required')
        return args

    if action == 'sandbox-status':
        request_id = _clean_string(payload.get('request_id'), 40).upper()
        if not request_id:
            raise ValueError('request_id is required')
        args = ['research', 'workflow', 'sandbox-status', request_id]
        add(args, '--status', 'status', 40)
        add(args, '--actor', 'actor', 160)
        if payload.get('result') is not None:
            args.extend(['--result-json', json.dumps(payload.get('result'), sort_keys=True)])
        if '--status' not in args:
            raise ValueError('status is required')
        return args

    if action == 'sandbox-approve':
        request_id = _clean_string(payload.get('request_id'), 40).upper()
        if not request_id:
            raise ValueError('request_id is required')
        args = ['research', 'workflow', 'approve-sandbox', request_id]
        if not payload.get('public_submission_acknowledged'):
            raise ValueError('public sandbox submission acknowledgment is required')
        args.append('--public-submission-acknowledged')
        add(args, '--actor', 'actor', 160)
        return args

    if action == 'jobs':
        args = ['research', 'jobs', 'list']
        add(args, '--case', 'case_id', 32)
        add(args, '--status', 'status', 40)
        limit = payload.get('limit')
        if limit is not None:
            try:
                args.extend(['--limit', str(max(1, min(int(limit), 500)))])
            except (TypeError, ValueError) as exc:
                raise ValueError('limit must be an integer') from exc
        return args

    if action in {'job-retry', 'job-cancel'}:
        job_id = _clean_string(payload.get('job_id'), 40).upper()
        if not job_id:
            raise ValueError('job_id is required')
        command = 'retry' if action == 'job-retry' else 'cancel'
        args = ['research', 'jobs', command, job_id]
        add(args, '--actor', 'actor', 160)
        return args

    case_id = _clean_string(payload.get('case_id'), 32).upper()
    if not RESEARCH_CASE_ID_RE.match(case_id):
        raise ValueError('Invalid research case id')
    workflow_commands = {
        'intake-run', 'evidence-matrix', 'analyst-brief', 'verdict', 'publication-check', 'publication-approve',
        'prepare-disclosure', 'disclosure-status', 'sandbox-request', 'sandbox-status',
    }
    if action in workflow_commands:
        args = ['research', 'workflow']
        if action == 'intake-run':
            args = ['research', 'intake', 'run', '--case', case_id]
            ecosystem = _clean_string(payload.get('ecosystem'), 40).lower()
            package = _clean_string(payload.get('package'), 512)
            if not ecosystem or not package:
                raise ValueError('ecosystem and package are required')
            if not ECOSYSTEM_RE.match(ecosystem) or not PACKAGE_RE.match(package):
                raise ValueError('Invalid package target')
            args.extend(['--ecosystem', ecosystem, '--package', package])
            add(args, '--version', 'version', 160)
            add(args, '--actor', 'actor', 160)
            if payload.get('attach'):
                args.append('--attach')
            if '--ecosystem' not in args or '--package' not in args:
                raise ValueError('ecosystem and package are required')
            return args
        command_map = {
            'evidence-matrix': 'evidence-matrix',
            'analyst-brief': 'analyst-brief',
            'verdict': 'verdict',
            'publication-check': 'publication-check',
            'publication-approve': 'publication-approve',
            'prepare-disclosure': 'prepare-disclosure',
            'disclosure-status': 'disclosure-status',
            'sandbox-request': 'request-sandbox',
            'sandbox-status': 'sandbox-status',
        }
        args.append(command_map[action])
        args.append(case_id)
    else:
        args = ['research', 'case', action, case_id]
    fields = {
        'update': [
            ('--title', 'title', 240),
            ('--summary', 'summary', 8000),
            ('--type', 'case_type', 80),
            ('--severity', 'severity', 20),
            ('--confidence', 'confidence', 20),
            ('--status', 'status', 40),
            ('--owner', 'owner', 160),
            ('--disclosure-status', 'disclosure_status', 40),
            ('--embargo-until', 'embargo_until', 64),
            ('--actor', 'actor', 160),
        ],
        'add-subject': [
            ('--subject-type', 'subject_type', 80),
            ('--name', 'name', 512),
            ('--ecosystem', 'ecosystem', 80),
            ('--version', 'version', 160),
            ('--publisher', 'publisher', 240),
            ('--actor', 'actor', 160),
        ],
        'add-evidence': [
            ('--evidence-type', 'evidence_type', 80),
            ('--title', 'title', 500),
            ('--locator', 'locator', 4000),
            ('--sha256', 'sha256', 64),
            ('--provenance', 'provenance', 1000),
            ('--notes', 'notes', 12000),
            ('--collected-at', 'collected_at', 64),
            ('--actor', 'actor', 160),
        ],
        'add-ioc': [
            ('--ioc-type', 'ioc_type', 80),
            ('--value', 'value', 4096),
            ('--confidence', 'confidence', 20),
            ('--source-evidence-id', 'source_evidence_id', 32),
            ('--first-seen', 'first_seen', 64),
            ('--last-seen', 'last_seen', 64),
            ('--actor', 'actor', 160),
        ],
        'add-rule': [
            ('--rule-type', 'rule_type', 40),
            ('--name', 'name', 240),
            ('--purpose', 'purpose', 2000),
            ('--source-evidence-id', 'source_evidence_id', 32),
            ('--actor', 'actor', 160),
        ],
        'link-finding': [
            (None, 'finding_id', 128),
            ('--relationship', 'relationship', 40),
            ('--actor', 'actor', 160),
        ],
        'note': [('--note', 'note', 12000), ('--actor', 'actor', 160)],
        'retract': [
            ('--item-type', 'item_type', 40),
            ('--item-id', 'item_id', 40),
            ('--reason', 'reason', 2000),
            ('--actor', 'actor', 160),
        ],
        'export': [],
        'draft-blog': [],
        'evidence-matrix': [('--actor', 'actor', 160)],
        'analyst-brief': [('--actor', 'actor', 160)],
        'publication-check': [('--actor', 'actor', 160)],
        'publication-approve': [('--review-id', 'review_id', 40), ('--actor', 'actor', 160)],
        'prepare-disclosure': [('--recipient', 'recipient', 320), ('--subject', 'subject', 240), ('--body', 'body', 30000), ('--embargo-until', 'embargo_until', 64), ('--actor', 'actor', 160)],
        'verdict': [('--verdict', 'verdict', 40), ('--confidence', 'confidence', 20), ('--rationale', 'rationale', 12000), ('--actor', 'actor', 160)],
        'sandbox-request': [('--artifact-sha256', 'artifact_sha256', 64), ('--justification', 'justification', 12000), ('--provider', 'provider', 80), ('--actor', 'actor', 160)],
        'sandbox-status': [('--status', 'status', 40), ('--result-json', 'result_json', 50000), ('--actor', 'actor', 160)],
        'disclosure-status': [('--status', 'status', 40), ('--actor', 'actor', 160)],
    }
    for flag, key, limit in fields[action]:
        value = _clean_string(payload.get(key), limit)
        if value:
            if flag is None:
                args.append(value)
            else:
                args.extend([flag, value])
    if action == 'add-rule':
        content = _clean_multiline_string(payload.get('content'), 512 * 1024)
        if not content:
            raise ValueError('content is required')
        args.extend(['--content', content])
    if action == 'add-ioc':
        for tag in (payload.get('tags') if isinstance(payload.get('tags'), list) else []):
            value = _clean_string(tag, 80)
            if value:
                args.extend(['--tag', value])
    if action == 'verdict':
        evidence_ids = payload.get('evidence_ids') if isinstance(payload.get('evidence_ids'), list) else []
        if not evidence_ids:
            raise ValueError('evidence_ids is required')
        for evidence_id in evidence_ids[:50]:
            args.extend(['--evidence-id', _clean_string(evidence_id, 32)])
    if action == 'sandbox-request':
        behaviors = payload.get('behaviors') if isinstance(payload.get('behaviors'), list) else []
        for behavior in behaviors[:20]:
            args.extend(['--behavior', _clean_string(behavior, 160)])
    if action == 'publication-approve':
        for waiver in (payload.get('waivers') if isinstance(payload.get('waivers'), list) else []):
            args.extend(['--waiver', _clean_string(waiver, 1000)])
    if action == 'sandbox-status' and payload.get('result') is not None:
        args.extend(['--result-json', json.dumps(payload.get('result'), sort_keys=True)])
    required = {
        'add-subject': ['--subject-type', '--name'],
        'add-evidence': ['--evidence-type', '--title'],
        'add-ioc': ['--ioc-type', '--value'],
        'add-rule': ['--rule-type', '--name'],
        'link-finding': [None],
        'note': ['--note'],
        'retract': ['--item-type', '--item-id', '--reason'],
        'intake-run': ['--ecosystem', '--package'],
        'verdict': ['--verdict', '--confidence', '--rationale'],
        'prepare-disclosure': ['--recipient'],
        'sandbox-request': ['--artifact-sha256', '--justification'],
        'sandbox-status': ['--status'],
        'disclosure-status': ['--status'],
    }
    for flag in required.get(action, []):
        if flag is None:
            if len(args) < 5:
                raise ValueError('finding_id is required')
        elif flag not in args:
            raise ValueError(f'{flag[2:].replace("-", "_")} is required')
    return args


def build_research_discovery_args(action, payload=None):
    """Build allowlisted Core discovery commands for dashboard buttons."""
    payload = payload if isinstance(payload, dict) else {}
    if action not in RESEARCH_DISCOVERY_ACTIONS:
        raise ValueError('Unsupported research discovery action')
    if action == 'capabilities':
        return ['research', 'ecosystems']
    if action == 'watchlist-list':
        args = ['research', 'watchlist', 'list']
        ecosystem = _clean_string(payload.get('ecosystem'), 40).lower()
        if ecosystem:
            if not ECOSYSTEM_RE.match(ecosystem):
                raise ValueError('Invalid ecosystem')
            args.extend(['--ecosystem', ecosystem])
        return args
    if action == 'watchlist-add':
        ecosystem = _clean_string(payload.get('ecosystem'), 40).lower()
        identifier = _clean_string(payload.get('identifier'), 512)
        if not ECOSYSTEM_RE.match(ecosystem) or not identifier or not PACKAGE_RE.match(identifier):
            raise ValueError('Valid ecosystem and identifier are required')
        watch_type = _clean_string(payload.get('watch_type') or 'package', 40)
        if watch_type not in {'package', 'namespace', 'publisher', 'brand', 'repository', 'organization'}:
            raise ValueError('Invalid watchlist type')
        args = ['research', 'watchlist', 'add', '--ecosystem', ecosystem, '--watch-type', watch_type, '--identifier', identifier]
        for value in payload.get('known_publishers', []) if isinstance(payload.get('known_publishers'), list) else []:
            args.extend(['--known-publisher', _clean_string(value, 240)])
        for flag, key, limit in [('--brand', 'brand', 240), ('--priority', 'priority', 20), ('--owner', 'owner', 160), ('--reason', 'reason', 2000)]:
            value = _clean_string(payload.get(key), limit)
            if value:
                args.extend([flag, value])
        threshold = payload.get('threshold')
        if threshold is not None:
            try:
                args.extend(['--threshold', str(max(0, min(float(threshold), 100)))])
            except (TypeError, ValueError) as exc:
                raise ValueError('threshold must be numeric') from exc
        return args
    if action == 'monitor-list':
        return ['research', 'monitor', 'list']
    if action == 'monitor-create':
        ecosystem = _clean_string(payload.get('ecosystem'), 40).lower()
        if not ECOSYSTEM_RE.match(ecosystem):
            raise ValueError('Invalid ecosystem')
        args = ['research', 'monitor', 'create', '--ecosystem', ecosystem]
        for flag, key, limit in [('--watchlist-id', 'watchlist_id', 40), ('--name', 'name', 160), ('--priority', 'priority', 20)]:
            value = _clean_string(payload.get(key), limit)
            if value:
                args.extend([flag, value])
        if '--watchlist-id' not in args:
            raise ValueError('Choose a watchlist before creating a monitor')
        try:
            args.extend(['--interval-seconds', str(max(900, min(int(payload.get('interval_seconds', 3600)), 86400 * 30)))])
        except (TypeError, ValueError) as exc:
            raise ValueError('interval_seconds must be an integer') from exc
        return args
    if action == 'monitor-run-due':
        return ['research', 'monitor', 'run-due', '--limit', str(max(1, min(int(payload.get('limit', 25)), 100)))]
    if action == 'candidate-list':
        args = ['research', 'candidate', 'list', '--limit', str(max(1, min(int(payload.get('limit', 100)), 500)))]
        for flag, key in [('--status', 'status'), ('--ecosystem', 'ecosystem')]:
            value = _clean_string(payload.get(key), 40)
            if value:
                args.extend([flag, value])
        return args
    if action == 'candidate-show':
        candidate_id = _clean_string(payload.get('candidate_id'), 64).upper()
        if not candidate_id.startswith('CAN-'):
            raise ValueError('Invalid candidate id')
        return ['research', 'candidate', 'show', candidate_id]
    if action == 'campaign-correlate':
        return ['research', 'campaign', 'correlate']
    if action == 'campaign-list':
        return ['research', 'campaign', 'list', '--limit', str(max(1, min(int(payload.get('limit', 100)), 500)))]
    if action == 'compare-packages':
        args = ['research', 'compare-packages']
        for prefix in ('left', 'right'):
            ecosystem = _clean_string(payload.get(f'{prefix}_ecosystem'), 40).lower()
            package = _clean_string(payload.get(f'{prefix}_package'), 512)
            version = _clean_string(payload.get(f'{prefix}_version'), 160)
            if not ECOSYSTEM_RE.match(ecosystem) or not package or not PACKAGE_RE.match(package):
                raise ValueError(f'Valid {prefix} ecosystem and package are required')
            args.extend([f'--{prefix}-ecosystem', ecosystem, f'--{prefix}-package', package])
            if version:
                args.extend([f'--{prefix}-version', version])
        return args
    if action == 'alert-list':
        return ['research', 'alert', 'list', '--limit', str(max(1, min(int(payload.get('limit', 100)), 500)))]
    if action == 'alert-deliver':
        alert_id = _clean_string(payload.get('alert_id'), 64).upper()
        if not alert_id.startswith('RAL-'):
            raise ValueError('Invalid research alert id')
        channel = _clean_string(payload.get('channel') or 'email', 20).lower()
        if channel not in {'email', 'webhook'}:
            raise ValueError('Invalid alert channel')
        return ['research', 'alert', 'deliver', alert_id, '--channel', channel]
    if action == 'collect-status':
        args = ['research', 'collect', 'status']
        ecosystem = _clean_string(payload.get('ecosystem'), 40).lower()
        if ecosystem:
            if not ECOSYSTEM_RE.match(ecosystem):
                raise ValueError('Invalid ecosystem')
            args.extend(['--ecosystem', ecosystem])
        return args
    if action == 'collect-run':
        ecosystem = _clean_string(payload.get('ecosystem'), 40).lower()
        if not ECOSYSTEM_RE.match(ecosystem):
            raise ValueError('A valid ecosystem is required to run a collector')
        args = ['research', 'collect', 'run', '--ecosystem', ecosystem]
        try:
            args.extend(['--max-pages', str(max(1, min(int(payload.get('max_pages', 10)), 100)))])
        except (TypeError, ValueError) as exc:
            raise ValueError('max_pages must be an integer') from exc
        return args
    if action == 'collect-retry-failures':
        try:
            limit = str(max(1, min(int(payload.get('limit', 25)), 200)))
        except (TypeError, ValueError) as exc:
            raise ValueError('limit must be an integer') from exc
        return ['research', 'collect', 'retry-failures', '--limit', limit]
    if action == 'collect-coverage':
        try:
            days = str(max(1, min(int(payload.get('days', 7)), 90)))
        except (TypeError, ValueError) as exc:
            raise ValueError('days must be an integer') from exc
        return ['research', 'collect', 'coverage', '--days', days]
    if action == 'collect-events':
        try:
            limit = str(max(1, min(int(payload.get('limit', 50)), 500)))
        except (TypeError, ValueError) as exc:
            raise ValueError('limit must be an integer') from exc
        args = ['research', 'collect', 'events', '--limit', limit]
        collector_id = _clean_string(payload.get('collector_id'), 48).upper()
        if collector_id:
            if not COLLECTOR_ID_RE.match(collector_id):
                raise ValueError('Invalid collector id')
            args.extend(['--collector-id', collector_id])
        package = _clean_string(payload.get('package'), 512)
        if package:
            if not PACKAGE_RE.match(package):
                raise ValueError('Invalid package filter')
            args.extend(['--package', package])
        return args
    if action in {'collect-pause', 'collect-resume'}:
        ecosystem = _clean_string(payload.get('ecosystem'), 40).lower()
        if not ECOSYSTEM_RE.match(ecosystem):
            raise ValueError('A valid ecosystem is required')
        verb = 'pause' if action == 'collect-pause' else 'resume'
        return ['research', 'collect', verb, '--ecosystem', ecosystem]
    if action == 'score-run':
        args = ['research', 'score', 'run']
        ecosystem = _clean_string(payload.get('ecosystem'), 40).lower()
        if ecosystem:
            if not ECOSYSTEM_RE.match(ecosystem):
                raise ValueError('Invalid ecosystem')
            args.extend(['--ecosystem', ecosystem])
        try:
            args.extend(['--limit', str(max(1, min(int(payload.get('limit', 200)), 2000)))])
        except (TypeError, ValueError) as exc:
            raise ValueError('limit must be an integer') from exc
        return args
    raise ValueError('Unsupported research discovery action')


def run_cli_json(args, timeout=120):
    result = run_secopsai_cli([*args, '--json'], timeout=timeout)
    parsed = parse_cli_json(result)
    return result, parsed


def build_research_watchlist_args(payload):
    """Build the preview/create command for the narrow npm watchlist flow."""
    action = _clean_string(payload.get('action'), 20).lower()
    if action not in {'preview', 'create'}:
        raise ValueError('Watchlist action must be preview or create')
    ecosystem = _clean_string(payload.get('ecosystem') or 'npm', 20).lower()
    if ecosystem != 'npm':
        raise ValueError('The dashboard watchlist workflow currently supports npm only')

    select_all = bool(payload.get('select_all'))
    packages = payload.get('packages')
    if isinstance(packages, str):
        packages = [packages]
    if not isinstance(packages, list):
        packages = []
    if len(packages) > 50:
        raise ValueError('Watchlist package limit is 50')
    cleaned_packages = []
    for package in packages:
        value = _clean_string(package, 260)
        if not value or not NPM_WATCHLIST_PACKAGE_RE.fullmatch(value):
            raise ValueError(f'Invalid npm watchlist package: {value[:80]}')
        cleaned_packages.append(value)
    if select_all and cleaned_packages:
        raise ValueError('Select all cannot be combined with individual packages')
    if not select_all and not cleaned_packages:
        raise ValueError('Select at least one npm package')

    args = ['research', 'case', 'from-watchlist', '--ecosystem', 'npm']
    if select_all:
        args.append('--all')
    else:
        for package in cleaned_packages:
            args.extend(['--package', package])
    if action == 'create':
        args.append('--create')
        for flag, key, limit in [
            ('--owner', 'owner', 160),
            ('--title-prefix', 'title_prefix', 240),
            ('--severity', 'severity', 20),
            ('--source-url', 'source_url', 4000),
            ('--actor', 'actor', 160),
        ]:
            value = _clean_string(payload.get(key), limit)
            if value:
                args.extend([flag, value])
    return args


def normalize_npm_watchlist_packages(values):
    packages = []
    for raw in values if isinstance(values, list) else []:
        value = _clean_string(raw, 260)
        if not NPM_WATCHLIST_PACKAGE_RE.fullmatch(value):
            continue
        name = value.split(':', 1)[1] if value.lower().startswith('npm:') else value
        packages.append({'value': value, 'name': name})
    return packages


def edge_api_snapshot():
    base_url = os.environ.get('SECOPSAI_EDGE_API_URL', '').strip().rstrip('/')
    operations_token = os.environ.get('SECOPSAI_EDGE_OPERATIONS_TOKEN', '').strip()
    legacy_admin_token = os.environ.get('SECOPSAI_EDGE_ADMIN_TOKEN', '').strip()
    access_token = operations_token or legacy_admin_token
    if not base_url or not access_token:
        return {
            'configured': False,
            'ok': False,
            'error': 'Set SECOPSAI_EDGE_API_URL and SECOPSAI_EDGE_OPERATIONS_TOKEN on the helper to load live sensor operations.',
            'sites': [],
            'sensors': [],
            'schedules': [],
            'scan_jobs': [],
        }
    resources = {
        'sites': ('/api/v1/sites', 'list'),
        'sensors': ('/api/v1/sensors', 'list'),
        'schedules': ('/api/v1/scan-schedules', 'list'),
        'scan_jobs': ('/api/v1/scan-jobs', 'list'),
    }
    if operations_token:
        resources['credential'] = ('/api/v1/integration-tokens/self', 'object')
    result = {
        'configured': True,
        'ok': True,
        'credential_scope': 'operations:read' if operations_token else 'legacy-admin',
    }
    if not operations_token:
        result['warning'] = (
            'Legacy Edge administrator credential is configured. Replace it with a scoped operations:read token.'
        )

    def fetch_resource(key, path, expected):
        request = urllib.request.Request(
            f'{base_url}{path}',
            headers={'Authorization': f'Bearer {access_token}', 'Accept': 'application/json'},
        )
        try:
            with urllib.request.urlopen(request, timeout=12) as response:
                payload = json.loads(response.read().decode('utf-8'))
            valid = isinstance(payload, list) if expected == 'list' else isinstance(payload, dict)
            empty = [] if expected == 'list' else {}
            return key, payload if valid else empty, None if valid else f'Edge API returned an invalid {key} response.'
        except urllib.error.HTTPError as exc:
            return key, [], f'Edge API returned HTTP {exc.code} for {key}.'
        except Exception:
            return key, [], f'Edge API is unavailable while loading {key}.'

    errors = []
    with ThreadPoolExecutor(max_workers=len(resources)) as executor:
        futures = [
            executor.submit(fetch_resource, key, path, expected)
            for key, (path, expected) in resources.items()
        ]
        for future in as_completed(futures):
            key, payload, error = future.result()
            result[key] = payload
            if error:
                if key == 'credential':
                    result['warning'] = (
                        'Live Edge operations are available, but credential expiry could not be verified. '
                        'Confirm the Edge API is current and inspect the token in Edge Settings.'
                    )
                else:
                    errors.append(error)
    credential = result.get('credential') or {}
    if credential.get('rotation_recommended'):
        days = credential.get('expires_in_days', 0)
        result['warning'] = (
            f'Edge operations credential expires in {days} day(s). Rotate it in Edge Settings, '
            'update this helper, verify the workspace, then revoke the previous credential.'
        )
    if errors:
        result['ok'] = False
        result['error'] = ' '.join(sorted(errors))
    return result


def collect_edge_workspace():
    assets_result, assets_payload = run_cli_json(
        ['graph', 'assets', '--limit', '500', *secopsai_db_args()],
        timeout=90,
    )
    changes_result, changes_payload = run_cli_json(
        ['graph', 'changes', '--limit', '100', *secopsai_db_args()],
        timeout=90,
    )
    findings_result, findings_payload = run_cli_json(
        ['triage', 'list', '--source', 'secopsai_edge', '--limit', '500', *secopsai_db_args()],
        timeout=90,
    )
    core_ok = bool(assets_result['ok'] and changes_result['ok'] and findings_result['ok'])
    core_error = None
    if not core_ok:
        core_error = 'Core Edge graph or findings could not be loaded. Run the Edge sync service and inspect its logs.'
    return {
        'ok': core_ok,
        'generated_at': datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z'),
        'core': {
            'ok': core_ok,
            'error': core_error,
            'assets': (assets_payload or {}).get('assets', []) if isinstance(assets_payload, dict) else [],
            'changes': changes_payload if isinstance(changes_payload, dict) else {'nodes': [], 'edges': []},
            'findings': (findings_payload or {}).get('findings', []) if isinstance(findings_payload, dict) else [],
        },
        'edge': edge_api_snapshot(),
    }


def _bounded_blog_limit(value, default=5):
    return str(validate_bounded_int(value, default=default, lower=1, upper=50))


def blog_draft_is_approved(draft):
    return str((draft or {}).get('review_status') or '') in {'approved', 'reviewed'}


def blog_draft_blockers(draft):
    blockers = (draft or {}).get('readiness_blockers') or []
    if not isinstance(blockers, list):
        blockers = []
    return [str(item) for item in blockers if str(item).strip()]


def blog_draft_is_publishable(draft):
    if not blog_draft_is_approved(draft):
        return False
    return str((draft or {}).get('readiness_status') or '').lower() != 'blocked' and not blog_draft_blockers(draft)


def publish_approved_blocked_error(payload):
    blocked = payload.get('blocked') if isinstance(payload, dict) else None
    if not isinstance(blocked, list) or not blocked:
        return None, None
    first = blocked[0] if isinstance(blocked[0], dict) else {}
    title = str(first.get('title') or first.get('slug') or 'approved draft')
    reasons = first.get('reasons') if isinstance(first.get('reasons'), list) else []
    reason_text = '; '.join(str(reason) for reason in reasons[:3] if str(reason).strip())
    error = f'Publish approved blocked by {len(blocked)} draft readiness check(s).'
    if reason_text:
        error = f'{error} {title}: {reason_text}.'
    hint = 'Open the blocked approved draft, resolve the readiness blockers or move it back to Needs review, then retry Publish approved.'
    return error, hint


def _blog_review_drafts_payload():
    result, parsed = run_cli_json(['blog', 'news-review', 'list'], timeout=90)
    if not result['ok']:
        return result, parsed
    drafts = (parsed or {}).get('drafts', [])
    drafts = sort_latest_first(drafts, BLOG_DRAFT_DATE_FIELDS)
    sources_result, sources_parsed = run_cli_json(['blog', 'news-sources', 'list'], timeout=60)
    sources = (sources_parsed or {}).get('sources', []) if sources_result['ok'] else []
    counts = {
        'sources': len([source for source in sources if source.get('enabled') is not False]) if isinstance(sources, list) else None,
        'drafts': len(drafts),
        'needs_review': len([draft for draft in drafts if draft.get('review_status') == 'needs_review']),
        'approved': len([draft for draft in drafts if draft.get('review_status') in {'approved', 'reviewed'}]),
        'approved_publishable': len([draft for draft in drafts if blog_draft_is_publishable(draft)]),
        'approved_blocked': len([draft for draft in drafts if blog_draft_is_approved(draft) and not blog_draft_is_publishable(draft)]),
        'deployed': len([draft for draft in drafts if draft.get('review_status') in {'deployed', 'published'}]),
        'rejected': len([draft for draft in drafts if draft.get('review_status') == 'rejected']),
    }
    payload = {
        'ok': True,
        'configured': True,
        'local_helper': True,
        'config': {
            'owner': 'local',
            'repo': str(SECOPSAI_ROOT),
            'workflow': 'secopsai.cli blog',
            'ref': 'local',
            'mode': 'local-helper-cli',
            'github_configured': False,
            'admin_token_configured': bool(blog_ops_expected_token()),
            'capabilities': {
                'github_actions': False,
                'workflow_history': False,
                'local_cli': True,
                'deploy': local_blog_deploy_available(),
            },
        },
        'mode': 'local-helper-cli',
        'capabilities': {
            'github_actions': False,
            'workflow_history': False,
            'local_cli': True,
            'deploy': local_blog_deploy_available(),
        },
        'drafts': drafts,
        'runs': [],
        'errors': {
            'drafts': None,
            'runs': 'Local helper mode does not read GitHub Actions workflow history.',
            'sources': None if sources_result['ok'] else (sources_result.get('stderr') or sources_result.get('stdout') or 'Unable to load sources'),
        },
        'counts': counts,
    }
    return {'ok': True, 'returncode': 0, 'stdout': json.dumps(payload), 'stderr': ''}, payload


def local_blog_deploy_project():
    project = os.environ.get('BLOG_OPS_LOCAL_DEPLOY_PROJECT', 'secopsai-blog').strip()
    if not project or not PAGES_PROJECT_RE.match(project):
        raise ValueError('Invalid BLOG_OPS_LOCAL_DEPLOY_PROJECT')
    return project


def local_blog_deploy_branch():
    branch = os.environ.get('BLOG_OPS_LOCAL_DEPLOY_BRANCH', 'main').strip()
    if not branch or not BRANCH_RE.match(branch) or '..' in branch:
        raise ValueError('Invalid BLOG_OPS_LOCAL_DEPLOY_BRANCH')
    return branch


def local_blog_deploy_command():
    blog_dir = (SECOPSAI_ROOT / 'blog').resolve()
    if not blog_dir.exists() or not blog_dir.is_dir():
        raise RuntimeError(f'Blog directory not found: {blog_dir}')
    project = local_blog_deploy_project()
    branch = local_blog_deploy_branch()
    wrangler = shutil.which('wrangler')
    if wrangler:
        return [wrangler, 'pages', 'deploy', str(blog_dir), '--project-name', project, '--branch', branch]
    npx = shutil.which('npx')
    if npx:
        return [npx, '--yes', 'wrangler@latest', 'pages', 'deploy', str(blog_dir), '--project-name', project, '--branch', branch]
    raise RuntimeError('Wrangler is not available. Install wrangler or Node/npm so npx can run wrangler@latest.')


def local_blog_deploy_available():
    blog_dir = (SECOPSAI_ROOT / 'blog').resolve()
    return bool(blog_dir.exists() and blog_dir.is_dir() and (shutil.which('wrangler') or shutil.which('npx')))


def run_local_blog_deploy(timeout=600):
    command = local_blog_deploy_command()
    result = subprocess.run(
        command,
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
        'command': ['[wrangler]' if index == 0 else part for index, part in enumerate(command)],
    }


def clean_blog_draft_id(draft):
    safe_draft = _clean_string(draft, 260)
    if (
        not safe_draft
        or not BLOG_DRAFT_ID_RE.fullmatch(safe_draft)
        or safe_draft in {'.', '..'}
        or '..' in safe_draft
    ):
        raise ValueError('Invalid draft')
    return safe_draft


def build_blog_ops_action_args(action, payload=None, draft=None):
    payload = payload or {}
    limit = _bounded_blog_limit(payload.get('limit'), default=5)
    note = _clean_string(payload.get('note') or '', 500)
    if action == 'news-run':
        return ['blog', 'news-run', '--limit', limit]
    if action == 'news-fetch':
        return ['blog', 'news-fetch', '--limit', limit]
    if action == 'news-draft':
        return ['blog', 'news-draft', '--limit', limit]
    if action == 'publish-approved':
        return ['blog', 'news-publish-approved', '--rebuild']
    if action == 'rebuild-feeds':
        return ['blog', 'rebuild-feeds']
    if action == 'deploy':
        raise ValueError('Deploy is handled by the local Wrangler deploy allowlist, not the SecOpsAI blog CLI allowlist.')
    if action == 'attach-source-media':
        safe_draft = clean_blog_draft_id(draft)
        args = ['blog', 'attach-source-media', safe_draft]
        media_url = _clean_string(payload.get('media_url') or payload.get('url') or '', 2400)
        if media_url:
            parsed = urllib.parse.urlparse(media_url)
            if parsed.scheme not in {'http', 'https'} or not parsed.netloc:
                raise ValueError('Invalid source media URL')
            args.extend(['--url', media_url])
        media_index = payload.get('media_index')
        if media_index is not None:
            try:
                media_index_int = max(0, min(50, int(media_index)))
            except (TypeError, ValueError):
                raise ValueError('Invalid media_index') from None
            args.extend(['--media-index', str(media_index_int)])
        field_map = {
            'alt': '--alt',
            'caption': '--caption',
            'kind': '--kind',
            'source_name': '--source-name',
            'source_url': '--source-url',
        }
        for key, flag in field_map.items():
            value = payload.get(key)
            if value is None:
                continue
            cleaned = _clean_string(value, 2400 if key in {'caption', 'source_url'} else 260)
            if not cleaned:
                continue
            if key == 'source_url':
                parsed = urllib.parse.urlparse(cleaned)
                if parsed.scheme not in {'http', 'https'} or not parsed.netloc:
                    raise ValueError('Invalid source URL')
            args.extend([flag, cleaned])
        return args
    if action in {'approve', 'reject', 'needs-review'}:
        safe_draft = clean_blog_draft_id(draft)
        args = ['blog', 'news-review', action, safe_draft]
        if note:
            args.extend(['--note', note])
        return args
    if action == 'save':
        safe_draft = clean_blog_draft_id(draft)
        args = ['blog', 'news-review', 'edit', safe_draft]
        field_map = {
            'title': '--title',
            'summary': '--summary',
            'severity': '--severity',
            'categories': '--categories',
            'references': '--references',
            'body_markdown': '--body',
        }
        for key, flag in field_map.items():
            value = payload.get(key)
            if value is None:
                continue
            cleaned = str(value)
            if key == 'severity':
                cleaned = _clean_string(cleaned, 20).lower()
            elif key == 'body_markdown':
                cleaned = cleaned[:60000]
            else:
                cleaned = _clean_string(cleaned, 2400)
            if cleaned:
                args.extend([flag, cleaned])
        if note:
            args.extend(['--note', note])
        return args
    raise ValueError('Unsupported Blog Ops action')


def redact_secretish_text(value):
    text = str(value or '')
    return SECRETISH_RE.sub(lambda match: f'{match.group(1)}: [redacted]', text)


def compact_cli_result(result, limit=12000):
    return {
        'ok': bool((result or {}).get('ok')),
        'returncode': int((result or {}).get('returncode') or 0),
        'stdout': redact_secretish_text((result or {}).get('stdout', ''))[:limit],
        'stderr': redact_secretish_text((result or {}).get('stderr', ''))[:limit],
        'truncated': len(str((result or {}).get('stdout', ''))) > limit or len(str((result or {}).get('stderr', ''))) > limit,
    }


def _clean_string(value, limit=500):
    return ' '.join(str(value or '').split())[:limit]


def _clean_multiline_string(value, limit=500):
    text = str(value or '').strip()
    if '\x00' in text:
        raise ValueError('content contains invalid control characters')
    if len(text) > limit:
        raise ValueError(f'content exceeds {limit} characters')
    return text


def _clean_string_list(values, limit=80, item_limit=500):
    if isinstance(values, str):
        values = [values]
    if isinstance(values, dict):
        flattened = []
        for item in values.values():
            if isinstance(item, list):
                flattened.extend(item)
            elif item:
                flattened.append(item)
        values = flattened
    if not isinstance(values, list):
        return []
    cleaned = []
    for value in values[:limit]:
        item = _clean_string(value, item_limit)
        if item:
            cleaned.append(item)
    return cleaned


def _clean_iocs(value):
    if isinstance(value, dict):
        cleaned = {}
        for key, values in value.items():
            safe_key = re.sub(r'[^a-z0-9_ -]', '', str(key or '').lower()).strip().replace(' ', '_')[:80]
            if safe_key:
                cleaned[safe_key] = _clean_string_list(values if isinstance(values, list) else [values], limit=60, item_limit=240)
        return {key: values for key, values in cleaned.items() if values}
    items = _clean_string_list(value, limit=100, item_limit=240)
    return {'operator_supplied': items} if items else {}


def _is_empty_campaign_value(value):
    return value == '' or value == [] or value == {}


def validate_campaign_payload(payload):
    if not isinstance(payload, dict):
        raise ValueError('Campaign payload must be a JSON object')
    campaign = payload.get('campaign') if isinstance(payload.get('campaign'), dict) else payload
    campaign_id = _clean_string(campaign.get('campaign_id'), 140)
    if campaign_id and not CAMPAIGN_ID_RE.match(campaign_id):
        raise ValueError('Invalid campaign_id')
    packages = campaign.get('packages') or []
    if not isinstance(packages, list):
        raise ValueError('Campaign packages must be an array')
    if len(packages) > 50:
        raise ValueError('Campaign package limit is 50')

    normalized_packages = []
    for row in packages:
        if not isinstance(row, dict):
            raise ValueError('Each campaign package must be an object')
        ecosystem = _clean_string(row.get('ecosystem'), 80).lower()
        package = _clean_string(row.get('package') or row.get('artifact') or row.get('id'), 260)
        version = _clean_string(row.get('version') or row.get('revision') or '', 160)
        if not ecosystem or ecosystem not in ALLOWED_CAMPAIGN_ECOSYSTEMS:
            raise ValueError(f'Unsupported ecosystem: {ecosystem or "missing"}')
        if not package or not PACKAGE_RE.match(package):
            raise ValueError(f'Invalid package for {ecosystem}')
        if version and not VERSION_RE.match(version):
            raise ValueError(f'Invalid version for {package}')
        normalized = {
            'ecosystem': ecosystem,
            'package': package,
            'version': version,
            'publisher': _clean_string(row.get('publisher') or row.get('maintainer'), 180),
            'behavioral_indicators': _clean_string_list(row.get('behavioral_indicators') or row.get('behavior_notes'), limit=40),
        }
        files = row.get('files')
        if isinstance(files, dict):
            normalized['files'] = {
                _clean_string(name, 180): str(content or '')[:50000]
                for name, content in list(files.items())[:20]
                if _clean_string(name, 180)
            }
        normalized_packages.append({key: value for key, value in normalized.items() if not _is_empty_campaign_value(value)})

    source_urls = _clean_string_list(campaign.get('source_urls') or campaign.get('source_url'), limit=40)
    for url in source_urls:
        if not SAFE_SOURCE_URL_RE.match(url):
            raise ValueError(f'Invalid source URL: {url[:80]}')

    normalized = {
        'campaign_id': campaign_id,
        'title': _clean_string(campaign.get('title') or campaign_id or 'Supply-chain campaign research', 240),
        'summary': _clean_string(campaign.get('summary'), 1200),
        'severity': _clean_string(campaign.get('severity') or 'high', 40).lower(),
        'confidence': _clean_string(campaign.get('confidence') or 'medium', 40).lower(),
        'source_names': _clean_string_list(campaign.get('source_names'), limit=40),
        'source_urls': source_urls,
        'actors': _clean_string_list(campaign.get('actors'), limit=40),
        'publishers': _clean_string_list(campaign.get('publishers'), limit=40),
        'iocs': _clean_iocs(campaign.get('iocs')),
        'behavioral_indicators': _clean_string_list(campaign.get('behavioral_indicators'), limit=100),
        'packages': normalized_packages,
    }
    if not normalized['packages']:
        raise ValueError('Add at least one campaign package before running research')
    return {key: value for key, value in normalized.items() if not _is_empty_campaign_value(value)}


def _recommendation_package_rows(*sources):
    """Return bounded, normalized package subjects for the read-only route evaluator."""
    rows = []
    seen = set()
    for source in sources:
        if not isinstance(source, list):
            continue
        for item in source[:50]:
            if not isinstance(item, dict):
                continue
            ecosystem = _clean_string(item.get('ecosystem'), 80).lower()
            package = _clean_string(item.get('package') or item.get('artifact') or item.get('id') or item.get('name'), 260)
            version = _clean_string(item.get('version') or item.get('revision'), 160)
            publisher = _clean_string(item.get('publisher') or item.get('maintainer'), 180)
            if ecosystem not in ALLOWED_CAMPAIGN_ECOSYSTEMS or not package or not PACKAGE_RE.match(package):
                continue
            if re.match(r'^(?:https?://|www\.)', package, re.IGNORECASE):
                continue
            if re.search(r'\.(?:png|jpe?g|gif|webp|svg|html?|css|js)$', package, re.IGNORECASE):
                continue
            if len(package) > 90 and '/' not in package:
                continue
            key = (ecosystem, package.lower(), version.lower())
            if key in seen:
                continue
            seen.add(key)
            indicators = _clean_string_list(
                item.get('behavioral_indicators') or item.get('behavior_notes') or item.get('matched_rules'),
                limit=20,
                item_limit=240,
            )
            rows.append(
                {
                    'ecosystem': ecosystem,
                    'package': package,
                    'version': version,
                    'publisher': publisher,
                    'behavioral_indicators': indicators,
                }
            )
    return rows[:50]


def _recommendation_ioc_values(*sources):
    values = []
    seen = set()
    for source in sources:
        if isinstance(source, dict):
            source = [item for group in source.values() for item in (group if isinstance(group, list) else [group])]
        if not isinstance(source, list):
            continue
        for value in source[:100]:
            clean = _clean_string(value, 240)
            if not clean or clean.lower() in seen:
                continue
            seen.add(clean.lower())
            values.append(clean)
    return values[:40]


def build_research_case_recommendation(payload):
    """Classify a lead without making a finding, disclosure, or publication decision."""
    if not isinstance(payload, dict):
        raise ValueError('Recommendation payload must be a JSON object')
    campaign = payload.get('campaign') if isinstance(payload.get('campaign'), dict) else {}
    candidate_campaign = payload.get('candidate_campaign') if isinstance(payload.get('candidate_campaign'), dict) else {}
    orchestrator = payload.get('orchestrator') if isinstance(payload.get('orchestrator'), dict) else {}
    campaign_result = payload.get('campaign_result') if isinstance(payload.get('campaign_result'), dict) else {}

    manual_packages = campaign.get('packages') if isinstance(campaign.get('packages'), list) else []
    candidate_packages = candidate_campaign.get('packages') if isinstance(candidate_campaign.get('packages'), list) else []
    validated_packages = orchestrator.get('validated_packages') if isinstance(orchestrator.get('validated_packages'), list) else []
    result_packages = campaign_result.get('packages') if isinstance(campaign_result.get('packages'), list) else []
    packages = _recommendation_package_rows(manual_packages, candidate_packages, validated_packages, result_packages)

    references = []
    for source in (campaign.get('source_urls'), candidate_campaign.get('source_urls'), campaign_result.get('references')):
        for url in _clean_string_list(source, limit=40, item_limit=500):
            if SAFE_SOURCE_URL_RE.match(url) and url not in references:
                references.append(url)
    references = references[:40]

    behavioral_indicators = _clean_string_list(campaign.get('behavioral_indicators'), limit=60, item_limit=240)
    for row in packages:
        for indicator in row.get('behavioral_indicators', []):
            if indicator not in behavioral_indicators:
                behavioral_indicators.append(indicator)
    validated_iocs = _recommendation_ioc_values(
        orchestrator.get('validated_iocs'),
        campaign_result.get('validated_iocs'),
    )

    route = _clean_string(
        orchestrator.get('recommended_route') or orchestrator.get('route') or payload.get('recommended_route'),
        80,
    ).lower()
    route_blockers = _clean_string_list(orchestrator.get('route_blockers') or payload.get('route_blockers'), limit=20, item_limit=500)
    if route in {'vulnerability_tracking', 'general_threat_intel', 'malware_tracking', 'news_review'}:
        route_blockers.append(f'Lead is routed to {route.replace("_", " ")}; do not force it into package research.')

    confidence_hint = _clean_string(
        orchestrator.get('confidence') or campaign_result.get('confidence') or campaign.get('confidence'),
        40,
    ).lower()
    score = 0
    reasons = []
    if packages:
        score += 2
        reasons.append(f'{len(packages)} normalized package subject(s) are available for a durable investigation.')
    else:
        reasons.append('No validated package or extension subject is available yet.')
    if len(packages) >= 2:
        score += 1
        reasons.append('Multiple package subjects support campaign-level research.')
    if references:
        score += 1
        reasons.append(f'{len(references)} public source reference(s) are available for provenance.')
    if behavioral_indicators:
        score += 1
        reasons.append(f'{len(behavioral_indicators)} behavioral indicator(s) describe a researchable lead.')
    if validated_iocs:
        score += 1
        reasons.append(f'{len(validated_iocs)} IOC value(s) were separated from source references.')
    if route == 'campaign_research':
        score += 2
        reasons.append('The reviewed route is campaign research.')
    if confidence_hint in {'high', 'confirmed'}:
        score += 1
        reasons.append(f'Upstream review confidence is {confidence_hint}.')

    if route and route not in {'campaign_research'}:
        disposition = 'keep_in_triage'
        label = 'Keep in Triage Ops'
    elif not packages:
        disposition = 'keep_in_triage'
        label = 'Keep in Triage Ops'
    elif route_blockers:
        disposition = 'needs_human_review'
        label = 'Needs Human Review'
    elif score >= 5:
        disposition = 'create_draft_case'
        label = 'Draft Research Case Recommended'
    else:
        disposition = 'needs_human_review'
        label = 'Needs Human Review'

    blockers = list(dict.fromkeys(route_blockers))
    if packages and score < 5 and disposition == 'needs_human_review':
        blockers.append('Evidence is not yet strong enough for an automatic draft recommendation; review the source and package evidence first.')
    if not packages:
        blockers.append('Add or validate a package subject before creating a research case.')
    blockers = blockers[:10]

    title = _clean_string(
        campaign.get('title') or candidate_campaign.get('title') or campaign.get('campaign_id') or packages[0]['package'] if packages else 'Research lead',
        240,
    )
    case_title = f'Research lead: {title}'[:240]
    package_labels = ', '.join(f"{row['ecosystem']}:{row['package']}" for row in packages[:8])
    summary_parts = [f'Lead surfaced by Triage Ops for {package_labels or "an unresolved supply-chain subject"}.']
    if references:
        summary_parts.append(f'Provenance includes {len(references)} public source reference(s).')
    if behavioral_indicators:
        summary_parts.append('Behavior indicators are recorded for analyst validation; this draft does not assert maliciousness.')
    summary_parts.append('Created from a triage recommendation. Human review is required before evidence, disclosure, or publication decisions.')
    subjects = [
        {
            'subject_type': 'package' if row['ecosystem'] != 'chrome-web-store' else 'extension',
            'ecosystem': row['ecosystem'],
            'name': row['package'],
            'version': row['version'],
            'publisher': row['publisher'],
        }
        for row in packages[:20]
    ]
    severity = _clean_string(campaign.get('severity') or 'medium', 20).lower()
    if severity not in {'critical', 'high', 'medium', 'low', 'info'}:
        severity = 'medium'
    case_confidence = 'high' if confidence_hint in {'high', 'confirmed'} or score >= 7 else 'medium' if score >= 5 else 'low'
    finding_id = _clean_string(payload.get('finding_id'), 128)
    if finding_id and not FINDING_ID_RE.match(finding_id):
        finding_id = ''
        blockers.append('The supplied source finding identifier is invalid and will not be linked automatically.')

    return {
        'route': disposition,
        'label': label,
        'score': max(0, min(score, 100)),
        'confidence': case_confidence,
        'reasons': reasons[:12],
        'blockers': blockers[:10],
        'checks': {
            'package_count': len(packages),
            'reference_count': len(references),
            'behavioral_indicator_count': len(behavioral_indicators),
            'validated_ioc_count': len(validated_iocs),
            'reviewed_route': route or 'manual_campaign',
            'source_finding_id': finding_id or None,
        },
        'suggested_case': {
            'title': case_title,
            'summary': ' '.join(summary_parts)[:8000],
            'case_type': 'supply_chain_campaign',
            'severity': severity,
            'confidence': case_confidence,
            'owner': 'SecOpsAI Research',
            'subjects': subjects,
            'source_urls': references,
        },
    }


def validate_campaign_search_root(value):
    raw = _clean_string(value, 600)
    if not raw:
        return ''
    target = Path(raw).expanduser().resolve()
    if not target.exists() or not target.is_dir():
        raise ValueError('search_root must be an existing directory')
    if str(target) == '/':
        raise ValueError('search_root cannot be filesystem root')
    return str(target)


def build_campaign_research_args(input_path, *, persist=False, search_root=''):
    args = ['supply-chain', 'research-campaign', '--input', str(input_path)]
    if persist:
        args.append('--persist')
    else:
        args.append('--dry-run')
    if search_root:
        args.extend(['--search-root', search_root])
    return args


def build_campaign_blog_args(input_path):
    return ['blog', 'draft-campaign', '--campaign', str(input_path)]


def validate_duration(value, default='24h'):
    raw = _clean_string(value or default, 40)
    if not re.match(r'^\d{1,4}[smhd]?$', raw):
        raise ValueError('Invalid duration; use values like 24h, 2h, or 7d')
    return raw


def validate_bounded_int(value, default=10, lower=1, upper=100):
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        parsed = default
    return max(lower, min(parsed, upper))


def validate_source_filter(value):
    raw = _clean_string(value or 'all', 120)
    if not re.match(r'^[A-Za-z0-9 ._:/-]{1,120}$', raw):
        raise ValueError('Invalid source filter')
    return raw


def build_campaign_discover_args(payload):
    since = validate_duration(payload.get('since') or '24h')
    source = validate_source_filter(payload.get('source') or 'all')
    limit = validate_bounded_int(payload.get('limit'), default=10, lower=1, upper=50)
    return ['supply-chain', 'discover-campaigns', '--since', since, '--source', source, '--limit', str(limit)]


def build_campaign_autopilot_args(payload):
    since = validate_duration(payload.get('since') or '24h')
    limit = validate_bounded_int(payload.get('limit'), default=10, lower=1, upper=50)
    min_score = validate_bounded_int(payload.get('min_score'), default=35, lower=0, upper=100)
    persist = bool(payload.get('persist'))
    create_drafts = bool(payload.get('create_drafts'))
    args = [
        'supply-chain',
        'campaign-autopilot',
        '--since',
        since,
        '--limit',
        str(limit),
        '--min-score',
        str(min_score),
    ]
    if persist:
        args.append('--persist')
    else:
        args.append('--dry-run')
    if create_drafts:
        args.append('--create-drafts')
    search_root = validate_campaign_search_root(payload.get('search_root') or '')
    if search_root:
        args.extend(['--search-root', search_root])
    return args, persist or create_drafts


def build_campaign_watchlist_args(payload):
    args = ['supply-chain', 'campaign-watchlist', 'add']
    added = False
    for key in ('package', 'publisher', 'ioc', 'source_url'):
        value = _clean_string(payload.get(key), 500)
        if not value:
            continue
        if key == 'source_url' and not SAFE_SOURCE_URL_RE.match(value):
            raise ValueError('Invalid source_url')
        args.extend([f'--{key.replace("_", "-")}', value])
        added = True
    if not added:
        raise ValueError('Add a package, publisher, IOC, or source URL')
    return args


def run_campaign_with_tempfile(campaign, args_builder, timeout=240, json_output=True):
    temp_path = None
    try:
        with tempfile.NamedTemporaryFile('w', encoding='utf-8', suffix='.json', prefix='secopsai-campaign-', delete=False) as handle:
            json.dump(campaign, handle, ensure_ascii=False, indent=2)
            temp_path = Path(handle.name)
        if json_output:
            result, parsed = run_cli_json(args_builder(temp_path), timeout=timeout)
        else:
            result = run_secopsai_cli(args_builder(temp_path), timeout=timeout)
            parsed = parse_cli_json(result)
        return result, parsed
    finally:
        if temp_path:
            try:
                temp_path.unlink(missing_ok=True)
            except Exception:
                pass


def campaign_fixture_payloads():
    fixtures = []
    for path in CAMPAIGN_FIXTURE_PATHS:
        payload = read_json_file(path, None)
        if isinstance(payload, dict):
            fixtures.append(
                {
                    'id': payload.get('campaign_id') or path.stem,
                    'title': payload.get('title') or payload.get('campaign_id') or path.stem,
                    'campaign': validate_campaign_payload(payload),
                }
            )
    return fixtures


def triage_findings_by_status(status, limit=100):
    result, parsed = run_cli_json(
        ['triage', 'list', '--status', status, '--category', 'supply_chain', '--limit', str(limit), *secopsai_db_args()],
        timeout=60,
    )
    if not result.get('ok') or not isinstance(parsed, dict):
        return []
    rows = parsed.get('findings') or []
    return sort_latest_first(rows, TRIAGE_FINDING_DATE_FIELDS)[:limit] if isinstance(rows, list) else []


def get_triage_ops_finding(finding_id):
    for status in ('open', 'in_review'):
        for finding in triage_findings_by_status(status, limit=500):
            if str(finding.get('finding_id') or '') == finding_id:
                return finding
    return None


def should_ignore_dependency_path(path):
    try:
        rel = path.resolve().relative_to(SECOPSAI_ROOT)
        return any(part in IGNORED_DEP_PATHS for part in rel.parts)
    except Exception:
        return any(part in IGNORED_DEP_PATHS for part in path.parts)


def dependency_manifest_paths():
    global _DEPENDENCY_MANIFEST_CACHE
    if _DEPENDENCY_MANIFEST_CACHE is not None:
        return _DEPENDENCY_MANIFEST_CACHE
    if not SECOPSAI_ROOT.exists():
        return []
    rg_args = [
        'rg',
        '--files',
        '-g',
        'package.json',
        '-g',
        'package-lock.json',
        '-g',
        'pnpm-lock.yaml',
        '-g',
        'yarn.lock',
        '-g',
        'pyproject.toml',
        '-g',
        'Pipfile',
        '-g',
        'poetry.lock',
        '-g',
        'uv.lock',
        '-g',
        'requirements*.txt',
        '-g',
        '!**/.git/**',
        '-g',
        '!**/.venv/**',
        '-g',
        '!**/venv/**',
        '-g',
        '!**/node_modules/**',
        '-g',
        '!**/site-packages/**',
        '-g',
        '!**/dist/**',
        '-g',
        '!**/build/**',
    ]
    try:
        result = subprocess.run(
            rg_args,
            cwd=str(SECOPSAI_ROOT),
            capture_output=True,
            text=True,
            timeout=8,
            check=False,
        )
        if result.returncode in {0, 1}:
            _DEPENDENCY_MANIFEST_CACHE = [
                (SECOPSAI_ROOT / line.strip()).resolve()
                for line in result.stdout.splitlines()
                if line.strip()
            ]
            return _DEPENDENCY_MANIFEST_CACHE
    except Exception:
        pass
    paths = []
    for path in SECOPSAI_ROOT.rglob('*'):
        if not path.is_file() or should_ignore_dependency_path(path):
            continue
        if path.name in DEPENDENCY_FILE_NAMES or (
            path.name.startswith('requirements') and path.suffix == '.txt'
        ):
            paths.append(path)
    _DEPENDENCY_MANIFEST_CACHE = paths
    return paths


def dependency_manifest_text(path):
    try:
        stat = path.stat()
        cache_key = str(path)
        cached = _DEPENDENCY_TEXT_CACHE.get(cache_key)
        fingerprint = (stat.st_mtime_ns, stat.st_size)
        if cached and cached.get('fingerprint') == fingerprint:
            return cached.get('text', '')
        text = path.read_text(encoding='utf-8', errors='ignore')
        _DEPENDENCY_TEXT_CACHE[cache_key] = {'fingerprint': fingerprint, 'text': text}
        return text
    except Exception:
        return ''


def check_local_dependency_usage(package, version=''):
    package_name = str(package or '').strip()
    if not package_name:
        return {'present': False, 'matches': [], 'searched_files': 0}
    package_pattern = re.compile(rf'(?<![A-Za-z0-9_.@/-]){re.escape(package_name)}(?![A-Za-z0-9_.@/-])', re.IGNORECASE)
    version_pattern = re.compile(re.escape(str(version)), re.IGNORECASE) if version else None
    matches = []
    searched = 0
    for path in dependency_manifest_paths():
        searched += 1
        lines = dependency_manifest_text(path).splitlines()
        if not lines:
            continue
        for idx, line in enumerate(lines, start=1):
            if not package_pattern.search(line):
                continue
            matches.append(
                {
                    'path': str(path),
                    'line': idx,
                    'text': line.strip()[:220],
                    'version_match': bool(version_pattern.search(line)) if version_pattern else False,
                }
            )
            if len(matches) >= 30:
                return {'present': True, 'matches': matches, 'searched_files': searched}
    return {'present': bool(matches), 'matches': matches, 'searched_files': searched}


def advisory_check(ecosystem, package, version):
    if not (ecosystem and package and version):
        return {'matched': False, 'matches': [], 'error': 'Missing ecosystem, package, or version'}
    result, parsed = run_cli_json(
        ['supply-chain', 'advisory', 'check', '--ecosystem', ecosystem, '--package', package, '--version', version],
        timeout=60,
    )
    if isinstance(parsed, dict):
        parsed['ok'] = result.get('ok')
        return parsed
    return {'ok': False, 'matched': False, 'matches': [], 'error': result.get('stderr') or result.get('stdout')}


def build_triage_ops_recommendation(finding, advisory=None, local_usage=None):
    ecosystem = str(finding.get('ecosystem') or '').lower()
    package = str(finding.get('package') or '').strip()
    version = str(finding.get('new_version') or finding.get('version') or '').strip()
    key = (ecosystem, package.lower())
    known_bad_versions = sorted(KNOWN_COMPROMISED_VERSIONS.get(key, set()))
    min_safe = MIN_SAFE_VERSION_HINTS.get(key)
    local_present = bool((local_usage or {}).get('present'))
    advisory_matched = bool((advisory or {}).get('matched') or finding.get('advisory_matches') or finding.get('advisory_ids'))
    is_known_bad = version in set(known_bad_versions)
    rules = str(finding.get('analysis') or finding.get('summary') or '')
    evidence = []

    if advisory_matched:
        disposition = 'true_positive'
        confidence = 'high'
        evidence.append('Emergency advisory matched this exact package/version.')
    elif is_known_bad:
        disposition = 'true_positive'
        confidence = 'high'
        evidence.append(f'{package}@{version} is in the local known-compromised version list.')
    elif package.lower() == 'litellm' and version in {'1.84.0', '1.85.0rc2'} and not local_present:
        disposition = 'false_positive'
        confidence = 'medium'
        evidence.append('Known public LiteLLM compromise reporting names 1.82.7/1.82.8, not this exact version.')
        evidence.append('No local dependency reference was found in this repo.')
    elif not local_present:
        disposition = 'not_applicable'
        confidence = 'medium'
        evidence.append('No local dependency reference was found in this repo.')
    else:
        disposition = 'needs_review'
        confidence = 'medium'
        evidence.append('Package appears locally referenced or needs additional analyst review.')

    if min_safe and package.lower() == 'litellm':
        evidence.append(f'CVE-2026-42208 mitigation guidance requires {package}>={min_safe}.')
    if rules:
        evidence.append(f'Scanner rationale: {rules[:220]}')

    note = ' '.join(evidence[:3])
    return {
        'recommended_disposition': disposition,
        'confidence': confidence,
        'recommended_note': note,
        'evidence': evidence,
        'known_bad_versions': known_bad_versions,
        'minimum_safe_version': min_safe,
        'local_dependency_reference': local_present,
        'advisory_match': advisory_matched,
        'known_bad_version_match': is_known_bad,
        'report_path': finding.get('report_path'),
    }


def mitigation_for_finding(finding, recommendation=None, local_usage=None, advisory=None):
    ecosystem = str(finding.get('ecosystem') or '').lower()
    package = str(finding.get('package') or '').strip()
    version = str(finding.get('new_version') or finding.get('version') or '').strip()
    key = (ecosystem, package.lower())
    known_bad = sorted(KNOWN_COMPROMISED_VERSIONS.get(key, set()))
    min_safe = MIN_SAFE_VERSION_HINTS.get(key)
    iocs = KNOWN_IOC_HINTS.get(key, [])
    commands = [
        'secopsai triage summary',
        f'secopsai triage investigate {finding.get("finding_id")} --json',
        f'secopsai supply-chain advisory check --ecosystem {ecosystem} --package {package} --version {version}',
    ]
    if known_bad:
        commands.extend(
            f'secopsai supply-chain advisory check --ecosystem {ecosystem} --package {package} --version {bad}'
            for bad in known_bad
        )
    actions = [
        f'Review {package}@{version} against advisory and local dependency evidence before closing.',
        f'Pin {package} to a reviewed version if it is used in production.',
        'Do not globally allowlist a package with recent compromise or critical CVE history.',
    ]
    if known_bad:
        actions.append(f'Block or denylist known compromised versions: {", ".join(f"{package}=={item}" for item in known_bad)}.')
    if min_safe:
        actions.append(f'Require {package}>={min_safe} where this package is deployed.')
    if iocs:
        actions.append(f'Search environments for: {", ".join(iocs)}.')
    if known_bad:
        actions.append('If any known compromised version was installed, rotate LLM provider keys, cloud keys, CI/CD tokens, SSH keys, registry tokens, and database secrets.')
    return {
        'affected': {'ecosystem': ecosystem, 'package': package, 'version': version},
        'local_usage': local_usage or {'present': False, 'matches': []},
        'advisory': advisory or {'matched': False, 'matches': []},
        'recommendation': recommendation or {},
        'actions': actions,
        'iocs': iocs,
        'operator_commands': commands,
        'blog_summary': f'SecOpsAI reviewed {ecosystem}:{package}@{version}; current recommended disposition is {(recommendation or {}).get("recommended_disposition", "needs_review")}.',
    }


def triage_ops_actionability(recommendation=None, advisory=None, local_usage=None):
    recommendation = recommendation or {}
    advisory = advisory or {}
    local_usage = local_usage or {}
    disposition = str(recommendation.get('recommended_disposition') or 'needs_review')
    advisory_matched = bool(advisory.get('matched') or recommendation.get('advisory_match'))
    local_present = bool(local_usage.get('present') or recommendation.get('local_dependency_reference'))
    known_bad = bool(recommendation.get('known_bad_version_match'))
    if advisory_matched or known_bad or disposition in {'true_positive', 'needs_review'}:
        return {
            'bucket': 'actionable',
            'label': 'Actionable',
            'is_actionable': True,
            'reason': 'Advisory, known-bad version, local usage, or unresolved review evidence requires operator action.',
        }
    if disposition == 'not_applicable' and not local_present:
        return {
            'bucket': 'no_local_impact',
            'label': 'No local impact',
            'is_actionable': False,
            'reason': 'No matching dependency reference was found in the local repository.',
        }
    if disposition in {'false_positive', 'expected_behavior', 'tune_policy', 'not_applicable'}:
        return {
            'bucket': 'review_only',
            'label': 'Review only',
            'is_actionable': False,
            'reason': 'Scanner evidence is preserved for audit, but it is not currently an actionable incident.',
        }
    return {
        'bucket': 'actionable' if local_present else 'review_only',
        'label': 'Actionable' if local_present else 'Review only',
        'is_actionable': bool(local_present),
        'reason': 'Local usage is present.' if local_present else 'No local impact evidence is present yet.',
    }


def triage_ops_display_severity(finding, actionability=None):
    severity = str((finding or {}).get('severity') or 'info').lower()
    bucket = str((actionability or {}).get('bucket') or '')
    if bucket == 'no_local_impact':
        return 'info'
    if bucket == 'review_only' and severity in {'critical', 'high'}:
        return 'medium'
    return severity


def summarize_triage_ops_alert(finding):
    ecosystem = str(finding.get('ecosystem') or '').lower()
    package = str(finding.get('package') or '').strip()
    version = str(finding.get('new_version') or finding.get('version') or '').strip()
    local_usage = check_local_dependency_usage(package, version)
    existing_matches = finding.get('advisory_matches') if isinstance(finding.get('advisory_matches'), list) else []
    advisory = {
        'matched': bool(existing_matches or finding.get('advisory_ids') or finding.get('campaign_ids')),
        'matches': existing_matches,
        'source': 'finding_snapshot',
    }
    recommendation = build_triage_ops_recommendation(finding, advisory=advisory, local_usage=local_usage)
    actionability = triage_ops_actionability(recommendation, advisory=advisory, local_usage=local_usage)
    return {
        'finding_id': finding.get('finding_id'),
        'ecosystem': ecosystem,
        'package': package,
        'version': version,
        'old_version': finding.get('old_version'),
        'severity': finding.get('severity'),
        'severity_score': finding.get('severity_score'),
        'status': finding.get('status'),
        'title': finding.get('title'),
        'summary': finding.get('summary') or finding.get('analysis'),
        'source': finding.get('source'),
        'first_seen': finding.get('first_seen'),
        'last_seen': finding.get('last_seen'),
        'verdict': finding.get('verdict'),
        'analysis': finding.get('analysis'),
        'report_path': finding.get('report_path'),
        'recommendation': recommendation,
        'actionability': actionability,
        'display_severity': triage_ops_display_severity(finding, actionability),
        'local_usage': {'present': local_usage.get('present'), 'match_count': len(local_usage.get('matches') or [])},
        'advisory': {'matched': advisory.get('matched'), 'match_count': len(advisory.get('matches') or [])},
    }


def collect_triage_ops_alerts():
    rows = triage_findings_by_status('open', limit=200) + triage_findings_by_status('in_review', limit=200)
    seen = set()
    alerts = []
    for finding in rows:
        fid = str(finding.get('finding_id') or '')
        if not fid.startswith('SCM-') or fid in seen:
            continue
        seen.add(fid)
        alerts.append(summarize_triage_ops_alert(finding))
    alerts = sort_latest_first(alerts, TRIAGE_FINDING_DATE_FIELDS)
    counts = {
        'alerts': len(alerts),
        'open': sum(1 for item in alerts if str(item.get('status') or '').lower() == 'open'),
        'in_review': sum(1 for item in alerts if str(item.get('status') or '').lower() == 'in_review'),
        'critical': sum(1 for item in alerts if str(item.get('severity') or '').lower() == 'critical'),
        'actionable': sum(1 for item in alerts if (item.get('actionability') or {}).get('bucket') == 'actionable'),
        'actionable_critical': sum(
            1 for item in alerts
            if (item.get('actionability') or {}).get('bucket') == 'actionable'
            and str(item.get('severity') or '').lower() == 'critical'
        ),
        'no_local_impact': sum(1 for item in alerts if (item.get('actionability') or {}).get('bucket') == 'no_local_impact'),
        'review_only': sum(1 for item in alerts if (item.get('actionability') or {}).get('bucket') == 'review_only'),
        'needs_review': sum(1 for item in alerts if item.get('recommendation', {}).get('recommended_disposition') == 'needs_review'),
    }
    return {'ok': True, 'secopsai_root': str(SECOPSAI_ROOT), 'counts': counts, 'alerts': alerts}


def raw_report_for_finding(finding):
    report_path = Path(str(finding.get('report_path') or '')).resolve() if finding.get('report_path') else None
    if not report_path:
        return {'ok': False, 'error': 'Finding has no report_path'}
    allowed_root = (SECOPSAI_ROOT / 'data' / 'supply_chain' / 'reports').resolve()
    if allowed_root not in report_path.parents and report_path != allowed_root:
        return {'ok': False, 'error': 'Report path is outside the allowed supply-chain reports directory'}
    if not report_path.exists() or not report_path.is_file():
        return {'ok': False, 'error': 'Report file not found', 'path': str(report_path)}
    text = report_path.read_text(encoding='utf-8', errors='ignore')
    return {'ok': True, 'path': str(report_path), 'text': text[:12000], 'truncated': len(text) > 12000}


def evidence_item(kind, label, detail='', weight='strong'):
    return {'kind': kind, 'label': label, 'detail': detail, 'weight': weight}


def score_item(label, points, reason):
    return {'label': label, 'points': int(points), 'reason': reason}


def extract_scanner_rules(finding, explanation=None):
    rules = []
    for source in (
        finding.get('matched_rules'),
        finding.get('rules'),
        (explanation or {}).get('matched_rules') if isinstance(explanation, dict) else None,
    ):
        if isinstance(source, list):
            rules.extend(str(item.get('name') if isinstance(item, dict) else item).strip() for item in source)
    analysis = str(finding.get('analysis') or finding.get('summary') or '')
    marker = 'Deterministic rules flagged:'
    if marker in analysis:
        tail = analysis.split(marker, 1)[1]
        rules.extend(item.strip() for item in re.split(r',|\n', tail) if item.strip())
    seen = set()
    compact = []
    for rule in rules:
        rule = re.sub(r'\s+', ' ', rule).strip(' .;')
        if rule and rule.lower() not in seen:
            seen.add(rule.lower())
            compact.append(rule[:140])
    return compact


def parse_report_evidence(report_text, ioc_hints=None):
    text = str(report_text or '')
    lowered = text.lower()
    ioc_hints = [str(item) for item in (ioc_hints or []) if str(item).strip()]
    signals = {
        'install_time_execution': [],
        'import_time_execution': [],
        'outbound_network': [],
        'credential_access': [],
        'obfuscation': [],
        'suspicious_file_writes': [],
        'artifact_divergence': [],
        'known_ioc_matches': [],
        'weak_or_benign': [],
    }
    patterns = {
        'install_time_execution': [
            r'setup\.py', r'pyproject', r'\.pth\b', r'postinstall', r'preinstall',
            r'prepare script', r'lifecycle', r'setup\.mjs', r'build hook',
        ],
        'import_time_execution': [
            r'import-time', r'import time', r'__init__\.py', r'sitecustomize',
            r'\.pth\b', r'python3\s+/tmp', r'exec\s*\(',
        ],
        'outbound_network': [
            r'https?://', r'\bcurl\b', r'\bwget\b', r'requests\.', r'urllib',
            r'httpx', r'fetch\s*\(', r'axios', r'xmlhttprequest',
        ],
        'credential_access': [
            r'token', r'secret', r'credential', r'github_token', r'npm_token',
            r'pypi', r'ssh', r'aws_access_key', r'oidc', r'environment variable',
            r'\benv\b',
        ],
        'obfuscation': [
            r'base64', r'\beval\s*\(', r'\bexec\s*\(', r'marshal', r'zlib',
            r'\batob\b', r'fromcharcode', r'packed payload',
        ],
        'suspicious_file_writes': [
            r'/tmp', r'\$home', r'home directory', r'\.bashrc', r'\.zshrc',
            r'launchagent', r'\bcron\b', r'startup', r'ci path', r'write_text',
        ],
        'artifact_divergence': [
            r'wheel/sdist', r'only in one', r'artifact divergence', r'\bsdist\b',
            r'\bwheel\b',
        ],
        'weak_or_benign': [
            r'generated asset', r'vendored', r'source map', r'normal framework',
            r'generic api client', r'documented product functionality',
        ],
    }
    for key, regexes in patterns.items():
        for pattern in regexes:
            if re.search(pattern, lowered, re.IGNORECASE):
                signals[key].append(pattern.replace('\\b', '').replace('\\', ''))
    for hint in ioc_hints:
        if hint.lower() in lowered:
            signals['known_ioc_matches'].append(hint)
    return {
        'signals': signals,
        'strong_signal_count': sum(
            1
            for key, values in signals.items()
            if key not in {'weak_or_benign'} and values
        ),
    }


def normalize_advisory_references(advisory):
    refs = []
    for match in (advisory or {}).get('matches') or []:
        if not isinstance(match, dict):
            continue
        for url in match.get('source_urls') or []:
            if url and url not in refs:
                refs.append(url)
    return refs


def build_evidence_verdict_payload(finding, advisory, local_usage, report, explanation=None):
    ecosystem = str(finding.get('ecosystem') or '').lower()
    package = str(finding.get('package') or '').strip()
    version = str(finding.get('new_version') or finding.get('version') or '').strip()
    key = (ecosystem, package.lower())
    known_bad_versions = set(KNOWN_COMPROMISED_VERSIONS.get(key, set()))
    known_iocs = KNOWN_IOC_HINTS.get(key, [])
    advisory_matched = bool((advisory or {}).get('matched'))
    known_bad_match = version in known_bad_versions
    local_matches = (local_usage or {}).get('matches') or []
    local_present = bool((local_usage or {}).get('present'))
    exact_local_version = any(bool(item.get('version_match')) for item in local_matches if isinstance(item, dict))
    report_text = str((report or {}).get('text') or '')
    report_ok = bool((report or {}).get('ok'))
    report_evidence = parse_report_evidence(report_text, known_iocs)
    signals = report_evidence['signals']
    scanner_rules = extract_scanner_rules(finding, explanation=explanation)
    weak_rule_words = ('generic', 'heuristic', 'metadata', 'generated', 'vendored')
    weak_only_rules = bool(scanner_rules) and all(
        any(word in rule.lower() for word in weak_rule_words)
        for rule in scanner_rules
    )
    strong_report_signal = report_evidence['strong_signal_count'] > 0

    score = 0
    score_breakdown = []
    true_positive_evidence = []
    false_positive_evidence = []
    missing_evidence = []

    def add(points, label, reason):
        nonlocal score
        score += points
        score_breakdown.append(score_item(label, points, reason))

    if advisory_matched:
        add(35, 'Advisory exact/version match', 'Emergency advisory or denylist matched this package/version.')
        true_positive_evidence.append(evidence_item('advisory', 'Advisory matched', f'{package}@{version} is source-backed in advisory data.'))
    else:
        missing_evidence.append('No advisory or denylist match was found for this exact version.')

    if known_bad_match:
        add(25, 'Known compromised version', f'{package}@{version} is in the local known-compromised version list.')
        true_positive_evidence.append(evidence_item('known_bad', 'Known compromised version', f'{package}@{version} is locally denylisted.'))

    if signals['install_time_execution'] or signals['import_time_execution']:
        add(20, 'Install/import-time execution evidence', 'Raw report includes install-time or import-time execution indicators.')
        true_positive_evidence.append(evidence_item('execution', 'Install/import-time execution', ', '.join((signals['install_time_execution'] + signals['import_time_execution'])[:6])))

    if signals['credential_access']:
        add(15, 'Credential/token access evidence', 'Raw report references credential, token, environment, or CI secret access.')
        true_positive_evidence.append(evidence_item('credential_access', 'Credential or token access', ', '.join(signals['credential_access'][:6])))

    if signals['outbound_network']:
        add(15, 'Outbound network evidence', 'Raw report references outbound HTTP/network behavior in the suspicious path.')
        true_positive_evidence.append(evidence_item('network', 'Outbound network behavior', ', '.join(signals['outbound_network'][:6])))

    if signals['obfuscation']:
        add(15, 'Obfuscation or dynamic execution', 'Raw report references base64/eval/exec/packed-payload behavior.')
        true_positive_evidence.append(evidence_item('obfuscation', 'Obfuscation or dynamic execution', ', '.join(signals['obfuscation'][:6])))

    if signals['suspicious_file_writes']:
        add(10, 'Suspicious file writes/persistence', 'Raw report references /tmp, home, shell profile, startup, or CI-path writes.')
        true_positive_evidence.append(evidence_item('file_write', 'Suspicious file writes', ', '.join(signals['suspicious_file_writes'][:6])))

    if signals['artifact_divergence']:
        add(10, 'Artifact divergence', 'Raw report references wheel/sdist or artifact-only divergence.')
        true_positive_evidence.append(evidence_item('artifact_divergence', 'Wheel/sdist or artifact divergence', ', '.join(signals['artifact_divergence'][:6])))

    if local_present:
        add(10, 'Local dependency reference', f'{package} appears in local dependency manifests.')
        true_positive_evidence.append(evidence_item('local_usage', 'Package appears locally', f'{len(local_matches)} dependency match(es).'))
    else:
        false_positive_evidence.append(evidence_item('local_usage', 'No local dependency reference', 'No manifest or lockfile reference was found in the configured SecOpsAI root.', 'medium'))

    if exact_local_version:
        add(15, 'Exact local version reference', f'{package}@{version} appears in local dependency manifests.')

    if signals['known_ioc_matches']:
        add(10, 'Known IOC match', 'Raw report references known campaign IOCs or filenames.')
        true_positive_evidence.append(evidence_item('ioc', 'Known IOC match', ', '.join(signals['known_ioc_matches'][:10])))

    if known_bad_versions and not known_bad_match and not advisory_matched and not local_present:
        add(-35, 'Outside local known-compromised set', 'This package has known bad versions, but this exact version is not listed and no local usage was found.')
        false_positive_evidence.append(
            evidence_item(
                'known_bad_miss',
                'Exact version is outside local known-compromised set',
                f'Known bad versions: {", ".join(sorted(known_bad_versions))}',
                'strong',
            )
        )

    if weak_only_rules:
        add(-20, 'Weak-only scanner rules', 'Only weak/generic scanner rule names were available.')
        false_positive_evidence.append(evidence_item('scanner', 'Only weak/generic scanner rules observed', ', '.join(scanner_rules[:6]), 'medium'))

    if signals['weak_or_benign'] and not (advisory_matched or known_bad_match or strong_report_signal):
        add(-15, 'Benign/generated-report hints', 'Raw report appears to describe generated assets, vendored code, or normal framework behavior.')
        false_positive_evidence.append(evidence_item('benign_hint', 'Benign/generated report hints', ', '.join(signals['weak_or_benign'][:6]), 'medium'))

    if not advisory_matched and weak_only_rules and not strong_report_signal:
        add(-10, 'Advisory miss with weak evidence', 'No advisory match and scanner evidence appears weak or generic.')

    if not scanner_rules:
        missing_evidence.append('No structured scanner rule list was available.')
    if not report_ok:
        missing_evidence.append(str((report or {}).get('error') or 'Raw report was not available.'))
    if not strong_report_signal:
        missing_evidence.append('No strong install/import/network/credential/IOC behavior was extracted from the raw report.')
    missing_evidence.append('Sandbox status: not_available unless a separate sandbox artifact is attached.')

    score = max(0, min(100, score))
    if exact_local_version:
        environment_impact = 'confirmed_affected'
    elif local_present:
        environment_impact = 'likely_affected'
    elif local_matches:
        environment_impact = 'unknown'
    else:
        environment_impact = 'not_observed'

    if (advisory_matched or known_bad_match) and strong_report_signal:
        package_verdict = 'confirmed_true_positive'
    elif advisory_matched or known_bad_match or score >= 65:
        package_verdict = 'likely_true_positive'
    elif score >= 35:
        package_verdict = 'needs_review'
    elif weak_only_rules and not advisory_matched and not local_present and not strong_report_signal:
        package_verdict = 'likely_false_positive'
    elif score <= 15 and false_positive_evidence and not advisory_matched:
        package_verdict = 'false_positive'
    else:
        package_verdict = 'needs_review'

    if package_verdict in {'confirmed_true_positive', 'likely_true_positive'}:
        confidence = 'high' if advisory_matched or known_bad_match or score >= 75 else 'medium'
        recommended_disposition = 'needs_review' if environment_impact == 'not_observed' else 'true_positive'
    elif package_verdict in {'likely_false_positive', 'false_positive'}:
        confidence = 'medium' if score <= 20 else 'low'
        recommended_disposition = 'false_positive'
    else:
        confidence = 'medium' if score >= 35 else 'low'
        recommended_disposition = 'needs_review'

    if package_verdict in {'confirmed_true_positive', 'likely_true_positive'}:
        note = (
            f'Reviewed {package}@{version}. SecOpsAI found '
            f'{"advisory-backed " if advisory_matched else ""}supply-chain evidence for this exact package version. '
        )
        if environment_impact == 'not_observed':
            note += 'No local dependency reference was found, so local exposure is not currently confirmed. Keep this as actionable ecosystem intelligence, block this version, and rotate credentials only if installation or execution is confirmed.'
        else:
            note += 'Local dependency evidence was found, so treat local exposure as actionable until remediation is confirmed.'
    elif package_verdict in {'likely_false_positive', 'false_positive'}:
        if true_positive_evidence:
            note = (
                f'Reviewed {package}@{version}. SecOpsAI saw generic suspicious report indicators, but no advisory match, '
                'the exact version is outside the local known-compromised set, and no local dependency reference was found. '
                'Review the raw report one final time before closing as false positive.'
            )
        else:
            note = (
                f'Reviewed {package}@{version}. No advisory match, no strong raw-report behavior, and no exact local dependency evidence were found. '
                'Review the raw report one final time before closing as false positive.'
            )
    else:
        note = (
            f'Reviewed {package}@{version}. Evidence is mixed or incomplete. Keep in review until raw report, advisory, local usage, and optional sandbox evidence are reconciled.'
        )

    finding_id = finding.get('finding_id')
    mitigation = mitigation_for_finding(
        finding,
        recommendation={'recommended_disposition': recommended_disposition},
        local_usage=local_usage,
        advisory=advisory,
    )
    operator_commands = [
        f'secopsai triage investigate {finding_id} --json',
        f'secopsai supply-chain explain-verdict --ecosystem {ecosystem} --package {package} --version {version}',
        f'secopsai supply-chain advisory check --ecosystem {ecosystem} --package {package} --version {version}',
        f'rg -n "{re.escape(package)}|{re.escape(version)}" pyproject.toml requirements*.txt poetry.lock uv.lock Pipfile* .',
    ]

    return {
        'package_verdict': package_verdict,
        'environment_impact': environment_impact,
        'confidence': confidence,
        'score': score,
        'score_breakdown': score_breakdown,
        'true_positive_evidence': true_positive_evidence,
        'false_positive_evidence': false_positive_evidence,
        'missing_evidence': missing_evidence,
        'recommended_disposition': recommended_disposition,
        'recommended_note': note,
        'mitigation': mitigation.get('actions') or [],
        'operator_commands': operator_commands,
        'references': normalize_advisory_references(advisory),
        'raw_inputs': {
            'advisory_matched': advisory_matched,
            'known_bad_version_match': known_bad_match,
            'local_dependency_reference': local_present,
            'exact_local_version_reference': exact_local_version,
            'report_path': (report or {}).get('path') or finding.get('report_path'),
            'scanner_rules': scanner_rules,
            'sandbox_status': 'not_available',
        },
    }


def evidence_verdict_for_finding(finding):
    ecosystem = str(finding.get('ecosystem') or '').lower()
    package = str(finding.get('package') or '').strip()
    version = str(finding.get('new_version') or finding.get('version') or '').strip()
    advisory = advisory_check(ecosystem, package, version)
    local_usage = check_local_dependency_usage(package, version)
    report = raw_report_for_finding(finding)
    explanation = None
    try:
        args = ['supply-chain', 'explain-verdict', '--ecosystem', ecosystem, '--package', package, '--version', version]
        if finding.get('report_path'):
            args.extend(['--report', str(finding.get('report_path'))])
        result, parsed = run_cli_json(args, timeout=90)
        if result.get('ok') and isinstance(parsed, dict):
            explanation = parsed
    except Exception:
        explanation = None
    return build_evidence_verdict_payload(finding, advisory, local_usage, report, explanation=explanation)


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
                    'secopsai_campaign_api': True,
                    'secopsai_edge_api': True,
                    'secopsai_intelligence_api': True,
                },
                'blog_ops': {
                    'mode': 'local-helper-cli',
                    'configured': True,
                    'capabilities': {
                        'github_actions': False,
                        'workflow_history': False,
                        'local_cli': True,
                        'deploy': local_blog_deploy_available(),
                    },
                },
                'ai_guard': build_ai_guard(),
            }
            return json_response(self, 200, payload)

        if parsed.path == '/api/secopsai/triage-state':
            try:
                return json_response(self, 200, collect_secopsai_triage_state())
            except Exception as exc:
                return json_response(self, 500, {'ok': False, 'error': str(exc)})

        if parsed.path == '/api/secopsai/intelligence':
            try:
                payload = collect_intelligence_status()
                return json_response(self, 200 if payload.get('ok') else 503, payload)
            except Exception as exc:
                return json_response(self, 500, {'ok': False, 'error': str(exc)})

        if parsed.path == '/api/secopsai/edge-workspace':
            try:
                payload = collect_edge_workspace()
                return json_response(self, 200 if payload.get('ok') else 503, payload)
            except Exception as exc:
                return json_response(self, 500, {'ok': False, 'error': str(exc)})

        if parsed.path == '/api/secopsai/research-cases':
            try:
                qs = urllib.parse.parse_qs(parsed.query or '')
                limit = max(1, min(int((qs.get('limit') or ['100'])[0]), 500))
                args = ['research', 'case', 'list', '--limit', str(limit), *secopsai_db_args()]
                status = _clean_string((qs.get('status') or [''])[0], 40)
                case_type = _clean_string((qs.get('type') or [''])[0], 80)
                if status:
                    args.extend(['--status', status])
                if case_type:
                    args.extend(['--type', case_type])
                result, parsed_result = run_cli_json(args, timeout=60)
                return json_response(
                    self,
                    200 if result['ok'] else 500,
                    {
                        'ok': result['ok'],
                        'cases': (parsed_result or {}).get('cases', []),
                        'cli': compact_cli_result(result),
                    },
                )
            except Exception as exc:
                return json_response(self, 400, {'ok': False, 'error': str(exc)})

        if parsed.path == '/api/secopsai/research-watchlist':
            try:
                result, parsed_result = run_cli_json(['supply-chain', 'campaign-watchlist', 'list'], timeout=60)
                parsed_result = parsed_result if isinstance(parsed_result, dict) else {}
                return json_response(
                    self,
                    200 if result['ok'] else 500,
                    {
                        'ok': result['ok'],
                        'ecosystem': 'npm',
                        'packages': normalize_npm_watchlist_packages(parsed_result.get('packages', [])),
                        'source_urls': parsed_result.get('source_urls', []),
                        'cli': compact_cli_result(result),
                    },
                )
            except Exception as exc:
                return json_response(self, 500, {'ok': False, 'error': str(exc)})

        if parsed.path == '/api/secopsai/research-discovery':
            try:
                qs = urllib.parse.parse_qs(parsed.query or '')
                view = _clean_string((qs.get('view') or ['candidates'])[0], 40).lower()
                action = {
                    'capabilities': 'capabilities',
                    'watchlists': 'watchlist-list',
                    'monitors': 'monitor-list',
                    'candidates': 'candidate-list',
                    'alerts': 'alert-list',
                    'collectors': 'collect-status',
                    'feed-events': 'collect-events',
                    'coverage-windows': 'collect-coverage',
                }.get(view, 'candidate-list')
                payload = {key: value for key, value in [
                    ('ecosystem', _clean_string((qs.get('ecosystem') or [''])[0], 40)),
                    ('collector_id', _clean_string((qs.get('collector_id') or [''])[0], 48)),
                    ('package', _clean_string((qs.get('package') or [''])[0], 512)),
                    ('limit', _clean_string((qs.get('limit') or [''])[0], 8)),
                    ('days', _clean_string((qs.get('days') or [''])[0], 4)),
                ] if value}
                result, parsed_result = run_cli_json([*build_research_discovery_args(action, payload), *secopsai_db_args()], timeout=90)
                return json_response(self, 200 if result['ok'] else 500, {'ok': result['ok'], 'view': view, 'result': parsed_result, 'cli': compact_cli_result(result)})
            except Exception as exc:
                return json_response(self, 400, {'ok': False, 'error': str(exc)})

        if parsed.path.startswith('/api/secopsai/research-cases/'):
            try:
                case_id = urllib.parse.unquote(parsed.path.rsplit('/', 1)[-1]).strip().upper()
                if not RESEARCH_CASE_ID_RE.match(case_id):
                    return json_response(self, 400, {'ok': False, 'error': 'Invalid research case id'})
                result, parsed_result = run_cli_json(
                    ['research', 'case', 'show', case_id, *secopsai_db_args()],
                    timeout=60,
                )
                return json_response(
                    self,
                    200 if result['ok'] else 404,
                    {'ok': result['ok'], 'case': parsed_result, 'cli': compact_cli_result(result)},
                )
            except Exception as exc:
                return json_response(self, 400, {'ok': False, 'error': str(exc)})

        if parsed.path == '/api/blog' or parsed.path == '/api/blog/status':
            try:
                result, payload = _blog_review_drafts_payload()
                return json_response(self, 200 if result['ok'] else 500, payload or {'ok': False, 'error': result.get('stderr') or result.get('stdout') or 'Unable to load Blog Ops'})
            except Exception as exc:
                return json_response(self, 500, {'ok': False, 'error': str(exc)})

        if parsed.path == '/api/blog/drafts':
            try:
                result, payload = _blog_review_drafts_payload()
                drafts = (payload or {}).get('drafts', [])
                return json_response(self, 200 if result['ok'] else 500, {'ok': result['ok'], 'drafts': drafts})
            except Exception as exc:
                return json_response(self, 500, {'ok': False, 'error': str(exc)})

        if parsed.path.startswith('/api/blog/drafts/'):
            try:
                slug = urllib.parse.unquote(parsed.path.replace('/api/blog/drafts/', '', 1)).strip('/')
                if not slug or not re.match(r'^[A-Za-z0-9_.:/-]{1,260}$', slug):
                    return json_response(self, 400, {'ok': False, 'error': 'Invalid draft'})
                result, draft = run_cli_json(['blog', 'news-review', 'show', slug], timeout=90)
                return json_response(self, 200 if result['ok'] else 404, {'ok': result['ok'], 'draft': draft, 'cli': compact_cli_result(result)})
            except Exception as exc:
                return json_response(self, 500, {'ok': False, 'error': str(exc)})

        if parsed.path == '/api/secopsai/triage-ops/alerts':
            try:
                return json_response(self, 200, collect_triage_ops_alerts())
            except Exception as exc:
                return json_response(self, 500, {'ok': False, 'error': str(exc)})

        if parsed.path == '/api/secopsai/triage-ops/campaign-fixtures':
            try:
                return json_response(
                    self,
                    200,
                    {
                        'ok': True,
                        'fixtures': campaign_fixture_payloads(),
                        'ecosystems': sorted(ALLOWED_CAMPAIGN_ECOSYSTEMS),
                    },
                )
            except Exception as exc:
                return json_response(self, 500, {'ok': False, 'error': str(exc)})

        if parsed.path == '/api/secopsai/triage-ops/campaign-candidates':
            try:
                result, parsed_result = run_cli_json(['supply-chain', 'campaign-candidates', 'list'], timeout=60)
                return json_response(
                    self,
                    200 if result['ok'] else 500,
                    {
                        'ok': result['ok'],
                        'candidates': (parsed_result or {}).get('candidates', []),
                        'result': parsed_result,
                        'cli': compact_cli_result(result),
                    },
                )
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

        if parsed.path == '/api/secopsai/intelligence':
            if require_intelligence_admin(self):
                return
            action = str(payload.get('action') or '').strip().lower()
            try:
                args = build_intelligence_args(action, payload)
                result, parsed_result = run_cli_json(args, timeout=360 if action == 'run-once' else 90)
                return json_response(
                    self,
                    200 if result.get('ok') else 400,
                    {
                        'ok': bool(result.get('ok')),
                        'action': action,
                        'result': parsed_result,
                        'cli': compact_cli_result(result),
                    },
                )
            except Exception as exc:
                return json_response(self, 400, {'ok': False, 'error': str(exc)})

        if parsed.path == '/api/secopsai/research-watchlist':
            action = str(payload.get('action') or 'preview').strip().lower()
            if action == 'create' and require_triage_ops_admin(self):
                return
            try:
                args = build_research_watchlist_args(payload)
                result, parsed_result = run_cli_json([*args, *secopsai_db_args()], timeout=120)
                return json_response(
                    self,
                    200 if result['ok'] else 400,
                    {
                        'ok': result['ok'],
                        'action': action,
                        'result': parsed_result,
                        'cli': compact_cli_result(result),
                    },
                )
            except Exception as exc:
                return json_response(self, 400, {'ok': False, 'error': str(exc)})

        if parsed.path == '/api/secopsai/research-discovery':
            if require_triage_ops_admin(self):
                return
            action = _clean_string(payload.get('action'), 40).lower()
            try:
                args = build_research_discovery_args(action, payload)
                result, parsed_result = run_cli_json([*args, *secopsai_db_args()], timeout=180)
                return json_response(self, 200 if result['ok'] else 400, {'ok': result['ok'], 'action': action, 'result': parsed_result, 'cli': compact_cli_result(result)})
            except Exception as exc:
                return json_response(self, 400, {'ok': False, 'error': str(exc)})

        if parsed.path.startswith('/api/secopsai/research-cases/'):
            if require_triage_ops_admin(self):
                return
            action = parsed.path.rsplit('/', 1)[-1]
            try:
                args = build_research_case_args(action, payload)
                timeout = 180 if action in {'export', 'draft-blog'} else 90
                result, parsed_result = run_cli_json([*args, *secopsai_db_args()], timeout=timeout)
                artifact = None
                if action == 'export' and result['ok'] and isinstance(parsed_result, dict):
                    report_root = (SECOPSAI_ROOT / 'reports' / 'research' / 'cases').resolve()
                    report_path = Path(str(parsed_result.get('markdown_report') or '')).expanduser().resolve()
                    if report_path.is_file() and (report_path == report_root or report_root in report_path.parents):
                        content = report_path.read_text(encoding='utf-8', errors='replace')
                        if len(content.encode('utf-8')) > 2_000_000:
                            raise ValueError('Research report exceeds the browser download limit')
                        artifact = {
                            'filename': report_path.name,
                            'content_type': 'text/markdown;charset=utf-8',
                            'content': content,
                        }
                return json_response(
                    self,
                    200 if result['ok'] else 400,
                    {
                        'ok': result['ok'],
                        'action': action,
                        'result': parsed_result,
                        'artifact': artifact,
                        'cli': compact_cli_result(result),
                    },
                )
            except Exception as exc:
                return json_response(self, 400, {'ok': False, 'error': str(exc)})

        if parsed.path == '/api/blog' or parsed.path.startswith('/api/blog/'):
            action = parsed.path.rsplit('/', 1)[-1]
            parts = parsed.path.replace('/api/blog/', '', 1).split('/')
            draft = None
            if parts and parts[0] == 'drafts' and len(parts) >= 3:
                action = parts[-1]
                draft = urllib.parse.unquote('/'.join(parts[1:-1]))
            if action in BLOG_OPS_WRITE_ACTIONS and require_blog_ops_admin(self):
                return
            try:
                if action == 'deploy':
                    result = run_local_blog_deploy(timeout=600)
                    mark_result = None
                    mark_payload = None
                    if result['ok']:
                        mark_result, mark_payload = run_cli_json(['blog', 'news-mark-deployed'], timeout=120)
                    deploy_ok = bool(result['ok'])
                    state_ok = mark_result is None or bool(mark_result.get('ok'))
                    ok = deploy_ok and state_ok
                    error = None
                    hint = None
                    if not deploy_ok:
                        error = 'Cloudflare Pages deploy failed.'
                        hint = 'Review the Wrangler output in cli.stderr/stdout, confirm Cloudflare auth, project name, and account access, then retry Deploy blog.'
                    elif not state_ok:
                        error = 'Cloudflare Pages deploy completed, but Blog Ops could not mark staged drafts as deployed.'
                        hint = 'Update the local SecOpsAI CLI so `secopsai blog news-mark-deployed` is available, then retry Deploy blog to complete the state transition.'
                    return json_response(
                        self,
                        202 if ok else 500,
                        {
                            'ok': ok,
                            'error': error,
                            'hint': hint,
                            'action': action,
                            'workflow': 'wrangler pages deploy',
                            'local_helper': True,
                            'deploy': {
                                'project': local_blog_deploy_project(),
                                'branch': local_blog_deploy_branch(),
                                'source': str((SECOPSAI_ROOT / 'blog').resolve()),
                            },
                            'cli': compact_cli_result(result, limit=20000),
                            'deployed_state': mark_payload,
                            'deployed_state_cli': compact_cli_result(mark_result) if mark_result else None,
                        },
                    )
                args = build_blog_ops_action_args(action, payload=payload, draft=draft)
                timeout = 240 if action in {'news-run', 'publish-approved'} else 120
                result, parsed_result = run_cli_json(args, timeout=timeout)
                status = 202 if result['ok'] else 500
                error = None
                hint = None
                if not result['ok']:
                    error = 'Blog Ops local CLI action failed.'
                    hint = 'Review the CLI output and retry after fixing the reported issue.'
                    if action == 'publish-approved':
                        blocked_error, blocked_hint = publish_approved_blocked_error(parsed_result or {})
                        if blocked_error:
                            status = 409
                            error = blocked_error
                            hint = blocked_hint
                return json_response(
                    self,
                    status,
                    {
                        'ok': result['ok'],
                        'error': error,
                        'hint': hint,
                        'action': action,
                        'workflow': 'secopsai.cli blog',
                        'local_helper': True,
                        'result': parsed_result,
                        'cli': compact_cli_result(result),
                    },
                )
            except Exception as exc:
                status = 501 if 'wrangler is not available' in str(exc).lower() else 400
                return json_response(self, status, {'ok': False, 'error': str(exc)})

        if parsed.path.startswith('/api/secopsai/triage-ops/'):
            action = parsed.path.rsplit('/', 1)[-1]
            if action in ALLOWED_TRIAGE_OPS_WRITE_ACTIONS:
                if require_triage_ops_admin(self):
                    return
            try:
                if action == 'campaign-discover':
                    result, parsed_result = run_cli_json(build_campaign_discover_args(payload), timeout=180)
                    return json_response(
                        self,
                        200 if result['ok'] else 500,
                        {
                            'ok': result['ok'],
                            'action': action,
                            'result': parsed_result,
                            'candidates': (parsed_result or {}).get('candidates', []),
                            'cli': compact_cli_result(result),
                        },
                    )

                if action == 'campaign-autopilot':
                    args, needs_admin = build_campaign_autopilot_args(payload)
                    if needs_admin and require_triage_ops_admin(self):
                        return
                    result, parsed_result = run_cli_json(args, timeout=300 if needs_admin else 220)
                    return json_response(
                        self,
                        200 if result['ok'] else 500,
                        {
                            'ok': result['ok'],
                            'action': action,
                            'result': parsed_result,
                            'candidates': ((parsed_result or {}).get('discovery') or {}).get('candidates', []),
                            'cli': compact_cli_result(result),
                        },
                    )

                if action == 'campaign-promote':
                    candidate_id = _clean_string(payload.get('candidate_id'), 180)
                    if not candidate_id or not CAMPAIGN_ID_RE.match(candidate_id):
                        raise ValueError('Invalid candidate_id')
                    result, parsed_result = run_cli_json(['supply-chain', 'campaign-candidates', 'promote', candidate_id], timeout=60)
                    return json_response(
                        self,
                        200 if result['ok'] else 500,
                        {
                            'ok': result['ok'],
                            'action': action,
                            'result': parsed_result,
                            'campaign': (parsed_result or {}).get('campaign'),
                            'candidate': (parsed_result or {}).get('candidate'),
                            'cli': compact_cli_result(result),
                        },
                    )

                if action == 'campaign-orchestrate':
                    candidate = payload.get('candidate') if isinstance(payload.get('candidate'), dict) else payload
                    result, parsed_result = run_campaign_with_tempfile(
                        candidate,
                        lambda path: ['supply-chain', 'orchestrate-candidate', '--input', str(path)],
                        timeout=90,
                    )
                    return json_response(
                        self,
                        200 if result['ok'] else 500,
                        {
                            'ok': result['ok'],
                            'action': action,
                            'result': parsed_result,
                            'candidate': parsed_result,
                            'orchestrator': (parsed_result or {}).get('orchestrator'),
                            'cli': compact_cli_result(result),
                        },
                    )

                if action == 'campaign-watchlist':
                    result, parsed_result = run_cli_json(build_campaign_watchlist_args(payload), timeout=90)
                    return json_response(
                        self,
                        200 if result['ok'] else 500,
                        {
                            'ok': result['ok'],
                            'action': action,
                            'result': parsed_result,
                            'cli': compact_cli_result(result),
                        },
                    )

                if action == 'research-recommendation':
                    recommendation = build_research_case_recommendation(payload)
                    return json_response(
                        self,
                        200,
                        {
                            'ok': True,
                            'action': action,
                            'recommendation': recommendation,
                        },
                    )

                if action in {'research-campaign', 'campaign-persist-findings'}:
                    campaign = validate_campaign_payload(payload)
                    search_root = validate_campaign_search_root(payload.get('search_root') or '')
                    persist = action == 'campaign-persist-findings'
                    result, parsed_result = run_campaign_with_tempfile(
                        campaign,
                        lambda path: build_campaign_research_args(path, persist=persist, search_root=search_root),
                        timeout=300 if persist else 240,
                    )
                    return json_response(
                        self,
                        200 if result['ok'] else 500,
                        {
                            'ok': result['ok'],
                            'action': action,
                            'campaign_id': campaign.get('campaign_id'),
                            'result': parsed_result,
                            'cli': compact_cli_result(result),
                        },
                    )

                if action == 'campaign-blog-draft':
                    campaign = validate_campaign_payload(payload)
                    result, parsed_result = run_campaign_with_tempfile(
                        campaign,
                        build_campaign_blog_args,
                        timeout=180,
                        json_output=False,
                    )
                    return json_response(
                        self,
                        200 if result['ok'] else 500,
                        {
                            'ok': result['ok'],
                            'action': action,
                            'campaign_id': campaign.get('campaign_id'),
                            'result': parsed_result,
                            'cli': compact_cli_result(result),
                        },
                    )

                if action.startswith('campaign-') or action in CAMPAIGN_TRIAGE_OPS_ACTIONS:
                    return json_response(
                        self,
                        404,
                        {
                            'ok': False,
                            'error': (
                                f'Campaign action not available on this helper: {action}. '
                                'Restart or update the local SecOpsAI dashboard helper, then refresh Triage Ops.'
                            ),
                        },
                    )

                finding_id, ecosystem, package, version = validate_triage_ops_target(payload)
                finding = get_triage_ops_finding(finding_id) if finding_id else None
                if action not in {'refresh-evidence'} and not finding:
                    return json_response(self, 404, {'ok': False, 'error': f'Finding not found or not active: {finding_id}'})
                if finding:
                    ecosystem = ecosystem or str(finding.get('ecosystem') or '').lower()
                    package = package or str(finding.get('package') or '').strip()
                    version = version or str(finding.get('new_version') or finding.get('version') or '').strip()

                if action == 'refresh-evidence':
                    intel_result = run_secopsai_cli(['intel', 'refresh'], timeout=180)
                    summary_result, summary_payload = run_cli_json(
                        ['triage', 'summary', *secopsai_db_args()],
                        timeout=90,
                    )
                    alerts_payload = collect_triage_ops_alerts()
                    return json_response(
                        self,
                        200 if intel_result['ok'] and summary_result['ok'] else 500,
                        {
                            'ok': bool(intel_result['ok'] and summary_result['ok']),
                            'intel': intel_result,
                            'summary': summary_payload,
                            'alerts': alerts_payload,
                        },
                    )

                if action == 'investigate':
                    result, parsed_result = run_cli_json(
                        [
                            'triage',
                            'investigate',
                            finding_id,
                            '--search-root',
                            str(SECOPSAI_ROOT),
                            *secopsai_db_args(),
                            *secopsai_session_args(),
                        ],
                        timeout=180,
                    )
                    return json_response(
                        self,
                        200 if result['ok'] else 500,
                        {'ok': result['ok'], 'finding_id': finding_id, 'result': parsed_result, **result},
                    )

                if action == 'explain-verdict':
                    args = ['supply-chain', 'explain-verdict', '--ecosystem', ecosystem, '--package', package, '--version', version]
                    if finding.get('report_path'):
                        args.extend(['--report', str(finding.get('report_path'))])
                    result, parsed_result = run_cli_json(args, timeout=90)
                    return json_response(
                        self,
                        200 if result['ok'] else 500,
                        {'ok': result['ok'], 'finding_id': finding_id, 'result': parsed_result, **result},
                    )

                if action == 'raw-report':
                    report = raw_report_for_finding(finding)
                    return json_response(self, 200 if report.get('ok') else 404, {'finding_id': finding_id, **report})

                if action == 'check-advisories':
                    advisory = advisory_check(ecosystem, package, version)
                    known = sorted(KNOWN_COMPROMISED_VERSIONS.get((ecosystem, package.lower()), set()))
                    comparison = [
                        advisory_check(ecosystem, package, candidate)
                        for candidate in known
                    ]
                    return json_response(
                        self,
                        200,
                        {
                            'ok': True,
                            'finding_id': finding_id,
                            'advisory': advisory,
                            'known_bad_versions': known,
                            'known_bad_checks': comparison,
                        },
                    )

                if action == 'check-local-usage':
                    usage = check_local_dependency_usage(package, version)
                    return json_response(self, 200, {'ok': True, 'finding_id': finding_id, 'usage': usage})

                if action == 'evidence-verdict':
                    verdict = evidence_verdict_for_finding(finding)
                    return json_response(self, 200, {'ok': True, 'finding_id': finding_id, **verdict})

                if action == 'generate-mitigation':
                    usage = check_local_dependency_usage(package, version)
                    advisory = advisory_check(ecosystem, package, version)
                    recommendation = build_triage_ops_recommendation(finding, advisory=advisory, local_usage=usage)
                    mitigation = mitigation_for_finding(finding, recommendation=recommendation, local_usage=usage, advisory=advisory)
                    return json_response(self, 200, {'ok': True, 'finding_id': finding_id, 'mitigation': mitigation})

                if action == 'close':
                    disposition = str(payload.get('disposition') or 'false_positive').strip()
                    note = ' '.join(str(payload.get('note') or '').split())
                    status = str(payload.get('status') or 'closed').strip() or 'closed'
                    if disposition not in ALLOWED_CLOSE_DISPOSITIONS:
                        return json_response(self, 400, {'ok': False, 'error': 'Invalid or unsupported disposition'})
                    if status not in {'closed', 'triaged'}:
                        return json_response(self, 400, {'ok': False, 'error': 'Invalid status'})
                    if len(note) < 20:
                        return json_response(self, 400, {'ok': False, 'error': 'A source-backed closure note of at least 20 characters is required'})
                    result, parsed_result = run_cli_json(
                        [
                            'triage',
                            'close',
                            finding_id,
                            '--disposition',
                            disposition,
                            '--status',
                            status,
                            '--note',
                            note,
                            *secopsai_db_args(),
                            *secopsai_session_args(),
                        ],
                        timeout=180,
                    )
                    return json_response(
                        self,
                        200 if result['ok'] else 500,
                        {'ok': result['ok'], 'finding_id': finding_id, 'result': parsed_result, **result},
                    )

                if action == 'escalate':
                    note = ' '.join(str(payload.get('note') or 'Escalated from Triage Ops dashboard for analyst review.').split())
                    result, parsed_result = run_cli_json(
                        ['triage', 'start', finding_id, '--note', note, *secopsai_db_args()],
                        timeout=90,
                    )
                    return json_response(
                        self,
                        200 if result['ok'] else 500,
                        {'ok': result['ok'], 'finding_id': finding_id, 'result': parsed_result, **result},
                    )

                if action == 'create-blog-draft':
                    result, parsed_result = run_cli_json(
                        ['blog', 'draft-finding', finding_id, *secopsai_db_args()],
                        timeout=120,
                    )
                    return json_response(
                        self,
                        200 if result['ok'] else 500,
                        {'ok': result['ok'], 'finding_id': finding_id, 'result': parsed_result, **result},
                    )

                return json_response(self, 404, {'ok': False, 'error': 'Unsupported Triage Ops action'})
            except Exception as exc:
                return json_response(self, 500, {'ok': False, 'error': str(exc)})

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
    server = ThreadingHTTPServer((host, port), DashboardHandler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\nSecOpsAI dashboard stopped.')
    finally:
        server.server_close()
