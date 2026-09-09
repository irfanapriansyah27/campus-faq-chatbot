import { readSecurityCookie } from './security-cookie.js';
import { formatFaqMetadata } from './faq-metadata.js';
import {
  buildFaqListQuery,
  classifyFaqApiError,
  createAdminRequester,
  createFaqListState,
  createFaqQueryState,
  createLatestRequestCoordinator,
  faqFormMode,
  formatFaqDate,
  parseMetadataInput,
  reduceFaqListState,
  requestFaqPageWithClamp,
  resetAdminSensitiveView,
  resetAdminSessionState,
  statusLabel,
  truncateText
} from './faq-ui.js';

const authView = document.querySelector('#auth-view');
const consoleView = document.querySelector('#console-view');
const loginForm = document.querySelector('#login-form');
const statusMessage = document.querySelector('#status-message');
const adminEmail = document.querySelector('#admin-email');
const logoutButton = document.querySelector('#logout-button');
const globalNotice = document.querySelector('#global-notice');

const listView = document.querySelector('#list-view');
const listControls = document.querySelector('#list-controls');
const searchInput = document.querySelector('#faq-search');
const statusFilter = document.querySelector('#status-filter');
const sortControl = document.querySelector('#sort-control');
const resultCount = document.querySelector('#result-count');
const listLoading = document.querySelector('#list-loading');
const listEmpty = document.querySelector('#list-empty');
const emptyTitle = document.querySelector('#empty-title');
const emptyDescription = document.querySelector('#empty-description');
const listError = document.querySelector('#list-error');
const listErrorMessage = document.querySelector('#list-error-message');
const retryListButton = document.querySelector('#retry-list-button');
const tableRegion = document.querySelector('#faq-table-region');
const tableBody = document.querySelector('#faq-table-body');
const pagination = document.querySelector('#pagination');
const previousPageButton = document.querySelector('#previous-page');
const nextPageButton = document.querySelector('#next-page');
const pageIndicator = document.querySelector('#page-indicator');
const addFaqButton = document.querySelector('#add-faq-button');

const editorView = document.querySelector('#editor-view');
const editorTitle = document.querySelector('#editor-title');
const editorDescription = document.querySelector('#editor-description');
const editorStatusBadge = document.querySelector('#editor-status-badge');
const editorLoading = document.querySelector('#editor-loading');
const editorNotFound = document.querySelector('#editor-not-found');
const faqForm = document.querySelector('#faq-form');
const faqKeyInput = document.querySelector('#faq-key');
const questionInput = document.querySelector('#faq-question');
const answerInput = document.querySelector('#faq-answer');
const categoryInput = document.querySelector('#faq-category');
const sourceInput = document.querySelector('#faq-source');
const createStatusField = document.querySelector('#create-status-field');
const createStatusInput = document.querySelector('#create-status');
const metadataInput = document.querySelector('#faq-metadata');
const editStatusSection = document.querySelector('#edit-status-section');
const statusGuidance = document.querySelector('#status-guidance');
const statusActions = document.querySelector('#status-actions');
const formErrorSummary = document.querySelector('#form-error-summary');
const versionConflict = document.querySelector('#version-conflict');
const reloadConflictButton = document.querySelector('#reload-conflict-button');
const saveFaqButton = document.querySelector('#save-faq-button');
const cancelEditButton = document.querySelector('#cancel-edit-button');
const backToListButton = document.querySelector('#back-to-list');
const archiveDialog = document.querySelector('#archive-dialog');
const confirmArchiveButton = document.querySelector('#confirm-archive-button');

const fieldErrorElements = Object.freeze({
  faq_key: document.querySelector('#faq-key-error'),
  question: document.querySelector('#question-error'),
  answer: document.querySelector('#answer-error'),
  category: document.querySelector('#category-error'),
  source: document.querySelector('#source-error'),
  metadata: document.querySelector('#metadata-error')
});

