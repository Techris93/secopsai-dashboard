#!/usr/bin/env python3
import json
import os
import shlex
import shutil
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


def utc_now():
    return datetime.now(timezone.utc).isoformat()


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
    return {'last_seen': {}, 'processed': {}, 'reply_map': {}}


def save_state(state):
    STATE_PATH.write_text(json.dumps(state, indent=2), encoding='utf-8')


def prune_state(state, max_per_channel=200):
    for ch, items in list(state.get('processed', {}).items()):
        if len(items) > max_per_channel:
            keys = sorted(items.keys(), key=lambda k: int(k))[-max_per_channel:]
            state['processed'][ch] = {k: items[k] for k in keys}
    for ch, items in list(state.get('reply_map', {}).items()):
        if len(items) > max_per_channel:
            keys = sorted(items.keys(), key=lambda k: int(k))[-max_per_channel:]
            state['reply_map'][ch] = {k: items[k] for k in keys}


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


def get_channel_routes(anon_key, watch_set=None):
    rows = supabase_request('GET', 'channel_routes', anon_key, query='select=*&active=eq.true')
    out = {}
    for row in rows:
        cid = row['channel_id']
        if watch_set and cid not in watch_set:
            continue
        out[cid] = row
    return out


def post_event(anon_key, payload):
    rows = supabase_request('POST', 'dashboard_events', anon_key, payload=payload)
    return rows[0] if rows else None


def post_run(anon_key, payload):
    rows = supabase_request('POST', 'agent_runs', anon_key, payload=payload)
    return rows[0] if rows else None


def patch_run(anon_key, run_id, payload):
    q = f'id=eq.{run_id}&select=*'
    rows = supabase_request('PATCH', 'agent_runs', anon_key, payload=payload, query=q)
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


def resolve_executor(env):
    executor = (env.get('DISCORD_DISPATCHER_EXECUTOR') or 'codex').strip().lower()
    if executor != 'codex':
        return {'ok': False, 'executor': executor, 'reason': f'Unsupported dispatcher executor: {executor}. Only codex is allowed.'}

    command_template = (env.get('DISCORD_DISPATCHER_CODEX_COMMAND') or '').strip()
    if not command_template:
        codex_bin = shutil.which('codex')
        return {
            'ok': False,
            'executor': 'codex',
            'reason': 'Codex-only mode is enabled, but DISCORD_DISPATCHER_CODEX_COMMAND is not configured.',
            'details': f'codex binary detected at {codex_bin}' if codex_bin else 'codex binary is not installed on PATH'
        }

    return {'ok': True, 'executor': 'codex', 'command_template': command_template}


def run_codex(prompt_text, prompt_path, executor_config):
    command_template = executor_config['command_template']
    command = command_template.replace('{prompt_file}', shlex.quote(str(prompt_path))).replace('{prompt}', shlex.quote(prompt_text))
    result = subprocess.run(command, cwd=str(WORKSPACE), capture_output=True, text=True, timeout=1800, shell=True)
    return {'ok': result.returncode == 0, 'stdout': result.stdout.strip(), 'stderr': result.stderr.strip(), 'returncode': result.returncode, 'command': command}


def summarize_output(text, max_chars=1400):
    text = (text or '').strip()
    return text if len(text) <= max_chars else text[:max_chars] + '\n…'


def upsert_status_message(token, channel_id, state, source_msg_id, content):
    reply_map = state.setdefault('reply_map', {}).setdefault(channel_id, {})
    existing = reply_map.get(source_msg_id)
    if existing:
        discord_request('PATCH', f'/channels/{channel_id}/messages/{existing}', token, {'content': content[:1900]})
        return existing
    msg = discord_request('POST', f'/channels/{channel_id}/messages', token, {'content': content[:1900]})
    reply_map[source_msg_id] = msg['id']
    return msg['id']


def should_process_message(msg, state):
    if msg.get('author', {}).get('bot'):
        return False
    if not (msg.get('content') or '').strip():
        return False
    channel_id = msg['channel_id']
    processed = state.setdefault('processed', {}).setdefault(channel_id, {})
    if msg['id'] in processed:
        return False
    return True


def fail_request(msg, route, token, anon_key, state, run_id, status_msg_id, error_message, detail=None):
    channel_id = msg['channel_id']
    role_label = route['default_role_label']
    processed = state.setdefault('processed', {}).setdefault(channel_id, {})
    summary = summarize_output(detail or error_message)
    if run_id:
        patch_run(anon_key, run_id, {
            'status': 'failed',
            'output_summary': summary,
            'completed_at': utc_now(),
        })
    post_event(anon_key, {
        'event_type': 'discord_request_failed',
        'title': f'Discord request failed: {role_label}',
        'body': summary[:500],
        'severity': 'error',
        'related_run_id': run_id,
    })
    upsert_status_message(token, channel_id, state, msg['id'], f'Failed `{role_label}` request.\n\n{summary}')
    processed[msg['id']] = {'status': 'failed', 'run_id': run_id, 'completed_at': utc_now(), 'status_message_id': status_msg_id, 'error': summary}
    state.setdefault('last_seen', {})[channel_id] = msg['id']
    prune_state(state)
    save_state(state)


