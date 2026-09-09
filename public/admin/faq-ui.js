import { parseFaqMetadataInput } from './faq-metadata.js';

const STATUS_LABELS = Object.freeze({
  draft: 'Draf',
  published: 'Terbit',
  archived: 'Diarsipkan'
});

const MUTATION_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function createFaqQueryState() {
  return {
    q: '',
    status: 'all',
    page: 1,
    pageSize: 20,
    sortBy: 'updated_at',
    sortOrder: 'desc'
  };
}

function copyHeaders(headers) {
  if (!headers) return {};
  if (typeof headers.entries === 'function') {
    return Object.fromEntries(headers.entries());
  }
  if (Array.isArray(headers)) return Object.fromEntries(headers);
  return { ...headers };
}

function withCurrentCsrf(options, readCsrfToken) {
  const method = String(options.method ?? 'GET').toUpperCase();
  if (!MUTATION_METHODS.has(method)) return options;

  const headers = copyHeaders(options.headers);
  for (const name of Object.keys(headers)) {
    if (name.toLowerCase() === 'x-csrf-token') delete headers[name];
  }
  headers['x-csrf-token'] = readCsrfToken();
  return { ...options, headers };
}

export function createAdminRequester({
  requestJson,
  refreshSession,
  readCsrfToken,
  onAuthLost
}) {
  return async function adminRequest(path, options = {}, allowRefresh = true) {
    const firstResult = await requestJson(path, options);
    if (options.signal?.aborted) return { ...firstResult, aborted: true };
    if (firstResult.response.status === 403
      && firstResult.payload?.error?.code === 'ADMIN_FORBIDDEN') {
      onAuthLost();
      return { ...firstResult, authLost: true };
    }
    if (firstResult.response.status !== 401 || !allowRefresh) return firstResult;

    const refreshed = await refreshSession(options.signal);
    if (options.signal?.aborted) return { ...firstResult, aborted: true };
    if (!refreshed) {
      onAuthLost();
      return { ...firstResult, authLost: true };
    }

    const retryOptions = withCurrentCsrf(options, readCsrfToken);
    const retryResult = await requestJson(path, retryOptions);
    if (options.signal?.aborted) return { ...retryResult, aborted: true };
    if (retryResult.response.status === 403
      && retryResult.payload?.error?.code === 'ADMIN_FORBIDDEN') {
      onAuthLost();
      return { ...retryResult, authLost: true };
    }
    if (retryResult.response.status === 401) {
      onAuthLost();
      return { ...retryResult, authLost: true };
    }
    return retryResult;
  };
}

export function createLatestRequestCoordinator({
  createAbortController = () => new AbortController()
} = {}) {
  const generations = new Map();
  const active = new Map();

  function begin(scope) {
    active.get(scope)?.controller.abort();
    const generation = (generations.get(scope) ?? 0) + 1;
    const controller = createAbortController();
    const entry = { controller, generation };
    generations.set(scope, generation);
    active.set(scope, entry);

    return Object.freeze({
      signal: controller.signal,
      isCurrent() {
        return generations.get(scope) === generation
          && active.get(scope) === entry
          && !controller.signal.aborted;
      }
    });
  }

  function invalidate(scope) {
    const entry = active.get(scope);
    if (entry) entry.controller.abort();
    active.delete(scope);
    generations.set(scope, (generations.get(scope) ?? 0) + 1);
  }

  function invalidateAll() {
    for (const scope of [...active.keys()]) invalidate(scope);
  }

  return Object.freeze({ begin, invalidate, invalidateAll });
}

export function resetAdminSessionState({
  state,
  requestCoordinator,
  resetView,
  message
}) {
  requestCoordinator.invalidateAll();
  state.admin = null;
  state.list = createFaqListState();
  state.query = createFaqQueryState();
  state.pageMeta = null;
  state.editing = null;
  state.formBusy = false;
  resetView(message);
}

