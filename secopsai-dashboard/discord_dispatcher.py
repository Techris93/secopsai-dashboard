#!/usr/bin/env python3
import json
import os
import re
import shlex
import shutil
import subprocess
import sys
import time
import uuid
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

WORKSPACE = Path('/Users/chrixchange/.openclaw/workspace')
DASH_DIR = WORKSPACE / 'secopsai-dashboard'
ENV_PATH = DASH_DIR / '.env'
STATE_PATH = DASH_DIR / '.discord-dispatcher-state.json'
ACP_FALLBACK_DIR = WORKSPACE / 'secopsai-org' / 'acp-fallback'
PROMPTS_DIR = ACP_FALLBACK_DIR / 'prompts'
INBOX_DIR = ACP_FALLBACK_DIR / 'inbox'
RUNS_DIR = INBOX_DIR / 'runs'
SELFTEST_MARKER = '[SELFTEST]'


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


def get_run_requests(anon_key, limit=10):
    # Note: requires public.run_requests table (see supabase_migrations/2026-03-23_run_requests.sql)
    query = f"select=*&status=eq.queued&order=created_at.asc&limit={int(limit)}"
    return supabase_request('GET', 'run_requests', anon_key, query=query)


def patch_run_request(anon_key, request_id, payload, extra_query=''):
    q = f'id=eq.{request_id}'
    if extra_query:
        q += f'&{extra_query}'
    q += '&select=*'
    rows = supabase_request('PATCH', 'run_requests', anon_key, payload=payload, query=q)
    return rows[0] if rows else None


def claim_run_request(anon_key, request_id, worker_id):
    payload = {
        'status': 'running',
        'error': None,
    }
    return patch_run_request(anon_key, request_id, payload, extra_query='status=eq.queued')


def post_run_request(anon_key, payload):
    rows = supabase_request('POST', 'run_requests', anon_key, payload=payload)
    return rows[0] if rows else None


def discord_send_message(channel_id, token, content):
    return discord_request('POST', f'/channels/{channel_id}/messages', token, payload={
        'content': content
    })


def find_channel_id_by_name(routes, name):
    for cid, route in routes.items():
        if route.get('channel_name') == name:
            return cid
    return None


def parse_command(content):
    # /orchestrate <task...>
    # /run <role_label> <task...>
    c = (content or '').strip()
    if not c.startswith('/'):
        return None
    parts = c.split(' ', 2)
    cmd = parts[0].lower()
    if cmd == '/orchestrate' and len(parts) >= 2:
        task = c[len('/orchestrate'):].strip()
        return {'type': 'orchestrate', 'role_label': 'exec/agents-orchestrator', 'task_text': task}
    if cmd == '/run' and len(parts) >= 3:
        role = parts[1].strip()
        task = parts[2].strip()
        return {'type': 'run', 'role_label': role, 'task_text': task}
    return None


def build_role_aliases(routes):
    aliases = {}
    for route in routes.values():
        role = route['default_role_label']
        dept, name = role.split('/', 1)
        forms = {
            role.lower(),
            name.lower(),
            name.replace('-', ' ').lower(),
            f'{dept}/{name}'.lower(),
            f'{dept} {name}'.replace('-', ' ').lower(),
            route.get('channel_name', '').replace('-', ' ').lower(),
            route.get('channel_name', '').lower(),
        }
        for form in forms:
            if form:
                aliases[form] = role
    return aliases


def extract_role_override(content, aliases):
    content = (content or '').strip()
    patterns = [
        r'^ask\s+([a-z0-9\-/ ]+?)\s+to\s*[:,-]?\s*(.+)$',
        r'^route\s+to\s+([a-z0-9\-/ ]+?)\s*[:,-]?\s*(.+)$',
        r'^@?([a-z0-9\-/]+)\s*[:,-]\s*(.+)$',
    ]
    for pattern in patterns:
        m = re.match(pattern, content, re.IGNORECASE | re.DOTALL)
        if not m:
            continue
        alias = re.sub(r'\s+', ' ', m.group(1).strip().lower())
        task = m.group(2).strip()
        role = aliases.get(alias)
        if not role:
            role = aliases.get(alias.replace('-', ' ')) or aliases.get(alias.replace(' ', '-'))
        if role and task:
            return {'role_label': role, 'task_text': task, 'alias': alias, 'mode': 'override'}
    return None


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