const state = {
  admin: null,
  list: createFaqListState(),
  query: createFaqQueryState(),
  pageMeta: null,
  editing: null,
  formBusy: false
};
const requestCoordinator = createLatestRequestCoordinator();

function mutationHeaders(includeJson = false) {
  return {
    ...(includeJson ? { 'Content-Type': 'application/json' } : {}),
    'x-csrf-token': readSecurityCookie(document.cookie, 'campus_admin_csrf')
  };
}

async function requestJson(path, options = {}) {
  const response = await fetch(path, {
    credentials: 'same-origin',
    ...options
  });
  const payload = response.status === 204 ? null : await response.json().catch(() => null);
  return { response, payload };
}

function resetLoginView(message) {
  resetAdminSensitiveView({
    message,
    auth: {
      authView,
      consoleView,
      loginForm,
      loginSubmit: loginForm.querySelector('button[type="submit"]'),
      statusMessage,
      adminEmail,
      logoutButton
    },
    list: {
      view: listView,
      controls: listControls,
      resultCount,
      errorMessage: listErrorMessage,
      pageIndicator,
      loading: listLoading,
      empty: listEmpty,
      error: listError,
      tableRegion,
      pagination,
      tableBody
    },
    editor: {
      view: editorView,
      form: faqForm,
      keyInput: faqKeyInput,
      questionInput,
      answerInput,
      categoryInput,
      sourceInput,
      metadataInput,
      statusActions,
      statusBadge: editorStatusBadge,
      loading: editorLoading,
      notFound: editorNotFound,
      editStatusSection,
      saveButton: saveFaqButton,
      archiveDialog
    },
    feedback: {
      notice: globalNotice,
      formErrorSummary,
      versionConflict,
      fieldErrors: fieldErrorElements
    }
  });
}

function showLogin(message = 'Silakan masuk menggunakan akun admin.') {
  resetAdminSessionState({
    state,
    requestCoordinator,
    resetView: resetLoginView,
    message
  });
}

function showConsole(data) {
  state.admin = data;
  authView.hidden = true;
  consoleView.hidden = false;
  adminEmail.textContent = data.user.email ?? data.user.id;
}

async function refreshSession(signal) {
  const { response, payload } = await requestJson('/api/admin/auth/refresh', {
    method: 'POST',
    headers: mutationHeaders(),
    signal
  });

  if (!response.ok || signal?.aborted) return false;
  showConsole(payload.data);
  return true;
}

const adminRequest = createAdminRequester({
  requestJson,
  refreshSession,
  readCsrfToken: () => readSecurityCookie(document.cookie, 'campus_admin_csrf'),
  onAuthLost: () => showLogin('Session berakhir. Silakan masuk kembali.')
});

function showNotice(message, kind = 'success') {
  globalNotice.textContent = message;
  globalNotice.dataset.kind = kind;
  globalNotice.hidden = false;
}

function hideNotice() {
  globalNotice.hidden = true;
  globalNotice.textContent = '';
  delete globalNotice.dataset.kind;
}

function createStatusBadge(status) {
  const badge = document.createElement('span');
  badge.className = 'status-badge';
  badge.dataset.status = status;
  badge.textContent = statusLabel(status);
  return badge;
}

function createFaqRow(faq) {
  const row = document.createElement('tr');
  const questionCell = document.createElement('td');
  const question = document.createElement('strong');
  const answerPreview = document.createElement('span');
  const categoryCell = document.createElement('td');
  const statusCell = document.createElement('td');
  const updatedCell = document.createElement('td');
  const actionCell = document.createElement('td');
  const openButton = document.createElement('button');

  questionCell.className = 'question-cell';
  question.textContent = faq.question;
  answerPreview.textContent = truncateText(faq.answer, 140);
  questionCell.append(question, answerPreview);
  categoryCell.textContent = faq.category;
  statusCell.append(createStatusBadge(faq.status));
  updatedCell.textContent = formatFaqDate(faq.updated_at);
  openButton.className = 'button secondary-button';
  openButton.type = 'button';
  openButton.textContent = 'Buka';
  openButton.addEventListener('click', () => openEditor(faq.id));
  actionCell.append(openButton);
  row.append(questionCell, categoryCell, statusCell, updatedCell, actionCell);
  return row;
}

