#!/usr/bin/env python3
import os
from pathlib import Path

DIR = Path(__file__).resolve().parent
ENV_PATH = DIR / '.env'
TEMPLATE_PATH = DIR / 'config.template.js'
OUTPUT_PATH = DIR / 'config.js'


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


def js_escape(value: str) -> str:
    return value.replace('\\', '\\\\').replace('"', '\\"')


def js_bool(value: str | None, default: bool = False) -> str:
    if value is None:
        return 'true' if default else 'false'
    normalized = str(value).strip().lower()
    return 'true' if normalized in {'1', 'true', 'yes', 'on'} else 'false'


def js_number(value: str | None, default: float = 0.0) -> str:
    try:
        return str(float(str(value).strip()))
    except Exception:
        return str(float(default))


def main():
    env = load_env(ENV_PATH)
    merged = {**os.environ, **env}
    required = ['SUPABASE_URL', 'SUPABASE_ANON_KEY']
    missing = [k for k in required if not merged.get(k)]
    if missing:
        raise SystemExit(f'Missing required env vars: {", ".join(missing)}')

    values = {
        '__SUPABASE_URL__': js_escape(merged.get('SUPABASE_URL', '')),
        '__SUPABASE_ANON_KEY__': js_escape(merged.get('SUPABASE_ANON_KEY', '')),
        '__APP_NAME__': js_escape(merged.get('APP_NAME', 'SecOpsAI Triage Dashboard')),
        '__HOSTED_AI_ENABLED__': js_bool(merged.get('HOSTED_AI_ENABLED'), default=False),
        '__HOSTED_AI_MODEL__': js_escape(merged.get('HOSTED_AI_MODEL', 'gpt-5.4-mini')),
        '__HOSTED_AI_MAX_COST_USD__': js_number(merged.get('HOSTED_AI_MAX_COST_USD'), default=3.0),
        '__HOSTED_AI_ALLOW_MUTATIONS__': js_bool(merged.get('HOSTED_AI_ALLOW_MUTATIONS'), default=False),
    }

    text = TEMPLATE_PATH.read_text(encoding='utf-8')
    for key, value in values.items():
        text = text.replace(key, value)
    OUTPUT_PATH.write_text(text, encoding='utf-8')
    print(f'Generated {OUTPUT_PATH}')


if __name__ == '__main__':
    main()