def prompt_template_path(role_label):
    return PROMPTS_DIR / f'{role_label.replace("/", "__")}.md'


def render_prompt_from_template(role_label, task_text):
    template_path = prompt_template_path(role_label)
    if not template_path.exists():
        raise FileNotFoundError(f'Unknown role: {role_label}. Expected prompt file: {template_path}')
    template = template_path.read_text(encoding='utf-8')
    return template.replace('{{TASK}}', task_text)


def trim_text_block(text, max_chars, label):
    text = (text or '').strip()
    if max_chars <= 0 or len(text) <= max_chars:
        return text
    suffix = f'\n\n[{label} truncated to fit dispatcher prompt budget.]'
    return text[: max_chars - len(suffix)].rstrip() + suffix


def render_prompt(role_label, task_text, executor_config=None):
    executor = (executor_config or {}).get('executor', 'openclaw')
    if executor == 'openclaw':
        return render_prompt_from_template(role_label, task_text)

    cmd = [str(ACP_FALLBACK_DIR / 'launch-role.sh'), role_label, task_text]
    result = subprocess.run(cmd, cwd=str(WORKSPACE), capture_output=True, text=True, check=True)
    return result.stdout


def build_bounded_prompt(role_label, task_body, channel_context, role_memory, executor_config=None, env=None):
    env = env or {}
    task_limit = int(env.get('DISCORD_DISPATCHER_TASK_MAX_CHARS', '12000'))
    context_limit = int(env.get('DISCORD_DISPATCHER_CONTEXT_MAX_CHARS', '2500'))
    memory_limit = int(env.get('DISCORD_DISPATCHER_MEMORY_MAX_CHARS', '2500'))
    prompt_limit = int(env.get('DISCORD_DISPATCHER_PROMPT_MAX_CHARS', '18000'))

    bounded_task = trim_text_block(task_body, task_limit, 'task')
    bounded_context = trim_text_block(channel_context, context_limit, 'channel context')
    bounded_memory = trim_text_block(role_memory, memory_limit, 'role memory')

    variants = [
        (bounded_context, bounded_memory),
        (bounded_context, ''),
        ('', ''),
    ]

    prompt = None
    final_task = None
    for ctx, mem in variants:
        final_task = build_task_text(bounded_task, role_label, ctx, mem)
        prompt = render_prompt(role_label, final_task, executor_config)
        if len(prompt) <= prompt_limit:
            return prompt, final_task, {
                'task_truncated': bounded_task != (task_body or '').strip(),
                'context_truncated': ctx != (channel_context or '').strip(),
                'memory_truncated': mem != (role_memory or '').strip(),
                'prompt_truncated': False,
                'prompt_chars': len(prompt),
            }

    prompt = trim_text_block(prompt or '', prompt_limit, 'rendered prompt')
    return prompt, final_task, {
        'task_truncated': bounded_task != (task_body or '').strip(),
        'context_truncated': True if channel_context else False,
        'memory_truncated': True if role_memory else False,
        'prompt_truncated': True,
        'prompt_chars': len(prompt),
    }


def resolve_executor(env):
    executor = (env.get('DISCORD_DISPATCHER_EXECUTOR') or 'openclaw').strip().lower()

    if executor == 'codex':
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

    if executor == 'claude':
        command_template = (env.get('DISCORD_DISPATCHER_CLAUDE_COMMAND') or '').strip()
        if not command_template:
            claude_bin = shutil.which('claude')
            if claude_bin:
                command_template = 'claude --print --permission-mode bypassPermissions {prompt_file}'
            else:
                return {
                    'ok': False,
                    'executor': 'claude',
                    'reason': 'Claude mode is enabled, but claude is not installed on PATH.',
                }
        return {'ok': True, 'executor': 'claude', 'command_template': command_template}

    if executor == 'openclaw':
        if not shutil.which('openclaw'):
            return {'ok': False, 'executor': 'openclaw', 'reason': 'openclaw CLI is not installed on PATH.'}
        return {'ok': True, 'executor': 'openclaw'}

    return {'ok': False, 'executor': executor, 'reason': f'Unsupported dispatcher executor: {executor}. Supported: openclaw, codex, claude.'}


def parse_openclaw_json(stdout):
    stdout = (stdout or '').strip()
    if not stdout:
        return None
    for line in reversed(stdout.splitlines()):
        line = line.strip()
        if not line or not line.startswith('{'):
            continue
        try:
            return json.loads(line)
        except Exception:
            continue
    return None


