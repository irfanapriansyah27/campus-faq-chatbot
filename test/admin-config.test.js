import assert from 'node:assert/strict';
import test from 'node:test';
import { loadConfig } from '../src/config/env.js';

const validEnvironment = {
  NODE_ENV: 'test',
  ADMIN_INGEST_KEY: 'test-admin-key-with-sufficient-length',
  ADMIN_APP_ORIGIN: 'http://localhost:3000',
  ADMIN_REFRESH_COOKIE_MAX_AGE_SECONDS: '604800',
  ADMIN_LOGIN_RATE_LIMIT: '10',
  SUPABASE_URL: 'https://project-id.supabase.co',
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test_value_long_enough',
  SUPABASE_SERVICE_ROLE_KEY: 'server-only-service-role-key-test',
  GEMINI_API_KEY: 'server-only-gemini-key-test',
  CLOUDFLARE_ACCOUNT_ID: 'test-account',
  CLOUDFLARE_API_TOKEN: 'server-only-cloudflare-token-test'
};

test('config auth memvalidasi publishable key, origin, cookie age, dan login limit', () => {
  const config = loadConfig(validEnvironment);

  assert.equal(config.SUPABASE_PUBLISHABLE_KEY, validEnvironment.SUPABASE_PUBLISHABLE_KEY);
  assert.equal(config.ADMIN_APP_ORIGIN, 'http://localhost:3000');
  assert.equal(config.ADMIN_REFRESH_COOKIE_MAX_AGE_SECONDS, 604800);
  assert.equal(config.ADMIN_LOGIN_RATE_LIMIT, 10);
});

for (const origin of [
  'https://admin.example.com',
  'http://localhost:3000'
]) {
  test(`config menerima ADMIN_APP_ORIGIN kanonis: ${origin}`, () => {
    const config = loadConfig({ ...validEnvironment, ADMIN_APP_ORIGIN: origin });
    assert.equal(config.ADMIN_APP_ORIGIN, origin);
  });
}

for (const origin of [
  'https://admin.example.com/',
  'https://admin.example.com/dashboard',
  'https://admin.example.com?preview=true',
  'https://admin.example.com#login',
  'https://user:password@admin.example.com',
  'https://admin.example.com:443'
]) {
  test(`config menolak ADMIN_APP_ORIGIN nonkanonis: ${origin}`, () => {
    assert.throws(
      () => loadConfig({ ...validEnvironment, ADMIN_APP_ORIGIN: origin }),
      /ADMIN_APP_ORIGIN/
    );
  });
}

test('config menolak publishable key yang hilang tanpa membaca environment lokal', () => {
  const { SUPABASE_PUBLISHABLE_KEY: _removed, ...missingKey } = validEnvironment;

  assert.throws(
    () => loadConfig(missingKey),
    /SUPABASE_PUBLISHABLE_KEY/
  );
});