function renderListState() {
  const phase = state.list.phase;
  listLoading.hidden = phase !== 'loading';
  listEmpty.hidden = !['empty', 'zero-results'].includes(phase);
  listError.hidden = phase !== 'error';
  tableRegion.hidden = phase !== 'ready';
  pagination.hidden = phase !== 'ready' || (state.pageMeta?.total_pages ?? 0) <= 1;

  if (phase === 'loading') {
    resultCount.textContent = 'Memuat FAQ…';
    return;
  }
  if (phase === 'error') {
    resultCount.textContent = 'Daftar belum tersedia';
    listErrorMessage.textContent = state.list.message;
    return;
  }
  if (phase === 'empty') {
    resultCount.textContent = '0 FAQ';
    emptyTitle.textContent = 'Belum ada FAQ';
    emptyDescription.textContent = 'Tambahkan FAQ pertama untuk memulai.';
    return;
  }
  if (phase === 'zero-results') {
    resultCount.textContent = '0 hasil';
    emptyTitle.textContent = 'Tidak ada FAQ yang sesuai';
    emptyDescription.textContent = 'Ubah kata pencarian atau filter status.';
    return;
  }
  if (phase !== 'ready') return;

  tableBody.replaceChildren(...state.list.data.map(createFaqRow));
  resultCount.textContent = `${state.pageMeta.total} FAQ`;
  pageIndicator.textContent = `Halaman ${state.pageMeta.page} dari ${state.pageMeta.total_pages}`;
  previousPageButton.disabled = state.pageMeta.page <= 1;
  nextPageButton.disabled = state.pageMeta.page >= state.pageMeta.total_pages;
}

async function loadFaqs() {
  const operation = requestCoordinator.begin('list');
  state.list = reduceFaqListState(state.list, { type: 'LOAD' });
  renderListState();

  const query = { ...state.query };
  try {
    const pageLoad = await requestFaqPageWithClamp({
      page: query.page,
      requestPage: (page) => adminRequest(
        `/api/admin/faqs?${buildFaqListQuery({ ...query, page })}`,
        { signal: operation.signal }
      )
    });
    if (!operation.isCurrent()) return;

    state.query.page = pageLoad.page;
    const { response, payload, authLost } = pageLoad.result;
    if (authLost || !operation.isCurrent()) return;
    if (!response.ok) {
      const error = classifyFaqApiError(payload);
      state.list = reduceFaqListState(state.list, {
        type: 'ERROR',
        message: error.message
      });
      renderListState();
      return;
    }

    state.pageMeta = payload.meta;
    const filtered = Boolean(state.query.q) || state.query.status !== 'all';
    state.list = reduceFaqListState(state.list, {
      type: 'SUCCESS',
      data: payload.data,
      total: payload.meta.total,
      filtered
    });
    renderListState();
  } catch {
    if (!operation.isCurrent()) return;
    state.list = reduceFaqListState(state.list, {
      type: 'ERROR',
      message: 'Layanan FAQ sedang tidak tersedia. Silakan coba kembali.'
    });
    renderListState();
  }
}

function clearFormErrors() {
  formErrorSummary.hidden = true;
  formErrorSummary.textContent = '';
  versionConflict.hidden = true;
  for (const element of Object.values(fieldErrorElements)) {
    element.textContent = '';
  }
}

function showFormError(message) {
  formErrorSummary.textContent = message;
  formErrorSummary.hidden = false;
}

function showValidationErrors(details = []) {
  for (const detail of details) {
    const field = detail.field.split('.').at(-1);
    if (fieldErrorElements[field]) {
      fieldErrorElements[field].textContent = detail.message;
    }
  }
  showFormError('Periksa kembali field yang ditandai.');
}