def summarize_run_result(run_result, max_chars=1400):
    text = (run_result.get('stdout') or run_result.get('stderr') or 'No output.').strip()
    cleaned = re.sub(r'\x1b\[[0-9;]*m', ' ', text)
    cleaned = re.sub(r'\n{3,}', '\n\n', cleaned).strip()
    lines = [line.strip() for line in cleaned.splitlines() if line.strip()]
    headline = ''
    for line in lines:
        if line.startswith('{') or line.startswith('['):
            continue
        if re.match(r'^(executor|returncode|aborted|partial|timed_out|prompt_chars|ok|command)\b', line, re.I):
            continue
        headline = line
        break
    if not headline:
        headline = cleaned[:240] if cleaned else 'No output.'
    meta = {
        'executor': run_result.get('executor'),
        'returncode': run_result.get('returncode'),
        'aborted': bool(run_result.get('aborted')),
        'partial': bool(run_result.get('partial')),
        'timed_out': bool(run_result.get('timed_out')),
    }
    if run_result.get('prompt_chars') is not None:
        meta['prompt_chars'] = run_result.get('prompt_chars')
    summary = {
        'summary': headline[:240],
        'excerpt': cleaned[:max_chars],
        'result': {
            'ok': bool(run_result.get('ok')),
            'summary': headline[:240],
            'meta': meta,
        }
    }
    return json.dumps(summary, ensure_ascii=False)


def run_executor(prompt_text, prompt_path, executor_config, env=None):
    env = env or {}
    executor = executor_config['executor']
    if executor in {'codex', 'claude'}:
        command_template = executor_config['command_template']
        command = command_template.replace('{prompt_file}', shlex.quote(str(prompt_path))).replace('{prompt}', shlex.quote(prompt_text))
        result = subprocess.run(command, cwd=str(WORKSPACE), capture_output=True, text=True, timeout=int(env.get('DISCORD_DISPATCHER_EXEC_TIMEOUT_SECONDS', '3600')), shell=True)
        return {'ok': result.returncode == 0, 'stdout': result.stdout.strip(), 'stderr': result.stderr.strip(), 'returncode': result.returncode, 'command': command, 'executor': executor}

    agent_timeout = int(env.get('DISCORD_DISPATCHER_OPENCLAW_TIMEOUT_SECONDS', '900'))
    process_timeout = int(env.get('DISCORD_DISPATCHER_OPENCLAW_PROCESS_TIMEOUT_SECONDS', str(agent_timeout + 120)))
    command = ['openclaw', 'agent', '--agent', 'main', '--message', prompt_text, '--json', '--timeout', str(agent_timeout)]
    try:
        result = subprocess.run(command, cwd=str(WORKSPACE), capture_output=True, text=True, timeout=process_timeout)
    except subprocess.TimeoutExpired as exc:
        stdout = (exc.stdout or '').strip() if exc.stdout else ''
        stderr = (exc.stderr or '').strip() if exc.stderr else ''
        return {
            'ok': False, 'stdout': stdout, 'stderr': stderr or f'openclaw process exceeded {process_timeout}s timeout', 'returncode': 124, 'command': ' '.join(command), 'executor': executor, 'timed_out': True, 'aborted': True, 'partial': bool(stdout)
        }
    stdout = (result.stdout or '').strip()
    parsed = parse_openclaw_json(stdout)
    if parsed:
        texts = [item.get('text', '').strip() for item in parsed.get('payloads', []) if item.get('text')]
        merged = '\n\n'.join([t for t in texts if t]).strip()
        meta = parsed.get('result', {}).get('meta') or {}
        aborted = bool(meta.get('aborted'))
        partial = aborted or bool(meta.get('partial'))
        ok = result.returncode == 0 and not aborted
        return {'ok': ok, 'stdout': merged or stdout, 'stderr': (result.stderr or '').strip(), 'returncode': result.returncode, 'command': ' '.join(command), 'executor': executor, 'aborted': aborted, 'partial': partial, 'raw_json': parsed}
    return {'ok': result.returncode == 0, 'stdout': stdout, 'stderr': (result.stderr or '').strip(), 'returncode': result.returncode, 'command': ' '.join(command), 'executor': executor}


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