export function resetAdminSensitiveView({
  message,
  auth,
  list,
  editor,
  feedback
}) {
  auth.loginForm.reset();
  auth.loginSubmit.disabled = false;
  list.controls.reset();
  editor.form.reset();
  for (const element of editor.form.elements) element.disabled = false;

  editor.keyInput.readOnly = false;
  editor.keyInput.value = '';
  editor.questionInput.value = '';
  editor.answerInput.value = '';
  editor.categoryInput.value = '';
  editor.sourceInput.value = '';
  editor.metadataInput.value = '{}';
  editor.form.hidden = false;
  editor.saveButton.textContent = 'Simpan draf';

  list.tableBody.replaceChildren();
  list.resultCount.textContent = '';
  list.errorMessage.textContent = '';
  list.pageIndicator.textContent = 'Halaman 1';
  list.loading.hidden = true;
  list.empty.hidden = true;
  list.error.hidden = true;
  list.tableRegion.hidden = true;
  list.pagination.hidden = true;
  list.view.hidden = false;

  editor.statusActions.replaceChildren();
  editor.statusBadge.textContent = '';
  delete editor.statusBadge.dataset.status;
  editor.statusBadge.hidden = true;
  editor.view.hidden = true;
  editor.loading.hidden = true;
  editor.notFound.hidden = true;
  editor.editStatusSection.hidden = true;
  if (editor.archiveDialog.open) editor.archiveDialog.close();

  feedback.notice.hidden = true;
  feedback.notice.textContent = '';
  delete feedback.notice.dataset.kind;
  feedback.formErrorSummary.hidden = true;
  feedback.formErrorSummary.textContent = '';
  feedback.versionConflict.hidden = true;
  for (const element of Object.values(feedback.fieldErrors)) {
    element.textContent = '';
  }

  auth.adminEmail.textContent = '';
  auth.consoleView.hidden = true;
  auth.authView.hidden = false;
  auth.loginForm.hidden = false;
  auth.logoutButton.disabled = false;
  auth.statusMessage.textContent = message;
}

export function resolveFaqPage(currentPage, totalPages) {
  const normalizedCurrent = Number.isSafeInteger(currentPage) && currentPage >= 1
    ? currentPage
    : 1;
  if (!Number.isSafeInteger(totalPages) || totalPages < 0) {
    return {
      page: normalizedCurrent,
      shouldReload: normalizedCurrent !== currentPage
    };
  }

  const lastPage = totalPages === 0 ? 1 : totalPages;
  const page = Math.min(normalizedCurrent, lastPage);
  return { page, shouldReload: page !== currentPage };
}

export async function requestFaqPageWithClamp({ page, requestPage }) {
  const initialPage = Number.isSafeInteger(page) && page >= 1 ? page : 1;
  const firstResult = await requestPage(initialPage);
  if (!firstResult.response.ok) {
    return { page: initialPage, result: firstResult, reloaded: false };
  }

  const resolution = resolveFaqPage(initialPage, firstResult.payload?.meta?.total_pages);
  if (!resolution.shouldReload) {
    return { page: resolution.page, result: firstResult, reloaded: false };
  }

  const result = await requestPage(resolution.page);
  return { page: resolution.page, result, reloaded: true };
}

export function statusLabel(status) {
  return STATUS_LABELS[status] ?? status;
}

export function formatFaqDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';

  return new Intl.DateTimeFormat('id-ID', {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(date);
}

export function truncateText(value, maxLength = 120) {
  const text = String(value ?? '');
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 1))}…`;
}

export function buildFaqListQuery({
  q,
  status,
  page,
  pageSize,
  sortBy,
  sortOrder
}) {
  return new URLSearchParams({
    q,
    status,
    page: String(page),
    page_size: String(pageSize),
    sort_by: sortBy,
    sort_order: sortOrder
  }).toString();
}

export function parseMetadataInput(rawValue) {
  return parseFaqMetadataInput(rawValue);
}

export function createFaqListState() {
  return { phase: 'idle', data: [], total: 0, message: '' };
}

export function reduceFaqListState(state, event) {
  switch (event.type) {
    case 'LOAD':
      return { ...state, phase: 'loading', message: '' };
    case 'SUCCESS':
      return {
        phase: event.data.length > 0
          ? 'ready'
          : event.filtered ? 'zero-results' : 'empty',
        data: event.data,
        total: event.total,
        message: ''
      };
    case 'ERROR':
      return { ...state, phase: 'error', message: event.message };
    default:
      return state;
  }
}

export function faqFormMode(isEdit) {
  return {
    keyReadOnly: isEdit,
    showCreateStatus: !isEdit
  };
}

export function classifyFaqApiError(payload) {
  const code = payload?.error?.code;
  if (code === 'FAQ_VERSION_CONFLICT') {
    return {
      kind: 'version-conflict',
      message: 'Data FAQ telah berubah. Muat ulang sebelum melanjutkan.'
    };
  }
  if (code === 'AI_PROVIDER_ERROR') {
    return {
      kind: 'provider',
      message: 'Embedding belum dapat dibuat. Perubahan Anda belum disimpan.'
    };
  }

  return {
    kind: code === 'VALIDATION_ERROR' ? 'validation' : 'general',
    message: payload?.error?.message ?? 'Terjadi gangguan. Silakan coba kembali.'
  };
}