function setFormBusy(busy) {
  state.formBusy = busy;
  for (const element of faqForm.elements) {
    element.disabled = busy;
  }
  saveFaqButton.textContent = busy
    ? 'Menyimpan…'
    : state.editing ? 'Simpan perubahan' : createStatusInput.value === 'published'
      ? 'Terbitkan FAQ'
      : 'Simpan draf';
}

function renderEditorStatus(faq) {
  state.editing = faq;
  editorStatusBadge.hidden = false;
  editorStatusBadge.dataset.status = faq.status;
  editorStatusBadge.textContent = statusLabel(faq.status);
  statusActions.replaceChildren();

  const actionsByStatus = {
    draft: [
      { status: 'published', label: 'Terbitkan' },
      { status: 'archived', label: 'Arsipkan' }
    ],
    published: [
      { status: 'draft', label: 'Jadikan draf' },
      { status: 'archived', label: 'Arsipkan' }
    ],
    archived: [{ status: 'draft', label: 'Pulihkan ke draf' }]
  };

  for (const action of actionsByStatus[faq.status] ?? []) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = action.status === 'archived'
      ? 'button secondary-button'
      : 'button primary-button';
    button.textContent = action.label;
    button.addEventListener('click', () => {
      if (action.status === 'archived') {
        archiveDialog.showModal();
      } else {
        changeStatus(action.status);
      }
    });
    statusActions.append(button);
  }

  statusGuidance.textContent = faq.status === 'archived'
    ? 'Pulihkan FAQ ke draf sebelum dapat diterbitkan kembali.'
    : 'Status menentukan apakah FAQ dapat digunakan oleh chatbot.';
}

function populateEditForm(faq) {
  const mode = faqFormMode(true);
  faqKeyInput.value = faq.faq_key;
  faqKeyInput.readOnly = mode.keyReadOnly;
  questionInput.value = faq.question;
  answerInput.value = faq.answer;
  categoryInput.value = faq.category;
  sourceInput.value = faq.source;
  metadataInput.value = formatFaqMetadata(faq.metadata);
  createStatusField.hidden = !mode.showCreateStatus;
  editStatusSection.hidden = false;
  editorTitle.textContent = 'Edit FAQ';
  editorDescription.textContent = 'Perbarui informasi FAQ tanpa mengubah FAQ key.';
  saveFaqButton.textContent = 'Simpan perubahan';
  renderEditorStatus(faq);
}

function prepareCreateForm() {
  const mode = faqFormMode(false);
  state.editing = null;
  faqForm.reset();
  faqKeyInput.readOnly = mode.keyReadOnly;
  createStatusInput.value = 'draft';
  metadataInput.value = '{}';
  createStatusField.hidden = !mode.showCreateStatus;
  editStatusSection.hidden = true;
  editorStatusBadge.hidden = true;
  editorTitle.textContent = 'Tambah FAQ';
  editorDescription.textContent = 'Simpan informasi kampus sebagai draf atau terbitkan secara eksplisit.';
  saveFaqButton.textContent = 'Simpan draf';
}

function showEditorView() {
  hideNotice();
  listView.hidden = true;
  editorView.hidden = false;
  editorNotFound.hidden = true;
  clearFormErrors();
  window.scrollTo({ top: 0, behavior: 'auto' });
}

async function openEditor(id = null) {
  showEditorView();
  if (!id) {
    requestCoordinator.invalidate('detail');
    editorLoading.hidden = true;
    faqForm.hidden = false;
    prepareCreateForm();
    faqKeyInput.focus();
    return;
  }

  const operation = requestCoordinator.begin('detail');
  editorLoading.hidden = false;
  faqForm.hidden = true;
  try {
    const { response, payload, authLost } = await adminRequest(
      `/api/admin/faqs/${id}`,
      { signal: operation.signal }
    );
    if (authLost || !operation.isCurrent()) return;
    editorLoading.hidden = true;
    if (response.status === 404) {
      editorNotFound.hidden = false;
      return;
    }
    if (!response.ok) {
      editorNotFound.hidden = false;
      return;
    }

    faqForm.hidden = false;
    populateEditForm(payload.data);
    questionInput.focus();
  } catch {
    if (!operation.isCurrent()) return;
    editorLoading.hidden = true;
    editorNotFound.hidden = false;
  }
}