def is_selftest_message(msg, env):
    enabled = (env.get('DISCORD_DISPATCHER_ENABLE_SELFTEST') or 'false').strip().lower() in {'1', 'true', 'yes', 'on'}
    return enabled and (msg.get('content') or '').strip().startswith(SELFTEST_MARKER)


def should_process_message(msg, state, env):
    is_bot = bool(msg.get('author', {}).get('bot'))
    if is_bot and not is_selftest_message(msg, env):
        return False
    if not (msg.get('content') or '').strip():
        return False
    channel_id = msg['channel_id']
    processed = state.setdefault('processed', {}).setdefault(channel_id, {})
    if msg['id'] in processed:
        return False
    return True


def normalize_inbound_text(msg, env):
    content = (msg.get('content') or '').strip()
    if is_selftest_message(msg, env):
        content = content[len(SELFTEST_MARKER):].strip()
    return content


def recent_channel_context(msgs, current_msg_id, max_items=6):
    context = []
    for msg in msgs:
        if msg.get('id') == current_msg_id:
            break
        if msg.get('author', {}).get('bot'):
            continue
        content = (msg.get('content') or '').strip()
        if not content:
            continue
        author = msg.get('author', {}).get('username') or 'user'
        context.append(f'- {author}: {content}')
    if not context:
        return ''
    return 'Recent Discord channel context:\n' + '\n'.join(context[-max_items:])


def recent_role_memory(role_label, max_items=3, max_chars=1200):
    if not RUNS_DIR.exists():
        return ''
    role_key = role_label.replace('/', '__')
    memories = []
    for path in sorted(RUNS_DIR.glob(f'*__{role_key}__*.out.md'))[-max_items:]:
        try:
            text = path.read_text(encoding='utf-8').strip()
        except Exception:
            continue
        if text:
            memories.append(f'From {path.name}:\n{text[:max_chars]}')
    if not memories:
        return ''
    return 'Relevant prior role memory from recent runs:\n\n' + '\n\n'.join(memories)


def build_task_text(content, role_label, channel_context='', role_memory=''):
    parts = [content.strip()]
    if channel_context:
        parts.append(channel_context)
    if role_memory:
        parts.append(role_memory)
    parts.append('Respond directly to the Discord user in your assigned persona. Keep it concise but useful.')
    return '\n\n'.join([p for p in parts if p])


def fail_request(msg, role_label, token, anon_key, state, run_id, status_msg_id, error_message, detail=None):
    channel_id = msg['channel_id']
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


