// Run output viewer.  Hosted: Cloudflare Access authenticates the same-origin
// request with its cookie.  Local: the helper token from the console session.
(() => {
  const cfg = window.SECOPSAI_CONFIG || {};
  const qs = new URLSearchParams(location.search);
  const path = qs.get('path');
  const role = qs.get('role');
  const id = qs.get('id');
  const meta = document.getElementById('meta');
  const out = document.getElementById('output');
  const expired = 'Your Cloudflare Access session has expired. Reload this page to sign in again.';

  if (!window.SECOPSAI_CONFIG) {
    // Access redirected config.js to its login: the session has expired.
    meta.textContent = expired;
    return;
  }
  if (!path) {
    meta.textContent = 'Missing path parameter.';
    return;
  }

  const url = new URL(cfg.runOutputEndpoint || '/api/run-output', window.location.origin);
  if (url.origin !== window.location.origin) {
    out.textContent = 'Run output endpoint must be same-origin.';
    return;
  }
  url.searchParams.set('path', path);
  const headers = {};
  try {
    const localToken = sessionStorage.getItem('secopsai_dashboard_local_auth_token') || '';
    if (localToken) headers['X-SecOpsAI-Local-Token'] = localToken;
  } catch {}

  meta.textContent = `${role ? role + ' • ' : ''}${id ? id + ' • ' : ''}${path}`;
  fetch(url.toString(), { headers, credentials: 'same-origin', redirect: 'manual' })
    .then(response => {
      if (response.type === 'opaqueredirect' || (response.status >= 300 && response.status < 400)) throw new Error(expired);
      return response.json();
    })
    .then(data => {
      out.textContent = data.ok ? (data.text || '') : (data.error || 'Failed to load output.');
    })
    .catch(err => {
      out.textContent = err.message || String(err);
    });
})();
