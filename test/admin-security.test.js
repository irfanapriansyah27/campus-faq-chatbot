import assert from 'node:assert/strict';
import test from 'node:test';
import { createAdminMutationSecurity } from '../src/middleware/admin-request-security.js';
import {
  ADMIN_COOKIE_NAMES,
  appendCsrfCookie,
  clearAdminSessionCookies,
  parseCookies,
  setAdminSessionCookies
} from '../src/utils/admin-cookies.js';

const expectedOrigin = 'https://admin.example.test';
const csrfToken = 'a'.repeat(64);
const productionConfig = {
  NODE_ENV: 'production',
  ADMIN_REFRESH_COOKIE_MAX_AGE_SECONDS: 604800
};

function createResponseRecorder() {
  const cookies = [];
  return {
    cookies,
    response: {
      append(name, value) {
        assert.equal(name, 'Set-Cookie');
        cookies.push(value);
      }
    }
  };
}

function runMutationSecurity(options = {}) {
  const origin = Object.hasOwn(options, 'origin') ? options.origin : expectedOrigin;
  const cookieToken = Object.hasOwn(options, 'cookieToken') ? options.cookieToken : csrfToken;
  const suppliedToken = Object.hasOwn(options, 'suppliedToken') ? options.suppliedToken : csrfToken;
  const headers = {
    origin,
    cookie: cookieToken === null ? '' : `${ADMIN_COOKIE_NAMES.csrf}=${cookieToken}`,
    'x-csrf-token': suppliedToken
  };
  let nextError;

  createAdminMutationSecurity(expectedOrigin)({
    get(name) {
      return headers[name.toLowerCase()];
    }
  }, {}, (error) => {
    nextError = error;
  });

  return nextError;
}

test('duplicate security cookie ditolak tanpa memilih nilai pertama atau terakhir', () => {
  const parsed = parseCookies([
    `${ADMIN_COOKIE_NAMES.csrf}=first`,
    `${ADMIN_COOKIE_NAMES.csrf}=second`,
    `${ADMIN_COOKIE_NAMES.access}=access-first`,
    `${ADMIN_COOKIE_NAMES.access}=access-second`
  ].join('; '));

  assert.equal(parsed[ADMIN_COOKIE_NAMES.csrf], undefined);
  assert.equal(parsed[ADMIN_COOKIE_NAMES.access], undefined);
});

test('percent-encoding malformed pada security cookie ditolak', () => {
  const parsed = parseCookies([
    `${ADMIN_COOKIE_NAMES.csrf}=%E0%A4%A`,
    `${ADMIN_COOKIE_NAMES.refresh}=%`
  ].join('; '));

  assert.equal(parsed[ADMIN_COOKIE_NAMES.csrf], undefined);
  assert.equal(parsed[ADMIN_COOKIE_NAMES.refresh], undefined);
});

test('frontend fail-closed untuk duplicate dan malformed CSRF cookie tanpa melempar', async () => {
  const { readSecurityCookie } = await import('../public/admin/security-cookie.js');

  assert.equal(readSecurityCookie(
    `${ADMIN_COOKIE_NAMES.csrf}=first; ${ADMIN_COOKIE_NAMES.csrf}=second`,
    ADMIN_COOKIE_NAMES.csrf
  ), '');
  assert.doesNotThrow(() => readSecurityCookie(
    `${ADMIN_COOKIE_NAMES.csrf}=%E0%A4%A`,
    ADMIN_COOKIE_NAMES.csrf
  ));
  assert.equal(readSecurityCookie(
    `${ADMIN_COOKIE_NAMES.csrf}=%E0%A4%A`,
    ADMIN_COOKIE_NAMES.csrf
  ), '');
  assert.equal(readSecurityCookie(
    `${ADMIN_COOKIE_NAMES.csrf}=${encodeURIComponent(csrfToken)}`,
    ADMIN_COOKIE_NAMES.csrf
  ), csrfToken);
});

test('serializer mengenkode CR dan LF sehingga tidak dapat menyuntik header', () => {
  const csrfRecorder = createResponseRecorder();
  appendCsrfCookie(csrfRecorder.response, 'safe\r\nX-Injected: yes', productionConfig);

  const sessionRecorder = createResponseRecorder();
  setAdminSessionCookies(sessionRecorder.response, {
    access_token: 'access\r\nX-Injected: yes',
    refresh_token: 'refresh\nSet-Cookie: injected=yes',
    expires_in: 3600
  }, productionConfig);

  for (const cookie of [...csrfRecorder.cookies, ...sessionRecorder.cookies]) {
    assert.doesNotMatch(cookie, /[\r\n]/);
  }
  assert.match(csrfRecorder.cookies[0], /%0D%0A/);
});

test('penghapusan cookie memakai atribut yang konsisten dengan cookie session production', () => {
  const recorder = createResponseRecorder();
  clearAdminSessionCookies(recorder.response, productionConfig);

  assert.equal(recorder.cookies.length, 2);
  for (const cookie of recorder.cookies) {
    assert.match(cookie, /Max-Age=0/);
    assert.match(cookie, /Expires=Thu, 01 Jan 1970 00:00:00 GMT/);
    assert.match(cookie, /Path=\/api\/admin/);
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /Secure/);
    assert.match(cookie, /SameSite=Strict/);
  }
});

test('exact origin menerima origin kanonis yang sama', () => {
  assert.equal(runMutationSecurity(), undefined);
});

for (const [name, origin] of [
  ['hilang', undefined],
  ['kosong', ''],
  ['port berbeda', 'https://admin.example.test:444'],
  ['subdomain palsu', 'https://evil.admin.example.test'],
  ['prefix', 'https://admin.example'],
  ['suffix', 'https://admin.example.test.evil.test'],
  ['asing', 'https://foreign.example.test']
]) {
  test(`exact origin menolak origin ${name}`, () => {
    const error = runMutationSecurity({ origin });
    assert.equal(error?.status, 403);
    assert.equal(error?.code, 'ORIGIN_DENIED');
  });
}

test('CSRF berbeda panjang ditolak 403 tanpa timingSafeEqual melempar', () => {
  assert.doesNotThrow(() => runMutationSecurity({ suppliedToken: `${csrfToken}extra` }));
  const error = runMutationSecurity({ suppliedToken: `${csrfToken}extra` });
  assert.equal(error?.status, 403);
  assert.equal(error?.code, 'CSRF_INVALID');
});
