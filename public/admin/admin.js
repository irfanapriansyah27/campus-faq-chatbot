import { readSecurityCookie } from './security-cookie.js';

const loginForm = document.querySelector('#login-form');
const sessionPanel = document.querySelector('#session-panel');
const statusMessage = document.querySelector('#status-message');
const adminEmail = document.querySelector('#admin-email');
const logoutButton = document.querySelector('#logout-button');

function mutationHeaders(includeJson = false) {
  return {
    ...(includeJson ? { 'Content-Type': 'application/json' } : {}),
    'x-csrf-token': readSecurityCookie(document.cookie, 'campus_admin_csrf')
  };
}

function showLogin(message = 'Silakan masuk menggunakan akun admin.') {
  sessionPanel.hidden = true;
  loginForm.hidden = false;
  statusMessage.textContent = message;
}

function showSession(data) {
  loginForm.hidden = true;
  sessionPanel.hidden = false;
  adminEmail.textContent = data.user.email ?? data.user.id;
  statusMessage.textContent = 'Session admin aktif.';
}

async function request(path, options = {}) {
  const response = await fetch(path, {
    credentials: 'same-origin',
    ...options
  });
  const payload = response.status === 204 ? null : await response.json().catch(() => null);
  return { response, payload };
}

async function refreshSession() {
  const { response, payload } = await request('/api/admin/auth/refresh', {
    method: 'POST',
    headers: mutationHeaders()
  });

  if (response.ok) {
    showSession(payload.data);
    return true;
  }

  return false;
}

async function initialize() {
  loginForm.hidden = true;

  try {
    const { response, payload } = await request('/api/admin/auth/session');

    if (response.ok) {
      showSession(payload.data);
      return;
    }

    const refreshed = await refreshSession();
    if (!refreshed) {
      showLogin('Session berakhir. Silakan masuk kembali.');
    }
  } catch {
    showLogin('Layanan autentikasi sedang tidak tersedia. Silakan coba kembali.');
  }
}

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const submitButton = loginForm.querySelector('button[type="submit"]');
  submitButton.disabled = true;
  statusMessage.textContent = 'Memverifikasi akun…';

  try {
    const formData = new FormData(loginForm);
    const { response, payload } = await request('/api/admin/auth/login', {
      method: 'POST',
      headers: mutationHeaders(true),
      body: JSON.stringify({
        email: String(formData.get('email') ?? ''),
        password: String(formData.get('password') ?? '')
      })
    });

    if (!response.ok) {
      showLogin(payload?.error?.message ?? 'Login gagal. Silakan coba kembali.');
      return;
    }

    loginForm.reset();
    showSession(payload.data);
  } catch {
    showLogin('Layanan autentikasi sedang tidak tersedia. Silakan coba kembali.');
  } finally {
    submitButton.disabled = false;
  }
});

logoutButton.addEventListener('click', async () => {
  logoutButton.disabled = true;

  try {
    await request('/api/admin/auth/logout', {
      method: 'POST',
      headers: mutationHeaders()
    });
  } finally {
    logoutButton.disabled = false;
    showLogin('Anda telah keluar.');
  }
});

initialize();