async function changeStatus(targetStatus) {
  if (!state.editing || state.formBusy) return;
  clearFormErrors();
  setFormBusy(true);
  const operation = requestCoordinator.begin('mutation');

  try {
    const { response, payload, authLost } = await adminRequest(
      `/api/admin/faqs/${state.editing.id}/status`,
      {
        method: 'PATCH',
        headers: mutationHeaders(true),
        body: JSON.stringify({
          status: targetStatus,
          expected_version: state.editing.version
        }),
        signal: operation.signal
      }
    );
    if (authLost || !operation.isCurrent()) return;
    if (!response.ok) {
      handleFormApiError(response, payload);
      return;
    }

    renderEditorStatus(payload.data);
    showNotice(`Status FAQ diubah menjadi ${statusLabel(payload.data.status)}.`);
    await loadFaqs();
  } catch {
    if (!operation.isCurrent()) return;
    showFormError('Status FAQ belum dapat diperbarui. Silakan coba kembali.');
  } finally {
    if (operation.isCurrent()) setFormBusy(false);
  }
}

function handleFormApiError(response, payload) {
  const classified = classifyFaqApiError(payload);
  if (classified.kind === 'validation') {
    showValidationErrors(payload?.error?.details);
    return;
  }
  if (classified.kind === 'version-conflict') {
    versionConflict.hidden = false;
    return;
  }
  if (response.status === 404) {
    faqForm.hidden = true;
    editorNotFound.hidden = false;
    return;
  }
  showFormError(classified.message);
}

async function saveFaq(event) {
  event.preventDefault();
  if (state.formBusy) return;
  clearFormErrors();

  if (!faqForm.checkValidity()) {
    faqForm.reportValidity();
    showFormError('Lengkapi field wajib dengan format yang benar.');
    return;
  }

  const metadata = parseMetadataInput(metadataInput.value);
  if (!metadata.ok) {
    fieldErrorElements.metadata.textContent = metadata.message;
    showFormError('Periksa kembali metadata FAQ.');
    return;
  }

  const basePayload = {
    question: questionInput.value,
    answer: answerInput.value,
    category: categoryInput.value,
    source: sourceInput.value,
    metadata: metadata.value
  };
  const isEdit = Boolean(state.editing);
  const path = isEdit ? `/api/admin/faqs/${state.editing.id}` : '/api/admin/faqs';
  const payload = isEdit
    ? { ...basePayload, expected_version: state.editing.version }
    : {
        faq_key: faqKeyInput.value,
        ...basePayload,
        status: createStatusInput.value
      };

  setFormBusy(true);
  const operation = requestCoordinator.begin('mutation');
  try {
    const result = await adminRequest(path, {
      method: isEdit ? 'PUT' : 'POST',
      headers: mutationHeaders(true),
      body: JSON.stringify(payload),
      signal: operation.signal
    });
    if (result.authLost || !operation.isCurrent()) return;
    if (!result.response.ok) {
      handleFormApiError(result.response, result.payload);
      return;
    }

    if (isEdit) {
      populateEditForm(result.payload.data);
      showNotice('Perubahan FAQ berhasil disimpan.');
    } else {
      showListView();
      showNotice('FAQ berhasil dibuat.');
    }
    await loadFaqs();
  } catch {
    if (!operation.isCurrent()) return;
    showFormError('FAQ belum dapat disimpan. Isian Anda tetap tersedia.');
  } finally {
    if (operation.isCurrent()) setFormBusy(false);
  }
}

function showListView() {
  requestCoordinator.invalidate('detail');
  editorView.hidden = true;
  listView.hidden = false;
  editorNotFound.hidden = true;
  editorLoading.hidden = true;
  faqForm.hidden = false;
  window.scrollTo({ top: 0, behavior: 'auto' });
}

