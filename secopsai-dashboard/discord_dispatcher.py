#!/usr/bin/env python3
import json
import os
import subprocess
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

WORKSPACE = Path('/Users/chrixchange/.openclaw/workspace')
DASH_DIR = WORKSPACE / 'secopsai-dashboard'
ENV_PATH = DASH_DIR / '.env'
STATE_PATH = DASH_DIR / '.discord-dispatcher-state.json'
INBOX_DIR = WORKSPACE / 'secopsai-org' / 'acp-fallback' / 'inbox'
RUNS_DIR = INBOX_DIR / 'runs'

SUPABASE_TABLES = ['channel_routes', 'agent_runs', 'dashboard_events']


def load_env(path: Path):
    env = {}
    if path.exists():
        for line in path.read_text(encoding='utf-8').splitlines():
            line = line.strip()
            if not line or line.startswith('#') or '=' not in line:
                continue
            key, value = line.split('=', 1)
            env[key.strip()] = value.strip()
    return env


def env_required(env, name):
    value = env.get(name) or os.environ.get(name)
    if not value:
        raise SystemExit(f'Missing required env var: {name}')
    return value


def load_state():
    if STATE_PATH.exists():
        return json.loads(STATE_PATH.read_text(encoding='utf-8'))
    return {'last_seen': {}}


def save_state(state):
    STATE_PATH.write_text(json.dumps(state, indent=2), encoding='utf-8')


