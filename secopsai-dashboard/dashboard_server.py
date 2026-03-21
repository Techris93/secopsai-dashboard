#!/usr/bin/env python3
import json
import os
import urllib.request
import urllib.error
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from urllib.parse import urlparse

DIR = Path(__file__).resolve().parent
ENV_PATH = DIR / '.env'


def load_env(path: Path):
    env = {}
    if not path.exists():
        return env
    for line in path.read_text(encoding='utf-8').splitlines():
        line = line.strip()
        if not line or line.startswith('#') or '=' not in line:
            continue
        key, value = line.split('=', 1)
        env[key.strip()] = value.strip()
    return env


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
            env = load_env(ENV_PATH)
            payload = {
                'ok': True,
                'discord': {
                    'mode': 'local-helper',
                    'ops-log': bool(env.get('DISCORD_OPS_LOG_WEBHOOK')),
                    'kanban-updates': bool(env.get('DISCORD_KANBAN_UPDATES_WEBHOOK')),
                }
            }
            return json_response(self, 200, payload)
        return super().do_GET()

    def do_POST(self):
        parsed = urlparse(self.path)
        if parsed.path not in {'/api/discord-notify', '/api/discord-send-message'}:
            return json_response(self, 404, {'ok': False, 'error': 'Not found'})

        length = int(self.headers.get('Content-Length', '0'))
        raw = self.rfile.read(length)
        try:
            payload = json.loads(raw.decode('utf-8'))
        except Exception:
            return json_response(self, 400, {'ok': False, 'error': 'Invalid JSON'})

        env = load_env(ENV_PATH)
        content = payload.get('content')
        if not content:
            return json_response(self, 400, {'ok': False, 'error': 'Missing content'})

        if parsed.path == '/api/discord-notify':
            channel = payload.get('channel')
            if channel not in {'ops-log', 'kanban-updates'}:
                return json_response(self, 400, {'ok': False, 'error': 'Unsupported channel'})
            webhook = env.get('DISCORD_OPS_LOG_WEBHOOK') if channel == 'ops-log' else env.get('DISCORD_KANBAN_UPDATES_WEBHOOK')
            if not webhook:
                return json_response(self, 200, {'ok': False, 'skipped': True, 'reason': f'No webhook configured for {channel}'})

            req = urllib.request.Request(
                webhook,
                data=json.dumps({'content': content}).encode('utf-8'),
                headers={'Content-Type': 'application/json', 'User-Agent': 'SecOpsAI-Dashboard/1.0'},
                method='POST'
            )
            try:
                with urllib.request.urlopen(req, timeout=30) as resp:
                    status = getattr(resp, 'status', 200)
                    body = resp.read().decode('utf-8', 'ignore')
                return json_response(self, 200, {'ok': True, 'status': status, 'response': body or None})
            except urllib.error.HTTPError as exc:
                body = exc.read().decode('utf-8', 'ignore')
                detail = {'http_status': exc.code, 'raw': body}
                discord_code = None
                if body:
                    try:
                        parsed_body = json.loads(body)
                        discord_code = parsed_body.get('code')
                        detail['parsed'] = parsed_body
                    except Exception:
                        pass
                    if discord_code is None:
                        import re
                        m = re.search(r'error code:\s*(\d+)', body)
                        if m:
                            discord_code = int(m.group(1))
                if discord_code is not None:
                    detail['discord_code'] = discord_code
                return json_response(self, 502, {'ok': False, 'error': f'Discord webhook HTTP {exc.code}', 'errorDetail': detail})
            except Exception as exc:
                return json_response(self, 502, {'ok': False, 'error': str(exc)})

        channel_id = payload.get('channelId')
        token = env.get('DISCORD_BOT_TOKEN')
        if not channel_id:
            return json_response(self, 400, {'ok': False, 'error': 'Missing channelId'})
        if not token:
            return json_response(self, 400, {'ok': False, 'error': 'Missing DISCORD_BOT_TOKEN in .env'})
        req = urllib.request.Request(
            f'https://discord.com/api/v10/channels/{channel_id}/messages',
            data=json.dumps({'content': content}).encode('utf-8'),
            headers={
                'Authorization': f'Bot {token}',
                'Content-Type': 'application/json',
                'User-Agent': 'SecOpsAI-Dashboard/1.0'
            },
            method='POST'
        )
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                status = getattr(resp, 'status', 200)
                body = resp.read().decode('utf-8', 'ignore')
            parsed_body = json.loads(body) if body else {}
            return json_response(self, 200, {'ok': True, 'status': status, 'messageId': parsed_body.get('id')})
        except urllib.error.HTTPError as exc:
            body = exc.read().decode('utf-8', 'ignore')
            return json_response(self, 502, {'ok': False, 'error': f'Discord bot HTTP {exc.code}', 'errorDetail': {'http_status': exc.code, 'raw': body}})
        except Exception as exc:
            return json_response(self, 502, {'ok': False, 'error': str(exc)})


if __name__ == '__main__':
    host = os.environ.get('HOST', '127.0.0.1')
    port = int(os.environ.get('PORT', '45680'))
    print(f'Serving SecOpsAI dashboard from: {DIR}')
    print(f'URL: http://{host}:{port}')
    print(f'Loaded config from: {ENV_PATH}')
    ThreadingHTTPServer((host, port), DashboardHandler).serve_forever()