def process_message(msg, channel_route, token, anon_key, state, executor_config, aliases, channel_msgs, env):
    channel_id = msg['channel_id']
    content = normalize_inbound_text(msg, env)
    override = extract_role_override(content, aliases)
    role_label = override['role_label'] if override else channel_route['default_role_label']
    task_body = override['task_text'] if override else content
    route_mode = override['mode'] if override else 'channel-default'
    processed = state.setdefault('processed', {}).setdefault(channel_id, {})
    if msg['id'] in processed:
        return

    context_block = recent_channel_context(channel_msgs, msg['id'])
    memory_block = recent_role_memory(role_label)

    queued_run = post_run(anon_key, {
        'role_label': role_label,
        'runtime': 'discord-dispatcher',
        'model_used': executor_config.get('executor', 'unknown'),
        'task_summary': f'Discord request: {task_body[:120]}',
        'task_detail': build_task_text(task_body, role_label, context_block, memory_block),
        'status': 'queued',
        'source_surface': 'discord',
        'source_channel_id': channel_id,
        'initiated_by': msg['author'].get('username') or 'discord-user',
        'started_at': None,
    })
    run_id = queued_run.get('id') if queued_run else None

    post_event(anon_key, {
        'event_type': 'discord_request_received',
        'title': f'Discord request queued: {role_label}',
        'body': f'Route mode: {route_mode}\n\n{task_body[:500]}',
        'severity': 'info',
        'related_run_id': run_id,
    })

    route_note = f'Queued `{role_label}` request ({route_mode}). Preparing prompt…'
    status_msg = upsert_status_message(token, channel_id, state, msg['id'], route_note)
    save_state(state)

    try:
        prompt, final_task, prompt_meta = build_bounded_prompt(role_label, task_body, context_block, memory_block, executor_config, env)
        prompt_path = write_prompt_file(role_label, msg['id'], prompt)
    except Exception as exc:
        fail_request(msg, role_label, token, anon_key, state, run_id, status_msg, 'Prompt preparation failed.', str(exc))
        return

    if not executor_config.get('ok'):
        detail = executor_config.get('reason', 'Dispatcher executor is not ready.')
        if executor_config.get('details'):
            detail += f" {executor_config['details']}"
        if run_id:
            patch_run(anon_key, run_id, {'output_path': str(prompt_path)})
        fail_request(msg, role_label, token, anon_key, state, run_id, status_msg, 'Dispatcher executor is not configured.', detail)
        return

    if run_id:
        patch_run(anon_key, run_id, {'status': 'running', 'output_path': str(prompt_path), 'task_detail': final_task, 'started_at': utc_now()})
    post_event(anon_key, {
        'event_type': 'discord_request_running',
        'title': f'Discord request running: {role_label}',
        'body': f'Route mode: {route_mode}\nPrompt saved: {prompt_path.relative_to(WORKSPACE)}',
        'severity': 'info',
        'related_run_id': run_id,
    })
    upsert_status_message(token, channel_id, state, msg['id'], f'Running `{role_label}` ({route_mode}).\nPrompt saved: `{prompt_path.relative_to(WORKSPACE)}`')
    save_state(state)

    try:
        run_result = run_executor(prompt, prompt_path, executor_config, env)
        run_result['prompt_chars'] = prompt_meta.get('prompt_chars')
    except Exception as exc:
        fail_request(msg, role_label, token, anon_key, state, run_id, status_msg, 'Dispatcher execution crashed before completion.', str(exc))
        return

    status = 'completed' if run_result['ok'] else 'failed'
    output_text = run_result['stdout'] or run_result['stderr'] or 'No output.'
    human_summary = summarize_output(output_text)
    output_summary = summarize_run_result(run_result)
    if not run_result['ok'] and run_result.get('command'):
        output_summary = summarize_run_result({**run_result, 'stdout': f"Command: {run_result['command']}\n\n{output_text}"})
        human_summary = summarize_output(f"Command: {run_result['command']}\n\n{output_text}")
    output_path = prompt_path.with_suffix('.out.md')
    output_path.write_text(output_text, encoding='utf-8')

    if run_id:
        patch_run(anon_key, run_id, {
            'status': status,
            'output_path': str(output_path),
            'output_summary': output_summary,
            'completed_at': utc_now(),
        })

    post_event(anon_key, {
        'event_type': 'discord_request_completed' if run_result['ok'] else 'discord_request_failed',
        'title': f'Discord request {status}: {role_label}',
        'body': human_summary[:500],
        'severity': 'success' if run_result['ok'] else 'error',
        'related_run_id': run_id,
    })

    final = output_text[:1900]
    upsert_status_message(token, channel_id, state, msg['id'], final)
    processed[msg['id']] = {
        'status': status,
        'run_id': run_id,
        'completed_at': utc_now(),
        'status_message_id': status_msg,
        'role_label': role_label,
        'route_mode': route_mode,
    }
    state.setdefault('last_seen', {})[channel_id] = msg['id']
    prune_state(state)
    save_state(state)


