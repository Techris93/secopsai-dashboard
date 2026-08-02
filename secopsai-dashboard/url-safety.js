// Remove credential-like query parameters before the application or any
// third-party resource can observe the URL. Authentication is handled by the
// Supabase client through a POST-style API call, never through the address bar.
(() => {
  const sensitiveKeys = new Set([
    'email', 'password', 'pass', 'passwd', 'pwd', 'token', 'secret',
    'api_key', 'apikey', 'access_token', 'refresh_token', 'id_token',
    'client_secret'
  ]);
  try {
    const current = new URL(window.location.href);
    let changed = Boolean(current.username || current.password);
    if (current.username || current.password) {
      current.username = '';
      current.password = '';
    }
    [...current.searchParams.keys()].forEach(key => {
      if (sensitiveKeys.has(String(key).toLowerCase())) {
        current.searchParams.delete(key);
        changed = true;
      }
    });
    if (changed && window.history?.replaceState) {
      window.history.replaceState(null, document.title, `${current.pathname}${current.search}${current.hash}` || '/');
    }
  } catch {
    // A malformed URL must not prevent the authentication gate from loading.
  }
})();
