import crypto from 'node:crypto';

export const ADMIN_COOKIE_NAMES = Object.freeze({
  access: 'campus_admin_access',
  refresh: 'campus_admin_refresh',
  csrf: 'campus_admin_csrf'
});

const SECURITY_COOKIE_NAMES = new Set(Object.values(ADMIN_COOKIE_NAMES));

export function parseCookies(header = '') {
  const cookies = Object.create(null);
  const invalidSecurityCookies = new Set();
  const seenSecurityCookies = new Set();

  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 1) continue;

    const name = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    const isSecurityCookie = SECURITY_COOKIE_NAMES.has(name);

    if (isSecurityCookie && seenSecurityCookies.has(name)) {
      invalidSecurityCookies.add(name);
      delete cookies[name];
      continue;
    }

    if (isSecurityCookie) {
      seenSecurityCookies.add(name);
    }

    if (invalidSecurityCookies.has(name)) continue;

    try {
      cookies[name] = decodeURIComponent(value);
    } catch {
      if (isSecurityCookie) {
        invalidSecurityCookies.add(name);
        delete cookies[name];
      } else {
        cookies[name] = value;
      }
    }
  }

  return cookies;
}

function serializeCookie(name, value, {
  httpOnly = false,
  secure = false,
  maxAge,
  path,
  expires
} = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`];

  if (Number.isInteger(maxAge)) parts.push(`Max-Age=${maxAge}`);
  if (expires) parts.push(`Expires=${expires.toUTCString()}`);
  if (path) parts.push(`Path=${path}`);
  if (httpOnly) parts.push('HttpOnly');
  if (secure) parts.push('Secure');
  parts.push('SameSite=Strict');

  return parts.join('; ');
}

function cookieSecurity(config) {
  return { secure: config.NODE_ENV === 'production' };
}

export function appendCsrfCookie(response, token, config) {
  response.append('Set-Cookie', serializeCookie(ADMIN_COOKIE_NAMES.csrf, token, {
    ...cookieSecurity(config),
    maxAge: config.ADMIN_REFRESH_COOKIE_MAX_AGE_SECONDS,
    path: '/'
  }));
}

export function ensureCsrfCookie(request, response, config) {
  const cookies = parseCookies(request.get('cookie'));
  let token = cookies[ADMIN_COOKIE_NAMES.csrf];

  if (!token) {
    token = crypto.randomBytes(32).toString('hex');
    appendCsrfCookie(response, token, config);
  }

  return token;
}

export function setAdminSessionCookies(response, session, config) {
  const accessMaxAge = Number.isInteger(session.expires_in) && session.expires_in > 0
    ? session.expires_in
    : 3600;
  const common = {
    ...cookieSecurity(config),
    httpOnly: true,
    path: '/api/admin'
  };

  response.append('Set-Cookie', serializeCookie(
    ADMIN_COOKIE_NAMES.access,
    session.access_token,
    { ...common, maxAge: accessMaxAge }
  ));
  response.append('Set-Cookie', serializeCookie(
    ADMIN_COOKIE_NAMES.refresh,
    session.refresh_token,
    { ...common, maxAge: config.ADMIN_REFRESH_COOKIE_MAX_AGE_SECONDS }
  ));

  const csrfToken = crypto.randomBytes(32).toString('hex');
  appendCsrfCookie(response, csrfToken, config);
}

export function clearAdminSessionCookies(response, config) {
  const expired = new Date(0);
  const secure = config.NODE_ENV === 'production';

  for (const name of [ADMIN_COOKIE_NAMES.access, ADMIN_COOKIE_NAMES.refresh]) {
    response.append('Set-Cookie', serializeCookie(name, '', {
      httpOnly: true,
      secure,
      maxAge: 0,
      expires: expired,
      path: '/api/admin'
    }));
  }
}

export function readAdminCookies(request) {
  const cookies = parseCookies(request.get('cookie'));
  return {
    accessToken: cookies[ADMIN_COOKIE_NAMES.access] ?? '',
    refreshToken: cookies[ADMIN_COOKIE_NAMES.refresh] ?? '',
    csrfToken: cookies[ADMIN_COOKIE_NAMES.csrf] ?? ''
  };
}
