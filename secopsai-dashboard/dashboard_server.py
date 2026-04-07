#!/usr/bin/env python3
import json
import os
import urllib.parse
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from urllib.parse import urlparse

DIR = Path(__file__).resolve().parent


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
                },
            }
            return json_response(self, 200, payload)

        if parsed.path == '/api/run-output':
            # Serve run output text from within the OpenClaw workspace only.
            qs = urllib.parse.parse_qs(parsed.query or '')
            rel = (qs.get('path') or [None])[0]
            if not rel:
                return json_response(self, 400, {'ok': False, 'error': 'Missing path'})

            try:
                workspace_root = Path('/Users/chrixchange/.openclaw/workspace').resolve()
                target = (workspace_root / rel).resolve()
                if workspace_root not in target.parents and target != workspace_root:
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
