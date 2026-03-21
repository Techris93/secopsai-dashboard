#!/usr/bin/env python3
import json
import re
import sys
import urllib.request
from pathlib import Path

WORKSPACE = Path('/Users/chrixchange/.openclaw/workspace')
CONFIG_PATH = WORKSPACE / 'secopsai-dashboard' / 'config.js'


def load_dashboard_config():
    text = CONFIG_PATH.read_text(encoding='utf-8')
    url_match = re.search(r'supabaseUrl:\s*"([^"]+)"', text)
    key_match = re.search(r'supabaseAnonKey:\s*"([^"]+)"', text)
    if not url_match or not key_match:
        raise SystemExit('Could not extract Supabase config from secopsai-dashboard/config.js')
    return url_match.group(1), key_match.group(1)


def supabase_post(base_url, anon_key, table, payload):
    req = urllib.request.Request(
        f"{base_url}/rest/v1/{table}",
        data=json.dumps(payload).encode('utf-8'),
        headers={
            'apikey': anon_key,
            'Authorization': f'Bearer {anon_key}',
            'Content-Type': 'application/json',
            'Prefer': 'return=representation'
        },
        method='POST'
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        body = resp.read().decode('utf-8')
    return json.loads(body) if body else []


def main():
    if len(sys.argv) != 2:
        raise SystemExit('Usage: log-run.py <payload.json>')

    payload_path = Path(sys.argv[1])
    payload = json.loads(payload_path.read_text(encoding='utf-8'))
    base_url, anon_key = load_dashboard_config()

    run_payload = payload['run']
    event_payload = payload.get('event')

    inserted_runs = supabase_post(base_url, anon_key, 'agent_runs', run_payload)
    run_row = inserted_runs[0] if inserted_runs else None

    if event_payload:
      if run_row and not event_payload.get('related_run_id'):
          event_payload['related_run_id'] = run_row.get('id')
      supabase_post(base_url, anon_key, 'dashboard_events', event_payload)

    print(json.dumps({'ok': True, 'run': run_row}, indent=2))


if __name__ == '__main__':
    main()
