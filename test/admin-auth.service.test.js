import assert from 'node:assert/strict';
import test from 'node:test';
import { AdminAuthService } from '../src/services/admin-auth.service.js';
import { AppError } from '../src/utils/errors.js';

const user = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'admin@example.test'
};

const session = {
  access_token: 'private-access-token',
  refresh_token: 'private-refresh-token',
  expires_in: 3600,
  user
};

function createHarness({
  signInError = null,
  signInThrows = null,
  getUserError = null,
  getUserThrows = null,
  refreshError = null,
  refreshThrows = null,
  signOutThrows = null,
  membership = { user_id: user.id, role: 'admin', is_active: true },
  membershipError = null
} = {}) {
  const events = [];
  const calls = {
    factory: 0,
    signIn: [],
    getUser: [],
    refresh: [],
    setSession: [],
    signOut: [],
    membership: []
  };

  const authClientFactory = () => {
    calls.factory += 1;
    return {
      auth: {
        async signInWithPassword(credentials) {
          events.push('signInWithPassword');
          calls.signIn.push(credentials);
          if (signInThrows) throw signInThrows;
          return signInError
            ? { data: { session: null, user: null }, error: signInError }
            : { data: { session, user }, error: null };
        },
        async getUser(token) {
          events.push('getUser');
          calls.getUser.push(token);
          if (getUserThrows) throw getUserThrows;
          return getUserError
            ? { data: { user: null }, error: getUserError }
            : { data: { user }, error: null };
        },
        async refreshSession(input) {
          events.push('refreshSession');
          calls.refresh.push(input);
          if (refreshThrows) throw refreshThrows;
          return refreshError
            ? { data: { session: null, user: null }, error: refreshError }
            : { data: { session, user }, error: null };
        },
        async setSession(input) {
          events.push('setSession');
          calls.setSession.push(input);
          return { data: { session }, error: null };
        },
        async signOut(options) {
          events.push(`signOut(${options?.scope ?? 'missing-scope'})`);
          calls.signOut.push(options);
          if (signOutThrows) throw signOutThrows;
          return { error: null };
        }
      }
    };
  };

  const adminRepository = {
    async findAdminByUserId(userId) {
      events.push('membership lookup');
      calls.membership.push(userId);
      if (membershipError) throw membershipError;
      return membership;
    }
  };

  return {
    calls,
    events,
    service: new AdminAuthService({ authClientFactory, adminRepository })
  };
}

test('login valid memverifikasi membership admin dan mengembalikan session internal', async () => {
  const { service, calls, events } = createHarness();

  const result = await service.login({
    email: 'admin@example.test',
    password: 'password-valid'
  });
  events.push('result returned');

  assert.equal(result.user.id, user.id);
  assert.equal(result.role, 'admin');
  assert.equal(result.session.access_token, session.access_token);
  assert.deepEqual(calls.membership, [user.id]);
  assert.deepEqual(calls.signOut, []);
  assert.deepEqual(events, [
    'signInWithPassword',
    'membership lookup',
    'result returned'
  ]);
  assert.equal(calls.factory, 1);
});

test('login invalid menggunakan error generik', async () => {
  const { service, calls, events } = createHarness({ signInError: new Error('User not found') });

  await assert.rejects(
    service.login({ email: 'unknown@example.test', password: 'wrong-password' }),
    (error) => error.status === 401
      && error.code === 'AUTH_INVALID_CREDENTIALS'
      && error.message === 'Email atau kata sandi tidak valid.'
  );
  events.push('error');
  assert.deepEqual(calls.signOut, []);
  assert.deepEqual(events, ['signInWithPassword', 'error']);
});

for (const [name, options, expectedCode] of [
  ['tanpa membership', { membership: null }, 'ADMIN_FORBIDDEN'],
  ['admin nonaktif', {
    membership: { user_id: user.id, role: 'admin', is_active: false }
  }, 'ADMIN_FORBIDDEN'],
  ['role tidak valid', {
    membership: { user_id: user.id, role: 'viewer', is_active: true }
  }, 'ADMIN_FORBIDDEN'],
  ['repository error', {
    membershipError: new AppError('Pemeriksaan otorisasi admin gagal.', {
      status: 503,
      code: 'ADMIN_REPOSITORY_ERROR'
    })
  }, 'ADMIN_REPOSITORY_ERROR']
]) {
  test(`login ${name} membersihkan hanya session baru dengan scope local`, async () => {
    const { service, calls, events } = createHarness(options);

    await assert.rejects(
      service.login({ email: user.email, password: 'password-valid' }),
      (error) => error.code === expectedCode
    );
    events.push('error');

    assert.deepEqual(calls.membership, [user.id]);
    assert.deepEqual(calls.signOut, [{ scope: 'local' }]);
    assert.deepEqual(events, [
      'signInWithPassword',
      'membership lookup',
      'signOut(local)',
      'error'
    ]);
  });
}

test('kegagalan cleanup login tidak mengganti error authorization utama', async () => {
  const cleanupSentinel = new Error('cleanup-provider-sentinel');
  const { service, calls, events } = createHarness({
    membership: null,
    signOutThrows: cleanupSentinel
  });

  await assert.rejects(
    service.login({ email: user.email, password: 'password-valid' }),
    (error) => error.code === 'ADMIN_FORBIDDEN'
      && !error.message.includes(cleanupSentinel.message)
  );
  events.push('error');
  assert.deepEqual(calls.signOut, [{ scope: 'local' }]);
  assert.deepEqual(events, [
    'signInWithPassword',
    'membership lookup',
    'signOut(local)',
    'error'
  ]);
});

