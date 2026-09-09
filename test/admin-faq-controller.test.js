import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createAdminRequester,
  createLatestRequestCoordinator,
  requestFaqPageWithClamp,
  resetAdminSensitiveView,
  resetAdminSessionState,
  resolveFaqPage
} from '../public/admin/faq-ui.js';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function response(status) {
  return { response: { ok: status >= 200 && status < 300, status }, payload: null };
}

test('mutation retry setelah refresh memakai CSRF terbaru dan mempertahankan body', async () => {
  const calls = [];
  const body = JSON.stringify({ question: 'Tetap sama' });
  let csrfToken = 'csrf-lama';
  let targetCalls = 0;

  const adminRequest = createAdminRequester({
    requestJson: async (path, options) => {
      calls.push({ path, options });
      targetCalls += 1;
      return targetCalls === 1 ? response(401) : response(200);
    },
    refreshSession: async () => {
      csrfToken = 'csrf-baru';
      return true;
    },
    readCsrfToken: () => csrfToken,
    onAuthLost: () => assert.fail('session seharusnya berhasil diperbarui')
  });

  const result = await adminRequest('/api/admin/faqs/faq-1', {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'x-csrf-token': 'csrf-lama'
    },
    body
  });

  assert.equal(result.response.status, 200);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].options.headers['x-csrf-token'], 'csrf-lama');
  assert.equal(calls[1].options.headers['x-csrf-token'], 'csrf-baru');
  assert.equal(calls[1].options.headers['Content-Type'], 'application/json');
  assert.strictEqual(calls[1].options.body, body);
});

test('requester tidak blind retry dan berhenti setelah tepat satu retry 401', async () => {
  let requestCalls = 0;
  let refreshCalls = 0;
  let authLosses = 0;
  const statuses = [401, 401];
  const adminRequest = createAdminRequester({
    requestJson: async () => {
      requestCalls += 1;
      return response(statuses.shift());
    },
    refreshSession: async () => {
      refreshCalls += 1;
      return true;
    },
    readCsrfToken: () => 'csrf',
    onAuthLost: () => {
      authLosses += 1;
    }
  });

  const result = await adminRequest('/api/admin/faqs');
  assert.equal(result.authLost, true);
  assert.equal(requestCalls, 2);
  assert.equal(refreshCalls, 1);
  assert.equal(authLosses, 1);

  requestCalls = 0;
  refreshCalls = 0;
  const serverErrorRequest = createAdminRequester({
    requestJson: async () => {
      requestCalls += 1;
      return response(503);
    },
    refreshSession: async () => {
      refreshCalls += 1;
      return true;
    },
    readCsrfToken: () => 'csrf',
    onAuthLost: () => assert.fail('503 bukan auth loss')
  });
  assert.equal((await serverErrorRequest('/api/admin/faqs')).response.status, 503);
  assert.equal(requestCalls, 1);
  assert.equal(refreshCalls, 0);
});

test('ADMIN_FORBIDDEN membersihkan session tanpa retry, tetapi CORS 403 tidak', async () => {
  let requestCalls = 0;
  let refreshCalls = 0;
  let authLosses = 0;
  const makeRequester = (code) => createAdminRequester({
    requestJson: async () => {
      requestCalls += 1;
      return {
        ...response(403),
        payload: { error: { code } }
      };
    },
    refreshSession: async () => {
      refreshCalls += 1;
      return true;
    },
    readCsrfToken: () => 'csrf',
    onAuthLost: () => {
      authLosses += 1;
    }
  });

  const forbidden = await makeRequester('ADMIN_FORBIDDEN')('/api/admin/faqs');
  assert.equal(forbidden.authLost, true);
  assert.equal(requestCalls, 1);
  assert.equal(refreshCalls, 0);
  assert.equal(authLosses, 1);

  requestCalls = 0;
  refreshCalls = 0;
  authLosses = 0;
  const corsDenied = await makeRequester('CORS_ORIGIN_DENIED')('/api/admin/faqs');
  assert.equal(corsDenied.response.status, 403);
  assert.equal(corsDenied.authLost, undefined);
  assert.equal(requestCalls, 1);
  assert.equal(refreshCalls, 0);
  assert.equal(authLosses, 0);
});

