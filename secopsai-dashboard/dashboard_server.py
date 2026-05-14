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
ALLOWED_TRIAGE_OPS_WRITE_ACTIONS = {'close', 'escalate', 'create-blog-draft'}
ECOSYSTEM_RE = re.compile(r'^(pypi|npm)$', re.IGNORECASE)
PACKAGE_RE = re.compile(r'^[A-Za-z0-9@._/-]{1,220}$')
VERSION_RE = re.compile(r'^[A-Za-z0-9.+:_~!*-]{1,160}$')
KNOWN_COMPROMISED_VERSIONS = {
    ('pypi', 'litellm'): {'1.82.7', '1.82.8'},
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


def run_cli_json(args, timeout=120):
    result = run_secopsai_cli([*args, '--json'], timeout=timeout)
    parsed = parse_cli_json(result)
    return result, parsed


def triage_findings_by_status(status, limit=100):
    result, parsed = run_cli_json(
        ['triage', 'list', '--status', status, '--category', 'supply_chain', '--limit', str(limit), *secopsai_db_args()],
        timeout=60,
    )
    if not result.get('ok') or not isinstance(parsed, dict):
        return []
    rows = parsed.get('findings') or []
    return rows if isinstance(rows, list) else []


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
        try:
            lines = path.read_text(encoding='utf-8', errors='ignore').splitlines()
        except Exception:
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
        disposition = 'expected_behavior'
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
    counts = {
        'alerts': len(alerts),
        'open': sum(1 for item in alerts if str(item.get('status') or '').lower() == 'open'),
        'in_review': sum(1 for item in alerts if str(item.get('status') or '').lower() == 'in_review'),
        'critical': sum(1 for item in alerts if str(item.get('severity') or '').lower() == 'critical'),
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

        if parsed.path == '/api/secopsai/triage-ops/alerts':
            try:
                return json_response(self, 200, collect_triage_ops_alerts())
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

        if parsed.path.startswith('/api/secopsai/triage-ops/'):
            action = parsed.path.rsplit('/', 1)[-1]
            if action in ALLOWED_TRIAGE_OPS_WRITE_ACTIONS:
                if require_triage_ops_admin(self):
                    return
            try:
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
    ThreadingHTTPServer((host, port), DashboardHandler).serve_forever()