def process_message(msg, route, token, anon_key, state, executor_config):
    channel_id = msg['channel_id']
    role_label = route['default_role_label']
    content = (msg.get('content') or '').strip()
    processed = state.setdefault('processed', {}).setdefault(channel_id, {})
    if msg['id'] in processed:
        return

    queued_run = post_run(anon_key, {
        'role_label': role_label,
        'runtime': 'discord-dispatcher',
        'model_used': 'codex',
        'task_summary': f'Discord request: {content[:120]}',
        'task_detail': content,
        'status': 'queued',
        'source_surface': 'discord',
        'source_channel_id': channel_id,
        'initiated_by': msg['author'].get('username') or 'discord-user',
        'started_at': utc_now(),
    })
    run_id = queued_run.get('id') if queued_run else None

    post_event(anon_key, {
        'event_type': 'discord_request_received',
        'title': f'Discord request queued: {role_label}',
        'body': content[:500],
        'severity': 'info',
        'related_run_id': run_id,
    })

    status_msg = upsert_status_message(token, channel_id, state, msg['id'], f'Queued `{role_label}` request. Preparing prompt…')
    save_state(state)

    try:
        prompt = render_prompt(role_label, content)
        prompt_path = write_prompt_file(role_label, msg['id'], prompt)
    except Exception as exc:
        fail_request(msg, route, token, anon_key, state, run_id, status_msg, 'Prompt preparation failed.', str(exc))
        return

    if not executor_config.get('ok'):
        detail = executor_config.get('reason', 'Codex executor is not ready.')
        if executor_config.get('details'):
            detail += f" {executor_config['details']}"
        if run_id:
            patch_run(anon_key, run_id, {'output_path': str(prompt_path)})
        fail_request(msg, route, token, anon_key, state, run_id, status_msg, 'Codex executor is not configured.', detail)
        return

    if run_id:
        patch_run(anon_key, run_id, {'status': 'running', 'output_path': str(prompt_path)})
    post_event(anon_key, {
        'event_type': 'discord_request_running',
        'title': f'Discord request running: {role_label}',
        'body': content[:500],
        'severity': 'info',
        'related_run_id': run_id,
    })
    upsert_status_message(token, channel_id, state, msg['id'], f'Running `{role_label}` via ACP fallback + Codex.\nPrompt saved: `{prompt_path.relative_to(WORKSPACE)}`')
    save_state(state)

    try:
        run_result = run_codex(prompt, prompt_path, executor_config)
    except Exception as exc:
        fail_request(msg, route, token, anon_key, state, run_id, status_msg, 'Codex execution crashed before completion.', str(exc))
        return

    status = 'completed' if run_result['ok'] else 'failed'
    output_text = run_result['stdout'] or run_result['stderr'] or 'No output.'
    output_summary = summarize_output(output_text)
    if not run_result['ok'] and run_result.get('command'):
        output_summary = summarize_output(f"Command: {run_result['command']}\n\n{output_text}")
    output_path = prompt_path.with_suffix('.out.md')
    output_path.write_text(output_text, encoding='utf-8')

    if run_id:
        patch_run(anon_key, run_id, {
            'status': status,
            'output_path': str(output_path),
            'output_summary': output_summary,
            'completed_at': utc_now(),
        })
    else:
        post_run(anon_key, {
            'role_label': role_label,
            'runtime': 'discord-dispatcher',
            'model_used': 'codex',
            'task_summary': f'Discord run result: {content[:120]}',
            'task_detail': content,
            'status': status,
            'source_surface': 'discord',
            'source_channel_id': channel_id,
            'initiated_by': msg['author'].get('username') or 'discord-user',
            'output_path': str(output_path),
            'output_summary': output_summary,
            'started_at': utc_now(),
            'completed_at': utc_now(),
        })

    post_event(anon_key, {
        'event_type': 'discord_request_completed' if run_result['ok'] else 'discord_request_failed',
        'title': f'Discord request {status}: {role_label}',
        'body': output_summary[:500],
        'severity': 'success' if run_result['ok'] else 'error',
        'related_run_id': run_id,
    })

    final = f'{"Completed" if run_result["ok"] else "Failed"} `{role_label}` request.\n\n{output_summary}'
    upsert_status_message(token, channel_id, state, msg['id'], final)
    processed[msg['id']] = {'status': status, 'run_id': run_id, 'completed_at': utc_now(), 'status_message_id': status_msg}
    state.setdefault('last_seen', {})[channel_id] = msg['id']
    prune_state(state)
    save_state(state)


def main():
    env = load_env(ENV_PATH)
    token = env_required(env, 'DISCORD_BOT_TOKEN')
    anon_key = env_required(env, 'SUPABASE_ANON_KEY')
    executor_config = resolve_executor(env)
    poll_seconds = float(env.get('DISCORD_DISPATCHER_POLL_SECONDS', '5'))
    watch_raw = env.get('DISCORD_DISPATCHER_CHANNELS', '').strip()
    watch_set = {c.strip() for c in watch_raw.split(',') if c.strip()} or None

    state = load_state()
    routes = get_channel_routes(anon_key, watch_set)
    if not routes:
        raise SystemExit('No active watched channel_routes found in Supabase.')

    print(f'Discord dispatcher watching {len(routes)} routed channels...')
    if executor_config.get('ok'):
        print('Dispatcher executor: codex')
    else:
        print(f"Dispatcher executor unavailable: {executor_config.get('reason')}")
        if executor_config.get('details'):
            print(executor_config['details'])
    while True:
        try:
            routes = get_channel_routes(anon_key, watch_set)
            for channel_id, route in routes.items():
                msgs = discord_request('GET', f'/channels/{channel_id}/messages', token, query={'limit': 20}) or []
                msgs.sort(key=lambda m: int(m['id']))
                last_seen = int(state.get('last_seen', {}).get(channel_id, '0'))
                for msg in msgs:
                    msg_id = int(msg['id'])
                    if msg_id <= last_seen and not should_process_message(msg, state):
                        continue
                    if not should_process_message(msg, state):
                        state.setdefault('last_seen', {})[channel_id] = msg['id']
                        continue
                    process_message(msg, route, token, anon_key, state, executor_config)
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