test('ADMIN_FORBIDDEN pada retry setelah refresh juga membersihkan session', async () => {
  let requestCalls = 0;
  let refreshCalls = 0;
  let authLosses = 0;
  const adminRequest = createAdminRequester({
    requestJson: async () => {
      requestCalls += 1;
      return requestCalls === 1
        ? response(401)
        : { ...response(403), payload: { error: { code: 'ADMIN_FORBIDDEN' } } };
    },
    refreshSession: async () => {
      refreshCalls += 1;
      return true;
    },
    readCsrfToken: () => 'csrf-terbaru',
    onAuthLost: () => {
      authLosses += 1;
    }
  });

  const result = await adminRequest('/api/admin/faqs');
  assert.equal(result.authLost, true);
  assert.equal(requestCalls, 2);
  assert.equal(refreshCalls, 1);
  assert.equal(authLosses, 1);
});

test('request yang lebih baru mengabort dan menolak hasil list/detail lama', async () => {
  const coordinator = createLatestRequestCoordinator();
  const firstResult = deferred();
  const secondResult = deferred();
  const rendered = [];

  async function renderWhenCurrent(operation, pending) {
    const value = await pending.promise;
    if (operation.isCurrent()) rendered.push(value);
  }

  const firstList = coordinator.begin('list');
  const firstRender = renderWhenCurrent(firstList, firstResult);
  const secondList = coordinator.begin('list');
  const secondRender = renderWhenCurrent(secondList, secondResult);

  assert.equal(firstList.signal.aborted, true);
  secondResult.resolve('daftar terbaru');
  await secondRender;
  firstResult.resolve('daftar lama');
  await firstRender;
  assert.deepEqual(rendered, ['daftar terbaru']);

  const firstDetail = coordinator.begin('detail');
  const secondDetail = coordinator.begin('detail');
  assert.equal(firstDetail.isCurrent(), false);
  assert.equal(firstDetail.signal.aborted, true);
  assert.equal(secondDetail.isCurrent(), true);

  coordinator.invalidateAll();
  assert.equal(secondList.isCurrent(), false);
  assert.equal(secondDetail.isCurrent(), false);
  assert.equal(secondDetail.signal.aborted, true);
});

test('old search/page/detail dan response setelah logout tidak dapat menimpa state', async () => {
  const coordinator = createLatestRequestCoordinator();
  const state = { list: null, detail: null };
  const errors = [];

  async function run(scope, pending, apply) {
    const operation = coordinator.begin(scope);
    try {
      const value = await pending.promise;
      if (operation.isCurrent()) apply(value);
    } catch (error) {
      if (operation.isCurrent()) errors.push(error.message);
    }
  }

  const oldSearch = deferred();
  const newSearch = deferred();
  const oldSearchRun = run('list', oldSearch, (value) => { state.list = value; });
  const newSearchRun = run('list', newSearch, (value) => { state.list = value; });
  newSearch.resolve({ query: 'beasiswa', page: 1 });
  await newSearchRun;
  oldSearch.resolve({ query: 'jadwal', page: 1 });
  await oldSearchRun;
  assert.deepEqual(state.list, { query: 'beasiswa', page: 1 });

  const oldPage = deferred();
  const newPage = deferred();
  const oldPageRun = run('list', oldPage, (value) => { state.list = value; });
  const newPageRun = run('list', newPage, (value) => { state.list = value; });
  newPage.resolve({ query: 'beasiswa', page: 3 });
  await newPageRun;
  oldPage.resolve({ query: 'beasiswa', page: 2 });
  await oldPageRun;
  assert.deepEqual(state.list, { query: 'beasiswa', page: 3 });

  const detailA = deferred();
  const detailB = deferred();
  const detailARun = run('detail', detailA, (value) => { state.detail = value; });
  const detailBRun = run('detail', detailB, (value) => { state.detail = value; });
  detailB.resolve({ id: 'B' });
  await detailBRun;
  detailA.resolve({ id: 'A' });
  await detailARun;
  assert.deepEqual(state.detail, { id: 'B' });

  const afterLogout = deferred();
  const afterLogoutRun = run('list', afterLogout, (value) => { state.list = value; });
  coordinator.begin('logout');
  coordinator.invalidate('list');
  afterLogout.resolve({ query: 'sensitif', page: 9 });
  await afterLogoutRun;
  assert.deepEqual(state.list, { query: 'beasiswa', page: 3 });
  assert.deepEqual(errors, []);
});

test('AbortError dari request yang digantikan tidak menjadi user-facing error', async () => {
  const coordinator = createLatestRequestCoordinator();
  const oldRequest = deferred();
  const errors = [];
  const operation = coordinator.begin('list');
  const handled = oldRequest.promise.catch((error) => {
    if (operation.isCurrent()) errors.push(error.message);
  });

  coordinator.begin('list');
  oldRequest.reject(new DOMException('Request dibatalkan', 'AbortError'));
  await handled;
  assert.deepEqual(errors, []);
});