def discord_request(method, path, token, payload=None, query=None):
    base = 'https://discord.com/api/v10'
    url = f'{base}{path}'
    if query:
        url += '?' + urllib.parse.urlencode(query)
    data = None if payload is None else json.dumps(payload).encode('utf-8')
    req = urllib.request.Request(
        url,
        data=data,
        method=method,
        headers={
            'Authorization': f'Bot {token}',
            'Content-Type': 'application/json',
            'User-Agent': 'SecOpsAI-Discord-Dispatcher/1.0'
        }
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        body = resp.read().decode('utf-8')
    return json.loads(body) if body else None


def supabase_request(method, table, anon_key, payload=None, query='select=*'):
    env = load_env(ENV_PATH)
    base_url = env_required(env, 'SUPABASE_URL') + f'/rest/v1/{table}'
    url = f'{base_url}?{query}' if query else base_url
    data = None if payload is None else json.dumps(payload).encode('utf-8')
    req = urllib.request.Request(
        url,
        data=data,
        method=method,
        headers={
            'apikey': anon_key,
            'Authorization': f'Bearer {anon_key}',
            'Content-Type': 'application/json',
            'Prefer': 'return=representation'
        }
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        body = resp.read().decode('utf-8')
    return json.loads(body) if body else []


def get_channel_routes(anon_key):
    rows = supabase_request('GET', 'channel_routes', anon_key, query='select=*&active=eq.true')
    return {row['channel_id']: row for row in rows}


def post_event(anon_key, payload):
    rows = supabase_request('POST', 'dashboard_events', anon_key, payload=payload)
    return rows[0] if rows else None


def post_run(anon_key, payload):
    rows = supabase_request('POST', 'agent_runs', anon_key, payload=payload)
    return rows[0] if rows else None


def write_prompt_file(role_label, message_id, content):
    RUNS_DIR.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    path = RUNS_DIR / f'{stamp}__{role_label.replace("/", "__")}__{message_id}.md'
    path.write_text(content, encoding='utf-8')
    return path


def render_prompt(role_label, task_text):
    cmd = [str(WORKSPACE / 'secopsai-org' / 'acp-fallback' / 'launch-role.sh'), role_label, task_text]
    result = subprocess.run(cmd, cwd=str(WORKSPACE), capture_output=True, text=True, check=True)
    return result.stdout


def run_claude(prompt_text):
    cmd = [
        'claude', '--print', '--permission-mode', 'bypassPermissions',
        '--output-format', 'text', prompt_text
    ]
    result = subprocess.run(cmd, cwd=str(WORKSPACE), capture_output=True, text=True, timeout=1800)
    return {
        'ok': result.returncode == 0,
        'stdout': result.stdout.strip(),
        'stderr': result.stderr.strip(),
        'returncode': result.returncode,
    }


def summarize_output(text, max_chars=1200):
    text = (text or '').strip()
    return text if len(text) <= max_chars else text[:max_chars] + '\n…'


def process_message(msg, route, token, anon_key):
    channel_id = msg['channel_id']
    role_label = route['default_role_label']
    content = (msg.get('content') or '').strip()
    if not content:
        return

    queued_run = post_run(anon_key, {
        'role_label': role_label,
        'runtime': 'discord-dispatcher',
        'model_used': 'claude-cli',
        'task_summary': f'Discord request: {content[:120]}',
        'task_detail': content,
        'status': 'queued',
        'source_surface': 'discord',
        'source_channel_id': channel_id,
        'initiated_by': msg['author'].get('username') or 'discord-user',
        'started_at': datetime.now(timezone.utc).isoformat(),
    })

    post_event(anon_key, {
        'event_type': 'discord_request_received',
        'title': f'Discord request queued: {role_label}',
        'body': content[:500],
        'severity': 'info',
        'related_run_id': queued_run.get('id') if queued_run else None,
    })

    prompt = render_prompt(role_label, content)
    prompt_path = write_prompt_file(role_label, msg['id'], prompt)

    discord_request('POST', f'/channels/{channel_id}/messages', token, {
        'content': f'Queued for `{role_label}`. Running now via ACP fallback. Prompt saved: `{prompt_path.relative_to(WORKSPACE)}`'
    })

    run_result = run_claude(prompt)
    status = 'completed' if run_result['ok'] else 'failed'
    output_text = run_result['stdout'] or run_result['stderr'] or 'No output.'
    output_summary = summarize_output(output_text)
    output_path = prompt_path.with_suffix('.out.md')
    output_path.write_text(output_text, encoding='utf-8')

    post_run(anon_key, {
        'role_label': role_label,
        'runtime': 'discord-dispatcher',
        'model_used': 'claude-cli',
        'task_summary': f'Discord run result: {content[:120]}',
        'task_detail': content,
        'status': status,
        'source_surface': 'discord',
        'source_channel_id': channel_id,
        'initiated_by': msg['author'].get('username') or 'discord-user',
        'output_path': str(output_path),
        'output_summary': output_summary,
        'started_at': datetime.now(timezone.utc).isoformat(),
        'completed_at': datetime.now(timezone.utc).isoformat(),
    })

    post_event(anon_key, {
        'event_type': 'discord_request_completed' if run_result['ok'] else 'discord_request_failed',
        'title': f'Discord request {status}: {role_label}',
        'body': output_summary[:500],
        'severity': 'success' if run_result['ok'] else 'error',
    })

    reply = f'Finished `{role_label}` request.\n\n{output_summary}'
    discord_request('POST', f'/channels/{channel_id}/messages', token, {
        'content': reply[:1900]
    })


def main():
    env = load_env(ENV_PATH)
    token = env_required(env, 'DISCORD_BOT_TOKEN')
    anon_key = env_required(env, 'SUPABASE_ANON_KEY')
    poll_seconds = float(env.get('DISCORD_DISPATCHER_POLL_SECONDS', '5'))

    state = load_state()
    routes = get_channel_routes(anon_key)
    if not routes:
        raise SystemExit('No active channel_routes found in Supabase.')

    print(f'Discord dispatcher watching {len(routes)} routed channels...')
    while True:
        try:
            routes = get_channel_routes(anon_key)
            for channel_id, route in routes.items():
                msgs = discord_request('GET', f'/channels/{channel_id}/messages', token, query={'limit': 10}) or []
                msgs = [m for m in msgs if not m.get('author', {}).get('bot')]
                msgs.sort(key=lambda m: int(m['id']))
                last_seen = int(state['last_seen'].get(channel_id, '0'))
                for msg in msgs:
                    msg_id = int(msg['id'])
                    if msg_id <= last_seen:
                        continue
                    process_message(msg, route, token, anon_key)
                    state['last_seen'][channel_id] = str(msg_id)
                    save_state(state)
            time.sleep(poll_seconds)
        except KeyboardInterrupt:
            print('Stopping dispatcher.')
            return
        except Exception as exc:
            print(f'dispatcher error: {exc}', file=sys.stderr)
            time.sleep(max(poll_seconds, 5))


if __name__ == '__main__':
    main()