def process_run_request(req, anon_key, executor_config, env, token=None, routes=None):
    request_id = req.get('id')
    role_label = req.get('role_label')
    prompt_text = (req.get('prompt_text') or '').strip()
    related_run_id = req.get('related_run_id')

    if not request_id or not role_label or not prompt_text:
        return

    worker_id = f"{os.uname().nodename}:{os.getpid()}:{uuid.uuid4().hex[:8]}"
    claimed = claim_run_request(anon_key, request_id, worker_id)
    if not claimed:
        return

    # Render full role prompt wrapper with prompt-size guardrails
    try:
        prompt, final_task, prompt_meta = build_bounded_prompt(role_label, prompt_text, '', '', executor_config, env)
        prompt_path = write_prompt_file(role_label, f'runreq-{request_id}', prompt)
    except Exception as exc:
        patch_run_request(anon_key, request_id, { 'status': 'failed', 'error': str(exc) })
        if related_run_id:
            patch_run(anon_key, related_run_id, { 'status': 'failed', 'output_summary': str(exc)[:500], 'completed_at': utc_now() })
        post_event(anon_key, {
            'event_type': 'run_request_failed',
            'title': f'Run request failed: {role_label}',
            'body': str(exc)[:500],
            'severity': 'error',
            'related_run_id': related_run_id,
        })
        return

    if related_run_id:
        patch_run(anon_key, related_run_id, { 'status': 'running', 'started_at': utc_now(), 'task_detail': final_task })

    if not executor_config.get('ok'):
        reason = executor_config.get('reason', 'Executor unavailable')
        patch_run_request(anon_key, request_id, { 'status': 'failed', 'error': reason, 'output_path': str(prompt_path) })
        if related_run_id:
            patch_run(anon_key, related_run_id, { 'status': 'failed', 'output_summary': reason[:500], 'output_path': str(prompt_path), 'completed_at': utc_now() })
        return

    # Execute
    try:
        run_result = run_executor(prompt, prompt_path, executor_config, env)
        run_result['prompt_chars'] = prompt_meta.get('prompt_chars')
    except Exception as exc:
        patch_run_request(anon_key, request_id, { 'status': 'failed', 'error': str(exc), 'output_path': str(prompt_path) })
        if related_run_id:
            patch_run(anon_key, related_run_id, { 'status': 'failed', 'output_summary': str(exc)[:500], 'output_path': str(prompt_path), 'completed_at': utc_now() })
        return

    status = 'completed' if run_result['ok'] else 'failed'
    output_text = run_result.get('stdout') or run_result.get('stderr') or 'No output.'
    human_summary = summarize_output(output_text)
    output_summary = summarize_run_result(run_result)
    output_path = prompt_path.with_suffix('.out.md')
    output_path.write_text(output_text, encoding='utf-8')

    patch_run_request(anon_key, request_id, {
        'status': status,
        'output_summary': output_summary,
        'output_path': str(output_path),
        'error': None if run_result['ok'] else (run_result.get('stderr') or 'failed')
    })

    if related_run_id:
        patch_run(anon_key, related_run_id, {
            'status': status,
            'output_summary': output_summary,
            'output_path': str(output_path),
            'completed_at': utc_now(),
        })

    post_event(anon_key, {
        'event_type': 'run_request_completed' if run_result['ok'] else 'run_request_failed',
        'title': f'Run request {status}: {role_label}',
        'body': human_summary[:500],
        'severity': 'success' if run_result['ok'] else 'error',
        'related_run_id': related_run_id,
    })

    # If initiated from Discord commands, post results back to the command channel + audit to ops-log.
    try:
        initiated_by = (req.get('initiated_by') or '').lower()
        command_channel_id = (env.get('DISCORD_COMMAND_CHANNEL_ID') or '').strip()
        ops_log_channel_id = find_channel_id_by_name(routes or {}, 'ops-log') if routes else None
        if token and initiated_by == 'discord' and command_channel_id:
            rel = str(output_path).replace(str(WORKSPACE) + '/', '')
            view_url = f"http://127.0.0.1:45680/view-run-output.html?path={urllib.parse.quote(rel)}&role={urllib.parse.quote(role_label)}&id={urllib.parse.quote(str(request_id))}"
            header = f"✅ Completed" if status == 'completed' else f"❌ Failed"
            msg = "\n".join([
                f"{header}: `{role_label}`",
                f"RunRequest: `{request_id}`" + (f" • Run: `{related_run_id}`" if related_run_id else ""),
                human_summary[:900],
                f"View output: {view_url}",
            ])
            discord_send_message(command_channel_id, token, msg)
            if ops_log_channel_id:
                discord_send_message(ops_log_channel_id, token, f"[AUDIT] {header}: `{role_label}` • RunRequest `{request_id}`")
    except Exception as exc:
        post_event(anon_key, {
            'event_type': 'run_request_notify_failed',
            'title': f'Run request notify failed: {role_label}',
            'body': str(exc)[:500],
            'severity': 'warning',
            'related_run_id': related_run_id,
        })
        print(f'completion postback failed: {exc}', file=sys.stderr)