test('logout/auth loss menginvalidasi request dan mereset seluruh state sensitif', () => {
  const coordinator = createLatestRequestCoordinator();
  const list = coordinator.begin('list');
  const detail = coordinator.begin('detail');
  const logout = coordinator.begin('logout');
  const state = {
    admin: { user: { email: 'admin@example.test' } },
    list: { phase: 'ready', data: [{ question: 'Rahasia' }], total: 1, message: 'lama' },
    query: { q: 'rahasia', status: 'draft', page: 9 },
    pageMeta: { page: 9, total: 1, total_pages: 1 },
    editing: { id: 'faq-1', answer: 'Rahasia' },
    formBusy: true
  };
  const viewMessages = [];

  resetAdminSessionState({
    state,
    requestCoordinator: coordinator,
    resetView: (message) => viewMessages.push(message),
    message: 'Session berakhir.'
  });

  assert.equal(list.signal.aborted, true);
  assert.equal(detail.signal.aborted, true);
  assert.equal(logout.signal.aborted, true);
  assert.deepEqual(state.admin, null);
  assert.deepEqual(state.list, { phase: 'idle', data: [], total: 0, message: '' });
  assert.equal(state.pageMeta, null);
  assert.equal(state.editing, null);
  assert.equal(state.formBusy, false);
  assert.deepEqual(state.query, {
    q: '', status: 'all', page: 1, pageSize: 20, sortBy: 'updated_at', sortOrder: 'desc'
  });
  assert.deepEqual(viewMessages, ['Session berakhir.']);
});

test('cleanup view mengosongkan identity, list, editor, form, notice, dan errors', () => {
  function element(overrides = {}) {
    return {
      hidden: false,
      disabled: true,
      readOnly: true,
      value: 'sensitif',
      textContent: 'sensitif',
      dataset: { kind: 'error', status: 'published' },
      children: ['sensitif'],
      resetCalls: 0,
      reset() { this.resetCalls += 1; },
      replaceChildren(...children) { this.children = children; },
      ...overrides
    };
  }

  const loginSubmit = element();
  const formControl = element();
  const auth = {
    authView: element({ hidden: true }),
    consoleView: element(),
    loginForm: element(),
    loginSubmit,
    statusMessage: element(),
    adminEmail: element(),
    logoutButton: element()
  };
  const list = {
    view: element({ hidden: true }),
    controls: element(),
    resultCount: element(),
    errorMessage: element(),
    pageIndicator: element(),
    loading: element(),
    empty: element(),
    error: element(),
    tableRegion: element(),
    pagination: element(),
    tableBody: element()
  };
  const editor = {
    view: element(),
    form: element({ elements: [formControl] }),
    keyInput: element(),
    questionInput: element(),
    answerInput: element(),
    categoryInput: element(),
    sourceInput: element(),
    metadataInput: element(),
    statusActions: element(),
    statusBadge: element(),
    loading: element(),
    notFound: element(),
    editStatusSection: element(),
    saveButton: element(),
    archiveDialog: element({ open: true, close() { this.open = false; } })
  };
  const feedback = {
    notice: element(),
    formErrorSummary: element(),
    versionConflict: element(),
    fieldErrors: {
      question: element(),
      metadata: element()
    }
  };

  resetAdminSensitiveView({
    message: 'Session berakhir.', auth, list, editor, feedback
  });

  assert.equal(auth.adminEmail.textContent, '');
  assert.equal(auth.statusMessage.textContent, 'Session berakhir.');
  assert.equal(auth.authView.hidden, false);
  assert.equal(auth.consoleView.hidden, true);
  assert.equal(auth.loginForm.hidden, false);
  assert.equal(loginSubmit.disabled, false);
  assert.equal(auth.logoutButton.disabled, false);

  assert.deepEqual(list.tableBody.children, []);
  assert.equal(list.resultCount.textContent, '');
  assert.equal(list.errorMessage.textContent, '');
  assert.equal(list.pageIndicator.textContent, 'Halaman 1');
  assert.equal(list.view.hidden, false);
  for (const panel of [list.loading, list.empty, list.error, list.tableRegion, list.pagination]) {
    assert.equal(panel.hidden, true);
  }

  assert.equal(editor.form.resetCalls, 1);
  assert.equal(formControl.disabled, false);
  assert.equal(editor.form.hidden, false);
  assert.equal(editor.keyInput.readOnly, false);
  for (const control of [
    editor.keyInput,
    editor.questionInput,
    editor.answerInput,
    editor.categoryInput,
    editor.sourceInput
  ]) {
    assert.equal(control.value, '');
  }
  assert.equal(editor.metadataInput.value, '{}');
  assert.equal(editor.view.hidden, true);
  assert.deepEqual(editor.statusActions.children, []);
  assert.equal(editor.statusBadge.textContent, '');
  assert.equal(editor.statusBadge.hidden, true);
  assert.equal(editor.statusBadge.dataset.status, undefined);
  assert.equal(editor.loading.hidden, true);
  assert.equal(editor.notFound.hidden, true);
  assert.equal(editor.editStatusSection.hidden, true);
  assert.equal(editor.archiveDialog.open, false);

  assert.equal(feedback.notice.hidden, true);
  assert.equal(feedback.notice.textContent, '');
  assert.equal(feedback.notice.dataset.kind, undefined);
  assert.equal(feedback.formErrorSummary.hidden, true);
  assert.equal(feedback.formErrorSummary.textContent, '');
  assert.equal(feedback.versionConflict.hidden, true);
  for (const error of Object.values(feedback.fieldErrors)) {
    assert.equal(error.textContent, '');
  }
});

