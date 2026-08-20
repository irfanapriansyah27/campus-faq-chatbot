const SECURITY_COOKIE_NAMES = new Set(['campus_admin_csrf']);

export function readSecurityCookie(cookieHeader, name) {
  if (!SECURITY_COOKIE_NAMES.has(name)) return '';

  const values = [];
  for (const part of cookieHeader.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 1) continue;

    const cookieName = part.slice(0, separator).trim();
    if (cookieName !== name) continue;
    values.push(part.slice(separator + 1).trim());
  }

  if (values.length !== 1) return '';

  try {
    return decodeURIComponent(values[0]);
  } catch {
    return '';
  }
}