async function initialize() {
  const operation = requestCoordinator.begin('auth');
  loginForm.hidden = true;
  try {
    const { response, payload } = await requestJson('/api/admin/auth/session', {
      signal: operation.signal
    });
    if (!operation.isCurrent()) return;
    if (response.ok) {
      showConsole(payload.data);
      await loadFaqs();
      return;
    }

    const refreshed = await refreshSession(operation.signal);
    if (refreshed && operation.isCurrent()) {
      await loadFaqs();
      return;
    }
    if (!operation.isCurrent()) return;
    showLogin('Session berakhir. Silakan masuk kembali.');
  } catch {
    if (!operation.isCurrent()) return;
    showLogin('Layanan autentikasi sedang tidak tersedia. Silakan coba kembali.');
  }
}

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const submitButton = loginForm.querySelector('button[type="submit"]');
  submitButton.disabled = true;
  const operation = requestCoordinator.begin('auth');
  statusMessage.textContent = 'Memverifikasi akun…';

  try {
    const formData = new FormData(loginForm);
    const { response, payload } = await requestJson('/api/admin/auth/login', {
      method: 'POST',
      headers: mutationHeaders(true),
      body: JSON.stringify({
        email: String(formData.get('email') ?? ''),
        password: String(formData.get('password') ?? '')
      }),
      signal: operation.signal
    });
    if (!operation.isCurrent()) return;

    if (!response.ok) {
      showLogin(payload?.error?.message ?? 'Login gagal. Silakan coba kembali.');
      return;
    }

    loginForm.reset();
    showConsole(payload.data);
    await loadFaqs();
  } catch {
    if (!operation.isCurrent()) return;
    showLogin('Layanan autentikasi sedang tidak tersedia. Silakan coba kembali.');
  } finally {
    if (operation.isCurrent()) submitButton.disabled = false;
  }
});

logoutButton.addEventListener('click', async () => {
  const operation = requestCoordinator.begin('logout');
  requestCoordinator.invalidate('auth');
  requestCoordinator.invalidate('list');
  requestCoordinator.invalidate('detail');
  requestCoordinator.invalidate('mutation');
  logoutButton.disabled = true;
  try {
    await requestJson('/api/admin/auth/logout', {
      method: 'POST',
      headers: mutationHeaders(),
      signal: operation.signal
    });
  } catch {
    // Local session data is cleared even when the best-effort server logout fails.
  } finally {
    if (!operation.isCurrent()) return;
    logoutButton.disabled = false;
    showLogin('Anda telah keluar.');
  }
});

listControls.addEventListener('submit', (event) => {
  event.preventDefault();
  state.query.q = searchInput.value.trim();
  state.query.page = 1;
  loadFaqs();
});

statusFilter.addEventListener('change', () => {
  state.query.status = statusFilter.value;
  state.query.page = 1;
  loadFaqs();
});

sortControl.addEventListener('change', () => {
  const [sortBy, sortOrder] = sortControl.value.split(':');
  state.query.sortBy = sortBy;
  state.query.sortOrder = sortOrder;
  state.query.page = 1;
  loadFaqs();
});

previousPageButton.addEventListener('click', () => {
  if (state.query.page <= 1) return;
  state.query.page -= 1;
  loadFaqs();
});

nextPageButton.addEventListener('click', () => {
  if (state.query.page >= (state.pageMeta?.total_pages ?? 0)) return;
  state.query.page += 1;
  loadFaqs();
});

retryListButton.addEventListener('click', loadFaqs);
addFaqButton.addEventListener('click', () => openEditor());
faqForm.addEventListener('submit', saveFaq);
createStatusInput.addEventListener('change', () => setFormBusy(false));
backToListButton.addEventListener('click', showListView);
cancelEditButton.addEventListener('click', showListView);
reloadConflictButton.addEventListener('click', () => {
  if (state.editing) openEditor(state.editing.id);
});
confirmArchiveButton.addEventListener('click', (event) => {
  event.preventDefault();
  archiveDialog.close();
  changeStatus('archived');
});

initialize();