test('pagination clamp meminta tepat satu reload dan total nol stabil di halaman satu', async () => {
  assert.deepEqual(resolveFaqPage(4, 2), { page: 2, shouldReload: true });
  assert.deepEqual(resolveFaqPage(2, 0), { page: 1, shouldReload: true });
  assert.deepEqual(resolveFaqPage(1, 0), { page: 1, shouldReload: false });
  assert.deepEqual(resolveFaqPage(0, 4), { page: 1, shouldReload: true });
  assert.deepEqual(resolveFaqPage(-3, 4), { page: 1, shouldReload: true });

  const requestedPages = [];
  const clamped = await requestFaqPageWithClamp({
    page: 4,
    requestPage: async (page) => {
      requestedPages.push(page);
      return page === 4
        ? { ...response(200), payload: { meta: { total_pages: 2 } } }
        : { ...response(200), payload: { meta: { total_pages: 1 } } };
    }
  });
  assert.deepEqual(requestedPages, [4, 2]);
  assert.equal(clamped.page, 2);
  assert.equal(clamped.reloaded, true);

  const zeroPages = [];
  const empty = await requestFaqPageWithClamp({
    page: 2,
    requestPage: async (page) => {
      zeroPages.push(page);
      return { ...response(200), payload: { meta: { total_pages: 0 } } };
    }
  });
  assert.deepEqual(zeroPages, [2, 1]);
  assert.equal(empty.page, 1);
  assert.equal(empty.reloaded, true);

  const lastItemRemovalPages = [];
  const afterLastItemRemoval = await requestFaqPageWithClamp({
    page: 2,
    requestPage: async (page) => {
      lastItemRemovalPages.push(page);
      return {
        ...response(200),
        payload: {
          data: page === 1 ? [{ id: 'remaining-item' }] : [],
          meta: { page, total: 1, total_pages: 1 }
        }
      };
    }
  });
  assert.deepEqual(lastItemRemovalPages, [2, 1]);
  assert.equal(lastItemRemovalPages.length, 2);
  assert.equal(afterLastItemRemoval.page, 1);
  assert.equal(afterLastItemRemoval.reloaded, true);
  assert.deepEqual(afterLastItemRemoval.result.payload.data, [{ id: 'remaining-item' }]);

  const filteredZeroPages = [];
  const filteredZero = await requestFaqPageWithClamp({
    page: 1,
    requestPage: async (page) => {
      filteredZeroPages.push(page);
      return {
        ...response(200),
        payload: { data: [], meta: { page: 1, total: 0, total_pages: 0 } }
      };
    }
  });
  assert.deepEqual(filteredZeroPages, [1]);
  assert.equal(filteredZeroPages.length, 1);
  assert.equal(filteredZero.page, 1);
  assert.equal(filteredZero.reloaded, false);

  for (const invalidPage of [0, -3]) {
    const normalizedRequests = [];
    const normalized = await requestFaqPageWithClamp({
      page: invalidPage,
      requestPage: async (page) => {
        normalizedRequests.push(page);
        return {
          ...response(200),
          payload: { data: [], meta: { page: 1, total: 0, total_pages: 0 } }
        };
      }
    });
    assert.deepEqual(normalizedRequests, [1]);
    assert.equal(normalized.page, 1);
    assert.equal(normalized.reloaded, false);
  }
});
