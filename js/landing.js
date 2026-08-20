(function () {
  const STORAGE_KEY = 'localstream_server_url';

  const form = document.getElementById('server-form');
  const input = document.getElementById('server-url');
  const error = document.getElementById('error');

  // Prefill with previously used server URL if available
  const existing = window.localStorage.getItem(STORAGE_KEY);
  if (existing && input) {
    input.value = existing;
  }

  function normalizeUrl(raw) {
    if (!raw) return '';
    const trimmed = raw.trim();
    if (!/^https?:\/\//i.test(trimmed)) {
      return 'http://' + trimmed;
    }
    return trimmed.replace(/\/$/, '');
  }

  if (form) {
    form.addEventListener('submit', (evt) => {
      evt.preventDefault();
      error.hidden = true;
      error.textContent = '';

      const raw = input.value;
      const url = normalizeUrl(raw);

      try {
        // Validate URL format
        // eslint-disable-next-line no-new
        new URL(url);
      } catch (e) {
        error.textContent = 'Please enter a valid http/https URL.';
        error.hidden = false;
        return;
      }

      window.localStorage.setItem(STORAGE_KEY, url);

      // Redirect to media page
      window.location.href = 'media.html';
    });
  }
})();