test('session invalid atau expired menghasilkan AUTH_REQUIRED', async () => {
  const { service } = createHarness({ getUserError: new Error('JWT expired') });

  await assert.rejects(
    service.authenticate('expired-access-token'),
    (error) => error.status === 401 && error.code === 'AUTH_REQUIRED'
  );
});

test('session valid dengan admin aktif diterima', async () => {
  const { service, calls } = createHarness();

  const result = await service.authenticate(session.access_token);

  assert.equal(result.user.email, user.email);
  assert.equal(result.role, 'admin');
  assert.deepEqual(calls.getUser, [session.access_token]);
});

for (const [name, membership] of [
  ['tanpa membership', null],
  ['admin nonaktif', { user_id: user.id, role: 'admin', is_active: false }],
  ['role tidak valid', { user_id: user.id, role: 'viewer', is_active: true }]
]) {
  test(`user valid ${name} menghasilkan ADMIN_FORBIDDEN`, async () => {
    const { service } = createHarness({ membership });

    await assert.rejects(
      service.authenticate(session.access_token),
      (error) => error.status === 403 && error.code === 'ADMIN_FORBIDDEN'
    );
  });
}

test('refresh berhasil merotasi session melalui client request-scoped', async () => {
  const { service, calls, events } = createHarness();

  const result = await service.refresh(session.refresh_token);
  events.push('result returned');

  assert.equal(result.session.refresh_token, session.refresh_token);
  assert.deepEqual(calls.refresh, [{ refresh_token: session.refresh_token }]);
  assert.deepEqual(calls.membership, [user.id]);
  assert.deepEqual(calls.signOut, []);
  assert.deepEqual(events, [
    'refreshSession',
    'membership lookup',
    'result returned'
  ]);
  assert.equal(calls.factory, 1);
});

for (const [name, membership] of [
  ['tanpa membership', null],
  ['admin nonaktif', { user_id: user.id, role: 'admin', is_active: false }],
  ['role tidak valid', { user_id: user.id, role: 'viewer', is_active: true }]
]) {
  test(`refresh ${name} ditolak dan session hasil refresh dibersihkan secara local`, async () => {
    const { service, calls, events } = createHarness({ membership });

    await assert.rejects(
      service.refresh(session.refresh_token),
      (error) => error.code === 'ADMIN_FORBIDDEN'
    );
    events.push('error');

    assert.deepEqual(calls.membership, [user.id]);
    assert.deepEqual(calls.signOut, [{ scope: 'local' }]);
    assert.deepEqual(events, [
      'refreshSession',
      'membership lookup',
      'signOut(local)',
      'error'
    ]);
  });
}

test('kegagalan cleanup refresh tidak mengganti error authorization utama', async () => {
  const cleanupSentinel = new Error('refresh-cleanup-provider-sentinel');
  const { service, calls, events } = createHarness({
    membership: { user_id: user.id, role: 'admin', is_active: false },
    signOutThrows: cleanupSentinel
  });

  await assert.rejects(
    service.refresh(session.refresh_token),
    (error) => error.code === 'ADMIN_FORBIDDEN'
      && !error.message.includes(cleanupSentinel.message)
  );
  events.push('error');

  assert.deepEqual(calls.signOut, [{ scope: 'local' }]);
  assert.deepEqual(events, [
    'refreshSession',
    'membership lookup',
    'signOut(local)',
    'error'
  ]);
});

test('refresh gagal menghasilkan AUTH_REQUIRED', async () => {
  const { service } = createHarness({ refreshError: new Error('Invalid refresh token') });

  await assert.rejects(
    service.refresh('invalid-refresh-token'),
    (error) => error.status === 401 && error.code === 'AUTH_REQUIRED'
  );
});

test('setiap operasi auth membuat client Supabase baru', async () => {
  const { service, calls } = createHarness();

  await service.authenticate(session.access_token);
  await service.refresh(session.refresh_token);

  assert.equal(calls.factory, 2);
});

test('logout mencoba revoke session melalui Supabase Auth', async () => {
  const { service, calls } = createHarness();

  await service.logout({
    accessToken: session.access_token,
    refreshToken: session.refresh_token
  });

  assert.deepEqual(calls.signOut, [{ scope: 'local' }]);
  assert.deepEqual(calls.setSession, [{
    access_token: session.access_token,
    refresh_token: session.refresh_token
  }]);
});

for (const [operation, options, invoke] of [
  ['login', { signInThrows: new Error('supabase-login-sentinel') },
    (service) => service.login({ email: user.email, password: 'password-valid' })],
  ['authenticate', { getUserThrows: new Error('supabase-get-user-sentinel') },
    (service) => service.authenticate(session.access_token)],
  ['refresh', { refreshThrows: new Error('supabase-refresh-sentinel') },
    (service) => service.refresh(session.refresh_token)]
]) {
  test(`exception Supabase Auth pada ${operation} disanitasi`, async () => {
    const { service } = createHarness(options);

    await assert.rejects(
      invoke(service),
      (error) => error.status === 503
        && error.code === 'AUTH_PROVIDER_ERROR'
        && !error.message.includes('sentinel')
        && error.cause === undefined
    );
  });
}