def dispatch_once(routes, token, anon_key, state, executor_config, env):
    # 0) Process Discord command channel (/orchestrate, /run)
    command_channel_id = (env.get('DISCORD_COMMAND_CHANNEL_ID') or '').strip()
    ops_log_channel_id = find_channel_id_by_name(routes, 'ops-log')

    if command_channel_id:
        try:
            msgs = discord_request('GET', f'/channels/{command_channel_id}/messages', token, query={'limit': 20}) or []
            msgs.sort(key=lambda m: int(m['id']))
            last_seen = int(state.get('last_seen', {}).get(command_channel_id, '0'))
            for msg in msgs:
                msg_id = int(msg['id'])
                if msg_id <= last_seen:
                    continue
                state.setdefault('last_seen', {})[command_channel_id] = msg['id']
                content = (msg.get('content') or '').strip()
                cmd = parse_command(content)
                if not cmd:
                    continue

                role_label = cmd['role_label']
                task_text = cmd['task_text']

                # Create an agent_runs audit row
                run = post_run(anon_key, {
                    'role_label': role_label,
                    'runtime': 'discord-command',
                    'model_used': executor_config.get('executor', 'unknown'),
                    'task_summary': (task_text[:120] + '…') if len(task_text) > 120 else task_text,
                    'task_detail': task_text,
                    'status': 'queued',
                    'source_surface': 'discord',
                    'source_channel_id': command_channel_id,
                    'initiated_by': (msg.get('author') or {}).get('username') or 'discord',
                    'started_at': None,
                    'completed_at': None,
                })

                # Create a run_requests queue row
                req = post_run_request(anon_key, {
                    'status': 'queued',
                    'role_label': role_label,
                    'prompt_text': task_text,
                    'suggested_channel_name': None,
                    'related_run_id': run.get('id') if run else None,
                    'initiated_by': 'discord',
                })

                ack = f"Queued `{role_label}` ({cmd['type']})." + (f" RunRequest: `{req.get('id')}`" if req else '') + (f" Run: `{run.get('id')}`" if run else '')
                discord_send_message(command_channel_id, token, ack)

                if ops_log_channel_id:
                    discord_send_message(ops_log_channel_id, token, f"[AUDIT] {ack}")
        except Exception as exc:
            print(f'command channel poll error: {exc}', file=sys.stderr)

    # 1) Process queued dashboard run requests (if the table exists)
    try:
        for req in get_run_requests(anon_key, limit=5) or []:
            process_run_request(req, anon_key, executor_config, env, token=token, routes=routes)
    except Exception as exc:
        # Table may not exist yet; keep dispatcher alive.
        if 'run_requests' not in str(exc):
            print(f'run_requests poll error: {exc}', file=sys.stderr)

    # 2) Process Discord messages per channel routes
    aliases = build_role_aliases(routes)
    for channel_id, route in routes.items():
        msgs = discord_request('GET', f'/channels/{channel_id}/messages', token, query={'limit': 20}) or []
        msgs.sort(key=lambda m: int(m['id']))
        last_seen = int(state.get('last_seen', {}).get(channel_id, '0'))
        for msg in msgs:
            msg_id = int(msg['id'])
            if msg_id <= last_seen and not should_process_message(msg, state, env):
                continue
            if not should_process_message(msg, state, env):
                state.setdefault('last_seen', {})[channel_id] = msg['id']
                continue
            process_message(msg, route, token, anon_key, state, executor_config, aliases, msgs, env)
    save_state(state)


def main():
    env = load_env(ENV_PATH)
    token = env_required(env, 'DISCORD_BOT_TOKEN')
    anon_key = env_required(env, 'SUPABASE_ANON_KEY')
    executor_config = resolve_executor(env)
    poll_seconds = float(env.get('DISCORD_DISPATCHER_POLL_SECONDS', '5'))
    watch_raw = env.get('DISCORD_DISPATCHER_CHANNELS', '').strip()
    watch_set = {c.strip() for c in watch_raw.split(',') if c.strip()} or None
    run_once = '--once' in sys.argv

    state = load_state()
    routes = get_channel_routes(anon_key, watch_set)
    if not routes:
        raise SystemExit('No active watched channel_routes found in Supabase.')

    print(f'Discord dispatcher watching {len(routes)} routed channels...')
    if executor_config.get('ok'):
        print(f"Dispatcher executor: {executor_config.get('executor')}")
    else:
        print(f"Dispatcher executor unavailable: {executor_config.get('reason')}")
        if executor_config.get('details'):
            print(executor_config['details'])

    if run_once:
        dispatch_once(routes, token, anon_key, state, executor_config, env)
        return

    while True:
        try:
            routes = get_channel_routes(anon_key, watch_set)
            dispatch_once(routes, token, anon_key, state, executor_config, env)
            time.sleep(poll_seconds)
        except KeyboardInterrupt:
            print('Stopping dispatcher.')
            return
        except Exception as exc:
            print(f'dispatcher error: {exc}', file=sys.stderr)
            time.sleep(max(poll_seconds, 5))


if __name__ == '__main__':
    main()
