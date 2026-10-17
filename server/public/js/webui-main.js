import { DropgateError, hosts, lifetime, sizes } from './dropgate-core.js';
import { formatBytes, pageClient } from './page-common.js';

const $ = (id) => document.getElementById(id);

const els = {
  tagline: $('tagline'),
  dropzone: $('dropzone'),
  selectFileBtn: $('selectFileBtn'),
  fileInput: $('fileInput'),
  dzEmpty: $('dzEmpty'),
  dzHasFiles: $('dzHasFiles'),
  dzFileCount: $('dzFileCount'),
  browseMoreBtn: $('browseMoreBtn'),
  btnClearAll: $('btnClearAll'),
  fileListSection: $('fileListSection'),
  fileListContainer: $('fileListContainer'),
  fileChosenTotal: $('fileChosenTotal'),
  maxUploadHint: $('maxUploadHint'),

  modeStandard: $('modeStandard'),
  modeP2P: $('modeP2P'),
  optUploadMode: $('optUploadMode'),

  optLifetime: $('optLifetime'),
  lifetimeValue: $('lifetimeValue'),
  lifetimeUnit: $('lifetimeUnit'),
  lifetimeHelp: $('lifetimeHelp'),

  optMaxDownloads: $('optMaxDownloads'),
  maxDownloadsValue: $('maxDownloadsValue'),
  maxDownloadsHelp: $('maxDownloadsHelp'),

  securityStatus: $('securityStatus'),
  securityIcon: $('securityIcon'),
  securityText: $('securityText'),
  insecureUploadModal: $('insecureUploadModal'),
  insecureModalBody: $('insecureModalBody'),
  confirmInsecureUpload: $('confirmInsecureUpload'),

  p2pInfo: $('p2pInfo'),
  startBtn: $('startBtn'),
  codeCard: $('codeCard'),

  panels: $('panels'),
  progressCard: $('progressCard'),
  progressIcon: $('progressIcon'),
  progressTitle: $('progressTitle'),
  progressSub: $('progressSub'),
  progressFill: $('progressFill'),
  progressBytes: $('progressBytes'),
  pauseStandardUpload: $('pauseStandardUpload'),
  resumeStandardUpload: $('resumeStandardUpload'),
  cancelStandardUpload: $('cancelStandardUpload'),
  cancelP2PSend: $('cancelP2PSend'),

  p2pWaitCard: $('p2pWaitCard'),
  p2pCode: $('p2pCode'),
  p2pLinkLabel: $('p2pLinkLabel'),
  p2pLink: $('p2pLink'),
  copyP2PLink: $('copyP2PLink'),
  qrP2PLink: $('qrP2PLink'),
  cancelP2P: $('cancelP2P'),

  shareCard: $('shareCard'),
  shareIcon: $('shareIcon'),
  shareTitle: $('shareTitle'),
  shareSub: $('shareSub'),
  shareLinkGroup: $('shareLinkGroup'),
  shareLink: $('shareLink'),
  copyShare: $('copyShare'),
  qrShare: $('qrShare'),
  newUpload: $('newUpload'),
  deleteUpload: $('deleteUpload'),
  deleteUploadModal: $('deleteUploadModal'),
  confirmDeleteUpload: $('confirmDeleteUpload'),

  qrModal: $('qrModal'),
  qrCanvas: $('qrCanvas'),

  codeInput: $('codeInput'),
  codeGo: $('codeGo'),
  toastHost: $('toast-host'),
};

const state = {
  info: null,
  files: [],
  fileTooLargeForStandard: false,
  mode: 'standard',
  encrypt: true,
  uploadEnabled: false,
  p2pEnabled: false,
  maxSizeMB: null,
  maxLifetimeHours: null,
  maxFileDownloads: 1,
  e2ee: false,
  peerjsPath: '/peerjs',
  iceServers: [{ urls: ['stun:stun.cloudflare.com:3478'] }],
  p2pSession: null,
  p2pSecureOk: true,
  upload: null,
  // The upload just finished, with the manage token that deletes it: held in
  // this page's memory only, so a reload or "Send More Files" drops it.
  uploaded: null,
};

// Title progress tracking
const originalTitle = document.title;
let currentTransferProgress = null; // { percent, doneBytes, totalBytes }

const updateTitleProgress = (percent) => {
  if (percent > 1 && percent < 100) {
    document.title = `${Math.floor(percent)}% - ${originalTitle}`;
  } else {
    document.title = originalTitle;
  }
};

const resetTitleProgress = () => {
  document.title = originalTitle;
  currentTransferProgress = null;
};

// Visibility change handler - sync UI immediately when tab becomes visible
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && currentTransferProgress) {
    // Tab became visible and we have an active transfer
    // Force UI update with current progress
    const { percent, doneBytes, totalBytes, showProgress: showProgressFn } = currentTransferProgress;
    if (showProgressFn) {
      showProgressFn(percent, doneBytes, totalBytes);
    }
  }
});

const coreClient = pageClient();

function isFile(file) {
  return new Promise((resolve) => {
    if (file.type !== '') return resolve(true);
    const reader = new FileReader();
    reader.onloadend = () => resolve(!reader.error);
    reader.readAsArrayBuffer(file);
  });
}

/** Each toast type's glyph, as electron-kit's. */
const TOAST_ICONS = { info: 'info', success: 'check_circle', warning: 'warning', danger: 'error' };

/** How long a toast stays: electron-kit's --timing-toast. */
const TOAST_MS = 4500;

/**
 * Show a toast, as electron-kit's kit.ui.toast() does: under the others, for
 * 4.5 s or until its close button is pressed. A danger toast is announced at
 * once (role="alert"); the rest politely, through the host's live region. The
 * message is text, never markup.
 * @param {string} text
 * @param {'info' | 'success' | 'warning' | 'danger'} [type]
 */
function showToast(text, type = 'info') {
  if (!Object.hasOwn(TOAST_ICONS, type)) type = 'info';
  const icon = document.createElement('span');
  icon.className = 'material-icons-round toast-icon';
  icon.setAttribute('aria-hidden', 'true');
  icon.textContent = TOAST_ICONS[type];

  const body = document.createElement('div');
  body.className = 'toast-body';
  body.textContent = String(text || '');

  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'toast-close';
  close.title = 'Dismiss';
  close.setAttribute('aria-label', 'Dismiss');
  close.innerHTML = '<span class="material-icons-round" aria-hidden="true">close</span>';

  const note = document.createElement('div');
  note.className = `toast-note toast-${type}`;
  if (type === 'danger') note.setAttribute('role', 'alert');
  note.append(icon, body, close);
  els.toastHost.append(note);

  let closed = false;
  const dismiss = () => {
    if (closed) return;
    closed = true;
    clearTimeout(timer);
    note.classList.add('leaving');
    const gone = () => note.remove();
    note.addEventListener('transitionend', gone, { once: true });
    // In case nothing transitions (reduced motion, a hidden page).
    setTimeout(gone, 1000);
  };
  close.addEventListener('click', dismiss);
  const timer = setTimeout(dismiss, TOAST_MS);
}

function setHidden(el, hidden) {
  if (!el) return;
  if (hidden) el.setAttribute('hidden', '');
  else el.removeAttribute('hidden');
}

function setDisabled(el, disabled) {
  if (!el) return;
  if (disabled) {
    el.setAttribute('disabled', '');
    el.classList.add('disabled');
  } else {
    el.removeAttribute('disabled');
    el.classList.remove('disabled');
  }
}

function setSelected(btnA, btnB, aSelected) {
  btnA?.classList.toggle("active", aSelected);
  btnB?.classList.toggle("active", !aSelected);
  btnA?.setAttribute("aria-selected", aSelected ? "true" : "false");
  btnB?.setAttribute("aria-selected", !aSelected ? "true" : "false");
}

function normalizeCode(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  // If a full URL was pasted, keep it as-is
  if (/^https?:\/\//i.test(s)) return s;
  // Strip spaces
  const compact = s.replace(/\s+/g, '');
  // Uppercase codes like abcd-1234
  if (/^[a-z0-9-]{4,20}$/i.test(compact)) return compact.toUpperCase();
  return compact;
}

function showPanels(which) {
  // which: 'main' | 'progress' | 'p2pwait' | 'share'
  setHidden(els.panels, which !== 'main');
  setHidden(els.progressCard, which !== 'progress');
  setHidden(els.p2pWaitCard, which !== 'p2pwait');
  setHidden(els.shareCard, which !== 'share');
  // Hide code card when not in main view
  setHidden(els.codeCard, which !== 'main');
}

function updateFileUI() {
  const count = state.files.length;
  const isEmpty = count === 0;

  els.dropzone?.classList.remove('dragover');

  // Toggle drop zone states
  if (els.dzEmpty) els.dzEmpty.classList.toggle('d-none', !isEmpty);
  if (els.dzHasFiles) els.dzHasFiles.classList.toggle('d-none', isEmpty);
  if (els.fileListSection) els.fileListSection.classList.toggle('d-none', isEmpty);

  if (isEmpty) return;

  if (els.dzFileCount) els.dzFileCount.textContent = count === 1 ? '1 File Selected' : `${count} Files Selected`;

  els.fileListContainer.innerHTML = '';
  for (let i = 0; i < state.files.length; i++) {
    const f = state.files[i];

    const row = document.createElement('div');
    row.className = 'file-row';

    const icon = document.createElement('span');
    icon.className = 'material-icons-round text-secondary';
    icon.textContent = 'insert_drive_file';

    const name = document.createElement('span');
    name.className = 'file-row-name';
    name.textContent = f.name;
    name.title = f.name;

    const size = document.createElement('span');
    size.className = 'file-row-size';
    size.textContent = formatBytes(f.size);

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'file-remove-btn';
    removeBtn.title = 'Remove file';
    removeBtn.innerHTML = '<span class="material-icons-round">close</span>';
    removeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      state.files.splice(i, 1);
      updateFileUI();
      state.fileTooLargeForStandard = Boolean(state.files.length && areFilesTooLargeForStandard(state.files));
      updateStartEnabled();
    });

    row.appendChild(icon);
    row.appendChild(name);
    row.appendChild(size);
    row.appendChild(removeBtn);
    els.fileListContainer.appendChild(row);
  }

  const totalSize = state.files.reduce((sum, f) => sum + f.size, 0);
  els.fileChosenTotal.textContent = `Total: ${formatBytes(totalSize)}`;
}

function areFilesTooLargeForStandard(files) {
  if (!files.length || !state.uploadEnabled) return false;
  // The server's limit counts in 1024s.
  const maxBytes = Number.isFinite(state.maxSizeMB) && state.maxSizeMB > 0
    ? state.maxSizeMB * 1024 * 1024
    : null;
  if (!maxBytes) return false;
  // One file or several, an upload is stored as one object, checked whole.
  const totalSize = files.reduce((sum, f) => sum + f.size, 0);
  return sizes.estimateUpload(totalSize, { encrypted: Boolean(state.encrypt), chunkSize: state.info?.capabilities?.upload?.chunkSize, maxBytes }) > maxBytes;
}

function updateStartEnabled() {
  const hasFile = state.files.length > 0;
  if (state.mode === 'standard') {
    const lifetimeOk = validateLifetimeInput();
    const maxDownloadsOk = validateMaxDownloadsInput();
    const canUpload = state.uploadEnabled && !state.fileTooLargeForStandard && lifetimeOk && maxDownloadsOk;
    setDisabled(els.startBtn, !(hasFile && canUpload));
  } else {
    const canP2P = state.p2pEnabled && state.p2pSecureOk;
    setDisabled(els.startBtn, !(hasFile && canP2P));
  }
}

function handleFileSelection(files) {
  if (!files || files.length === 0) {
    state.files = [];
  } else {
    const incoming = Array.from(files);

    // Filter out empty (0-byte) files
    const valid = incoming.filter(f => f.size > 0);
    const skipped = incoming.length - valid.length;
    if (skipped > 0) {
      showToast(`Skipped ${skipped} empty (0 byte) file${skipped > 1 ? 's' : ''}.`, 'warning');
    }
    if (valid.length === 0) return;

    // Append new files to existing selection
    state.files = [...state.files, ...valid];
  }
  updateFileUI();

  state.fileTooLargeForStandard = false;
  if (state.files.length && state.mode === 'standard' && areFilesTooLargeForStandard(state.files)) {
    state.fileTooLargeForStandard = true;
    if (state.p2pEnabled && state.p2pSecureOk) {
      setMode('p2p');
      showToast('Files exceed the server upload limit — using direct transfer.');
    } else {
      showToast('Files exceed the server upload limit and cannot be uploaded.', 'danger');
    }
  }

  updateStartEnabled();
}

function setMode(mode) {
  state.mode = mode;
  const isStandard = mode === 'standard';

  setSelected(els.modeStandard, els.modeP2P, isStandard);

  // Options shown in Standard mode only
  setHidden(els.optLifetime, !isStandard);
  setHidden(els.optMaxDownloads, !isStandard || !state.uploadEnabled);
  updateSecurityStatus();
  setHidden(els.p2pInfo, isStandard);

  if (isStandard) {
    els.startBtn.textContent = 'Start Upload';
  } else {
    els.startBtn.textContent = 'Start Transfer';
  }

  state.fileTooLargeForStandard = Boolean(state.files.length && areFilesTooLargeForStandard(state.files));
  if (state.fileTooLargeForStandard && isStandard) {
    if (state.p2pEnabled && state.p2pSecureOk) {
      showToast('File exceeds the server upload limit — using direct transfer.');
      state.fileTooLargeForStandard = false;
      setMode('p2p');
      return;
    }
    showToast('File exceeds the server upload limit and cannot be uploaded.', 'danger');
  }

  updateStartEnabled();
}

/**
 * Update the security status card based on E2EE and HTTPS availability.
 */
function updateSecurityStatus() {
  const icon = els.securityIcon;
  const text = els.securityText;
  const card = els.securityStatus;

  if (!icon || !text || !card) return;

  // Hide if uploads are disabled or in P2P mode
  if (!state.uploadEnabled || state.mode === 'p2p') {
    card.style.display = 'none';
    return;
  }
  card.style.display = 'flex'; // Ensure it's visible otherwise

  const isHttps = location.protocol === 'https:';
  const hasE2EE = state.uploadEnabled && state.e2ee && window.isSecureContext;

  if (hasE2EE) {
    // Green: Full E2EE
    icon.textContent = 'verified';
    icon.className = 'material-icons-round text-success';
    text.textContent = 'Your upload will be end-to-end encrypted.';
    card.className = 'security-status-card security-green mb-3';
  } else if (isHttps) {
    // Yellow: HTTPS but no E2EE
    icon.textContent = 'warning';
    icon.className = 'material-icons-round text-warning';
    text.textContent = "This server doesn't support encryption. Your upload is protected in transit via HTTPS.";
    card.className = 'security-status-card security-yellow mb-3';
  } else {
    // Red: HTTP, no encryption at all
    icon.textContent = 'gpp_bad';
    icon.className = 'material-icons-round text-danger';
    text.textContent = 'This connection is not secure. Your upload will not be encrypted.';
    card.className = 'security-status-card security-red mb-3';
  }
}

/**
 * Show the insecure upload warning modal and return a promise.
 * @returns {Promise<boolean>} True if user confirms, false if cancelled.
 */
function showInsecureUploadModal() {
  // If the modal doesn't exist, proceed anyway.
  return confirmWithModal(els.insecureUploadModal, els.confirmInsecureUpload, true, els.startBtn);
}

/** The modal open now, which Escape closes: `{ modal, shown, closing }`. */
let openModal = null;

/**
 * Closes the open modal, as Cancel. Bootstrap ignores hide() while a modal is
 * still opening, so one asked to close then closes as soon as it's open.
 */
function closeOpenModal() {
  if (!openModal) return;
  if (openModal.shown) openModal.modal.hide();
  else openModal.closing = true;
}

/**
 * Show a modal. Its close button, its backdrop and Escape close it, each as
 * Cancel, and the focus then goes back to what opened it, as electron-kit's
 * prompts do. The opener is the button that was pressed: WebKit doesn't focus
 * a button that's clicked.
 * @returns The modal's Bootstrap instance.
 */
function showModal(modalEl, opener = document.activeElement) {
  const modal = window.bootstrap.Modal.getOrCreateInstance(modalEl);
  const open = { modal, shown: false, closing: false };
  openModal = open;
  modalEl.addEventListener('shown.bs.modal', () => {
    open.shown = true;
    if (open.closing) modal.hide();
  }, { once: true });
  modalEl.addEventListener('hidden.bs.modal', () => {
    if (openModal === open) openModal = null;
    // Unless it's gone or been turned off meanwhile, such as Delete once it's deleted.
    if (opener instanceof HTMLElement && opener !== document.body) opener.focus();
  }, { once: true });
  modal.show();
  return modal;
}

/**
 * Show a modal asking to confirm, and return a promise.
 * @returns {Promise<boolean>} True if `confirmEl` was clicked, false if the modal closed otherwise.
 */
function confirmWithModal(modalEl, confirmEl, withoutModal, opener) {
  return new Promise((resolve) => {
    if (!modalEl) {
      resolve(withoutModal);
      return;
    }

    const modal = showModal(modalEl, opener);

    const cleanup = () => {
      confirmEl?.removeEventListener('click', onConfirm);
      modalEl.removeEventListener('hidden.bs.modal', onHide);
    };

    const onConfirm = () => {
      cleanup();
      modal.hide();
      resolve(true);
    };

    const onHide = () => {
      cleanup();
      resolve(false);
    };

    confirmEl?.addEventListener('click', onConfirm, { once: true });
    modalEl.addEventListener('hidden.bs.modal', onHide, { once: true });
  });
}

function updateCapabilitiesUI() {
  state.p2pSecureOk = hosts.isSecureForDirect(location.hostname, window.isSecureContext);

  // Upload
  if (state.uploadEnabled) {
    const maxText = (state.maxSizeMB === 0)
      ? 'You can upload files of any size.'
      // The server's limit counts in 1024s, as every size the page shows does.
      : `Max upload size: ${formatBytes(state.maxSizeMB * 1024 * 1024)}.`;

    const p2pAvailable = state.p2pEnabled && state.p2pSecureOk;
    els.maxUploadHint.textContent = p2pAvailable && state.maxSizeMB > 0
      ? `${maxText} Anything over will use direct transfer (P2P).`
      : maxText;
  } else {
    const p2pAvailable = state.p2pEnabled && state.p2pSecureOk;
    els.maxUploadHint.textContent = p2pAvailable
      ? 'Standard uploads are disabled on this server. Direct transfer (P2P) is available.'
      : 'Uploads are disabled on this server.';
  }

  // Lifetime
  if (state.uploadEnabled) {
    const unlimitedOption = els.lifetimeUnit?.querySelector('option[value="unlimited"]');
    if (state.maxLifetimeHours > 0) {
      if (unlimitedOption) {
        unlimitedOption.disabled = true;
        unlimitedOption.textContent = 'Unlimited (Disabled by Server)';
      }
    } else if (unlimitedOption) {
      unlimitedOption.disabled = false;
      unlimitedOption.textContent = 'Unlimited';
    }
  }

  // Security status (auto-enable encryption based on server capabilities)
  const canEncrypt = state.uploadEnabled && state.e2ee && window.isSecureContext;
  state.encrypt = canEncrypt; // Auto-set encryption based on capability
  updateSecurityStatus();

  // Mode toggle availability
  const p2pAvailable = state.p2pEnabled && state.p2pSecureOk;
  setDisabled(els.modeP2P, !p2pAvailable);

  if (!state.uploadEnabled) {
    setDisabled(els.modeStandard, true);
    if (p2pAvailable) setMode('p2p');
  } else {
    setDisabled(els.modeStandard, false);
  }

  setDisabled(els.lifetimeValue, !state.uploadEnabled || els.lifetimeUnit.value === 'unlimited');
  setDisabled(els.lifetimeUnit, !state.uploadEnabled);

  // Max Downloads UI (only for standard uploads, not P2P)
  if (state.uploadEnabled && state.mode === 'standard') {
    if (state.maxFileDownloads === 1) {
      // Server forces single-download: disable input, show message
      setDisabled(els.maxDownloadsValue, true);
      els.maxDownloadsValue.value = '1';
      els.maxDownloadsValue.min = '1';
      els.maxDownloadsHelp.textContent = 'Server enforces single-use download links.';
      setHidden(els.optMaxDownloads, false);
    } else if (state.maxFileDownloads === 0) {
      // Server allows unlimited
      setDisabled(els.maxDownloadsValue, false);
      els.maxDownloadsValue.min = '0';
      els.maxDownloadsHelp.textContent = '0 = unlimited downloads';
      setHidden(els.optMaxDownloads, false);
    } else {
      // Server has a limit > 1 (0 is not allowed)
      setDisabled(els.maxDownloadsValue, false);
      els.maxDownloadsValue.min = '1';
      els.maxDownloadsHelp.textContent = `Max: ${state.maxFileDownloads} downloads`;
      setHidden(els.optMaxDownloads, false);
    }
  } else {
    setHidden(els.optMaxDownloads, true);
  }

  validateLifetimeInput();
}

function applyLifetimeDefaults() {
  if (!state.uploadEnabled) return;
  const maxH = state.maxLifetimeHours;
  const safeValue = Number.isFinite(maxH) && maxH > 0
    ? Math.max(0.5, Math.min(24, maxH))
    : 24;
  els.lifetimeUnit.value = 'hours';
  els.lifetimeValue.value = String(safeValue);
  setDisabled(els.lifetimeValue, els.lifetimeUnit.value === 'unlimited');
  validateLifetimeInput();
}

async function loadServerInfo() {
  const { serverInfo: info } = await coreClient.server.connect({ timeoutMs: 5000 });
  state.info = info;

  const upload = info?.capabilities?.upload;
  state.uploadEnabled = Boolean(upload?.enabled);
  state.maxSizeMB = state.uploadEnabled ? (upload?.maxSizeMB ?? null) : null;
  state.maxLifetimeHours = state.uploadEnabled ? (upload?.maxLifetimeHours ?? null) : null;
  state.maxFileDownloads = state.uploadEnabled ? (upload?.maxFileDownloads ?? 1) : 1;
  state.e2ee = state.uploadEnabled ? Boolean(upload?.e2ee) : false;

  const p2p = info?.capabilities?.p2p;
  state.p2pEnabled = Boolean(p2p?.enabled);
  if (p2p?.peerjsPath) state.peerjsPath = p2p.peerjsPath;
  if (Array.isArray(p2p?.iceServers) && p2p.iceServers.length) state.iceServers = p2p.iceServers;

  updateCapabilitiesUI();
  applyLifetimeDefaults();
  updateStartEnabled();
}

function lifetimeMsFromUI() {
  const unit = els.lifetimeUnit.value;
  if (unit === 'unlimited') return 0;
  const value = parseFloat(els.lifetimeValue.value);
  return lifetime.toMs(value, unit);
}

function validateLifetimeInput() {
  if (!state.uploadEnabled) return true;
  const maxH = state.maxLifetimeHours;
  const unit = els.lifetimeUnit.value;

  if (maxH === 0 && unit === 'unlimited') {
    els.lifetimeHelp.textContent = 'No lifetime limit enforced by the server.';
    els.lifetimeHelp.className = 'form-text text-body-secondary';
    return true;
  }

  if (maxH > 0 && unit === 'unlimited') {
    const maxHours = Math.max(1, Math.floor(maxH));
    els.lifetimeUnit.value = 'hours';
    els.lifetimeValue.disabled = false;
    els.lifetimeValue.value = String(Math.min(24, maxHours));
  }

  const ms = lifetimeMsFromUI();
  const maxMs = Number.isFinite(maxH) && maxH > 0 ? maxH * 60 * 60 * 1000 : null;
  if (maxMs && ms > maxMs) {
    els.lifetimeHelp.textContent = `File lifetime too long. Server limit: ${maxH} hours.`;
    els.lifetimeHelp.className = 'form-text text-danger-emphasis';
    return false;
  }

  if (maxH === 0) {
    els.lifetimeHelp.textContent = 'No lifetime limit enforced by the server.';
  } else if (maxH > 0) {
    els.lifetimeHelp.textContent = `Max: ${maxH} hours`;
  }
  els.lifetimeHelp.className = 'form-text text-body-secondary';
  return true;
}

function validateMaxDownloadsInput() {
  if (!state.uploadEnabled || state.mode !== 'standard') return true;

  const max = state.maxFileDownloads;
  const value = parseInt(els.maxDownloadsValue.value, 10);

  // Handle invalid input
  if (isNaN(value) || value < 0) {
    els.maxDownloadsHelp.textContent = 'Must be a non-negative number.';
    els.maxDownloadsHelp.className = 'form-text text-danger-emphasis';
    return false;
  }

  // Server allows unlimited (0) - any value is valid
  if (max === 0) {
    els.maxDownloadsHelp.textContent = '0 = unlimited downloads';
    els.maxDownloadsHelp.className = 'form-text text-body-secondary';
    return true;
  }

  // Server has limit of 1 - input should be disabled anyway
  if (max === 1) {
    els.maxDownloadsHelp.textContent = 'Server enforces single-use download links.';
    els.maxDownloadsHelp.className = 'form-text text-body-secondary';
    return true;
  }

  // Server has limit > 1
  if (value === 0) {
    els.maxDownloadsHelp.textContent = `0 (unlimited) not allowed. Server limit: ${max} downloads.`;
    els.maxDownloadsHelp.className = 'form-text text-danger-emphasis';
    return false;
  }

  if (value > max) {
    els.maxDownloadsHelp.textContent = `Exceeds server limit of ${max} downloads.`;
    els.maxDownloadsHelp.className = 'form-text text-danger-emphasis';
    return false;
  }

  els.maxDownloadsHelp.textContent = `Max: ${max} downloads`;
  els.maxDownloadsHelp.className = 'form-text text-body-secondary';
  return true;
}
function showProgress({ title, sub, percent, doneBytes, totalBytes, icon, iconColor }) {
  showPanels('progress');
  if (icon != null) {
    // icon can be a Material icon name or fallback emoji
    if (typeof icon === 'string' && icon.match(/^[a-z_]+$/)) {
      const colorClass = iconColor ? ` ${iconColor}` : ' text-primary';
      els.progressIcon.innerHTML = `<span class="material-icons-round${colorClass}">${icon}</span>`;
      els.progressIcon.className = `mb-2${colorClass}`;
    } else {
      els.progressIcon.textContent = icon;
    }
  }

  // Update progress card border color based on iconColor
  els.progressCard.classList.remove('border-danger', 'border-success', 'border-primary', 'border-warning');
  els.progressCard.classList.add('border', iconColor ? iconColor.replace('text-', 'border-') : 'border-primary');

  if (title) els.progressTitle.textContent = title;
  if (sub) els.progressSub.textContent = sub;
  if (typeof percent === 'number') els.progressFill.style.width = `${Math.max(0, Math.min(100, percent))}%`;
  if (Number.isFinite(doneBytes) && Number.isFinite(totalBytes)) {
    els.progressBytes.textContent = `${formatBytes(doneBytes)} / ${formatBytes(totalBytes)}`;
  }
}

function showShare({ link = '', title = 'Upload Complete', sub = 'Share this link with your recipient:', showLinkGroup = true } = {}) {
  showPanels('share');
  setShareIcon('check_circle', 'text-success');
  if (els.shareTitle) els.shareTitle.textContent = title;
  if (els.shareSub) els.shareSub.textContent = sub;
  if (els.shareLinkGroup) setHidden(els.shareLinkGroup, !showLinkGroup);
  els.shareCard.classList.remove('border-danger', 'border-success', 'border-primary', 'border-secondary');
  els.shareCard.classList.add('border', 'border-success');
  els.shareLink.value = link || '';
  // Delete is there only for the upload this page just made, while it holds its manage token.
  setHidden(els.deleteUpload, !state.uploaded);
  setDisabled(els.deleteUpload, false);
  // Hide code entry when upload complete
  if (els.codeCard) setHidden(els.codeCard, true);
}

function setShareIcon(icon, color) {
  if (!els.shareIcon) return;
  els.shareIcon.className = `${color} mb-2`;
  els.shareIcon.innerHTML = `<span class="material-icons-round">${icon}</span>`;
}

/** Deletes the upload this page just made, once confirmed, with the manage token only this page holds. */
async function deleteUploaded() {
  const uploaded = state.uploaded;
  if (!uploaded) return;
  const confirmed = await confirmWithModal(els.deleteUploadModal, els.confirmDeleteUpload, false, els.deleteUpload);
  if (!confirmed || state.uploaded !== uploaded) return;

  setDisabled(els.deleteUpload, true);
  let alreadyGone = false;
  try {
    await coreClient.hosted.delete({ id: uploaded.id, manageToken: uploaded.manageToken });
  } catch (err) {
    // An upload that has expired, or been downloaded as many times as it allows, is already gone.
    if (err?.code !== 'NOT_FOUND') {
      setDisabled(els.deleteUpload, false);
      showToast(err?.message || "The upload couldn't be deleted.", 'danger');
      return;
    }
    alreadyGone = true;
  }

  state.uploaded = null;
  setHidden(els.deleteUpload, true);
  setHidden(els.shareLinkGroup, true);
  els.shareLink.value = '';
  setShareIcon('delete', 'text-body-secondary');
  els.shareCard.classList.remove('border-success');
  els.shareCard.classList.add('border-secondary');
  if (els.shareTitle) els.shareTitle.textContent = 'Upload Deleted';
  if (els.shareSub) els.shareSub.textContent = alreadyGone ? 'It was already gone from the server.' : 'It has been removed from the server, and its link no longer works.';
  showToast(alreadyGone ? 'The upload was already gone.' : 'Upload deleted.', 'success');
}

function resetToMain() {
  stopP2P();
  state.uploaded = null;
  setHidden(els.deleteUpload, true);
  state.files = [];
  state.fileTooLargeForStandard = false;
  updateFileUI();
  els.tagline.textContent = 'Send files securely, or enter a sharing code to receive.';
  showPanels('main');
  els.shareLink.value = '';
  els.p2pLink.value = '';
  els.progressFill.style.width = '0%';
  els.progressBytes.textContent = '0 / 0';
  updateStartEnabled();
}

function stopP2P() {
  try { state.p2pSession?.stop(); } catch { }
  state.p2pSession = null;
}

function showQRModal(url, opener) {
  if (!els.qrModal || !els.qrCanvas) return;

  const QRCodeStylingCtor = globalThis.QRCodeStyling;
  if (!QRCodeStylingCtor) {
    showToast?.('QR generator not loaded.', 'warning');
    return;
  }

  // render at a max size; CSS scales it responsively
  const baseSize = 320;

  const qrCode = new QRCodeStylingCtor({
    width: baseSize,
    height: baseSize,
    type: 'svg',
    data: url,
    dotsOptions: { color: '#222222', type: 'rounded' },
  });

  els.qrCanvas.innerHTML = '';
  qrCode.append(els.qrCanvas);

  showModal(els.qrModal, opener);
}

function copyToClipboard(value) {
  if (navigator.clipboard) {
    return navigator.clipboard.writeText(value).catch(() => {
      // fallback
      copyToClipboardFallback(value);
    });
  }
  // navigator.clipboard unavailable (insecure context)
  copyToClipboardFallback(value);
  return Promise.resolve();
}

function copyToClipboardFallback(value) {
  const ta = document.createElement('textarea');
  ta.value = value;
  ta.style.position = 'fixed';
  ta.style.left = '-9999px';
  document.body.appendChild(ta);
  ta.select();
  document.execCommand('copy');
  ta.remove();
}

async function startStandardUpload() {
  if (!state.uploadEnabled) {
    showToast('Standard uploads are disabled on this server.', 'warning');
    return;
  }

  const files = state.files;
  if (!files.length) {
    showToast('Select at least one file first.', 'warning');
    return;
  }

  // Check if E2EE is available - show warning if not
  const hasE2EE = state.uploadEnabled && state.e2ee && window.isSecureContext;
  if (!hasE2EE) {
    const confirmed = await showInsecureUploadModal();
    if (!confirmed) return;
  }

  const encrypt = hasE2EE; // Auto-set encryption based on capability
  // The server's limit counts in 1024s.
  const maxBytes = Number.isFinite(state.maxSizeMB) && state.maxSizeMB > 0
    ? state.maxSizeMB * 1024 * 1024
    : null;
  if (maxBytes) {
    // One file or several, an upload is stored as one object, checked whole.
    const totalEstimated = sizes.estimateUpload(files.reduce((sum, f) => sum + f.size, 0), {
      encrypted: encrypt, chunkSize: state.info?.capabilities?.upload?.chunkSize, maxBytes,
    });
    if (totalEstimated > maxBytes) {
      if (state.p2pEnabled && state.p2pSecureOk) {
        setMode('p2p');
        showToast('Files exceed the server upload limit — using direct transfer.');
        return startP2PSendFlow();
      }
      showToast('Files exceed the server upload limit and cannot be uploaded.', 'danger');
      return;
    }
  }

  const totalSize = files.reduce((sum, f) => sum + f.size, 0);

  if (!validateLifetimeInput()) {
    showToast('File lifetime exceeds server limits.', 'danger');
    return;
  }

  const lifetimeMs = lifetimeMsFromUI();
  els.tagline.textContent = 'Standard Upload';

  showProgress({ title: 'Uploading', sub: 'Preparing...', percent: 0, doneBytes: 0, totalBytes: totalSize, icon: 'cloud_upload', iconColor: 'text-primary' });

  try {
    const upload = coreClient.hosted.upload({
      files,
      encrypt,
      lifetimeMs,
      maxDownloads: (() => {
        const val = parseInt(els.maxDownloadsValue.value, 10);
        return (Number.isInteger(val) && val >= 0) ? val : 1;
      })(),
    });

    // Where the upload is. Core's snapshots never name a file, so the name of
    // the one an upload of several is on comes from this page's own list.
    upload.subscribe((snapshot) => {
      const { phase, text, percent, fileIndex, status, deadline } = snapshot;
      const p = (typeof percent === 'number') ? percent : 0;
      const paused = status === 'paused';
      const onFile = files.length > 1 && phase === 'chunk';
      const currentFileName = onFile ? files[fileIndex]?.name : null;
      let sub = currentFileName ? `${text || phase} — ${currentFileName}` : (text || phase);
      // Paused, the server holds the upload until its deadline, and nothing resumes it but Resume.
      if (paused && text === 'Paused.' && deadline) sub = `Paused. The server keeps this upload until ${formatDeadline(deadline)}.`;
      const view = paused
        ? { title: 'Upload Paused', icon: 'pause_circle', iconColor: 'text-secondary' }
        : { title: 'Uploading', icon: 'cloud_upload', iconColor: 'text-primary' };

      // Update title and store progress for visibility handler
      if (paused) document.title = `Paused - ${originalTitle}`;
      else updateTitleProgress(p);
      currentTransferProgress = {
        percent: p,
        doneBytes: Math.floor((p / 100) * totalSize),
        totalBytes: totalSize,
        showProgress: (pct, done, total) => {
          showProgress({ ...view, sub, percent: pct, doneBytes: done, totalBytes: total });
        }
      };

      showProgress({
        ...view,
        sub,
        percent: p,
        doneBytes: Math.floor((p / 100) * totalSize),
        totalBytes: totalSize,
      });
      showPauseControls(snapshot);
    });

    // Store the upload and show cancel button
    state.upload = upload;
    els.cancelStandardUpload.style.display = 'inline-block';

    // Wire up the progress card's buttons
    els.cancelStandardUpload.onclick = () => upload.cancel();
    els.pauseStandardUpload.onclick = () => pauseOrResume(upload, 'pause');
    els.resumeStandardUpload.onclick = () => pauseOrResume(upload, 'resume');

    // The upload's one outcome: completed, cancelled or failed.
    const outcome = await upload.result;

    els.cancelStandardUpload.style.display = 'none';
    hidePauseControls();
    state.upload = null;
    resetTitleProgress();

    if (outcome.status === 'completed') {
      showProgress({ title: 'Uploading', sub: 'Upload successful!', percent: 100, doneBytes: totalSize, totalBytes: totalSize, icon: 'cloud_upload' });
      // The manage token, for this page's Delete: in its memory only.
      const { id, manageToken } = outcome.value;
      state.uploaded = { id, manageToken };
      showShare({ link: outcome.value.downloadUrl });
    } else if (outcome.status === 'cancelled') {
      showToast('Upload cancelled.', 'warning');
      resetToMain();
    } else {
      showUploadFailed(outcome.error, totalSize);
    }
  } catch (err) {
    // Only an upload that never started gets here, such as one with no files.
    els.cancelStandardUpload.style.display = 'none';
    hidePauseControls();
    state.upload = null;
    resetTitleProgress();
    showUploadFailed(err, totalSize);
  }
}

/** Whether the server lets an upload pause: its pause length is 0 when the operator has turned pausing off. */
function pausingOn() {
  return (state.info?.capabilities?.upload?.maxPauseMinutes ?? 0) > 0;
}

/**
 * Pause while the upload runs, and Resume while it's paused, each usable only
 * when core's snapshot says it can pause (or, paused, go on) now. Neither is
 * there on a server with pausing turned off.
 */
function showPauseControls({ status, canPause }) {
  const paused = status === 'paused';
  const running = status === 'initializing' || status === 'uploading';
  setHidden(els.pauseStandardUpload, !pausingOn() || !running);
  setDisabled(els.pauseStandardUpload, !canPause);
  setHidden(els.resumeStandardUpload, !paused);
  setDisabled(els.resumeStandardUpload, !(paused && canPause));
}

function hidePauseControls() {
  setHidden(els.pauseStandardUpload, true);
  setHidden(els.resumeStandardUpload, true);
}

/** Pauses or resumes the upload. Its snapshots show the result; an upload that ends meanwhile shows its outcome. */
async function pauseOrResume(upload, action) {
  setDisabled(action === 'pause' ? els.pauseStandardUpload : els.resumeStandardUpload, true);
  try {
    await upload[action]();
  } catch (err) {
    const { status } = upload.snapshot;
    const ended = !['initializing', 'uploading', 'paused', 'completing'].includes(status);
    // It moved on before the click landed (it's finishing, or a pause is already settling).
    if (ended || DropgateError.is(err, 'PAUSE_UNAVAILABLE')) return;
    // The server refused the pause, or couldn't be asked to resume: nothing changed.
    console.error(err);
    showToast(err?.message || (action === 'pause' ? "The upload couldn't be paused." : "The upload couldn't be resumed."), 'warning');
  } finally {
    if (state.upload === upload) showPauseControls(upload.snapshot);
  }
}

/** When a paused upload's server stops holding it, as a local time: "14:32", or "14:32 tomorrow". */
function formatDeadline(ms) {
  const at = new Date(ms);
  const time = at.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const today = new Date();
  if (at.toDateString() === today.toDateString()) return time;
  const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
  if (at.toDateString() === tomorrow.toDateString()) return `${time} tomorrow`;
  return at.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}

function showUploadFailed(err, totalSize) {
  console.error(err);
  showProgress({ title: 'Upload Failed', sub: err?.message || 'An error occurred during upload.', percent: 0, doneBytes: 0, totalBytes: totalSize, icon: 'error', iconColor: 'text-danger' });
  showToast(err?.message || 'Upload failed.', 'danger');
}

async function loadPeerJS() {
  if (globalThis.Peer) return globalThis.Peer;

  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = '/vendor/peerjs/peerjs.min.js';
    script.async = true;
    script.onload = () => {
      if (globalThis.Peer) resolve(globalThis.Peer);
      else reject(new Error('PeerJS failed to initialize'));
    };
    script.onerror = () => reject(new Error('Failed to load PeerJS'));
    document.head.appendChild(script);
  });
}

async function startP2PSendFlow() {
  if (!state.p2pEnabled) {
    showToast('Direct transfer is disabled on this server.', 'warning');
    return;
  }
  if (!state.p2pSecureOk) {
    showToast('Direct transfer requires HTTPS (or localhost).', 'warning');
    return;
  }

  if (!state.files.length) {
    showToast('Select at least one file first.', 'warning');
    return;
  }

  const file = state.files.length === 1 ? state.files[0] : state.files;
  const p2pTotalSize = state.files.reduce((sum, f) => sum + f.size, 0);

  // Load PeerJS before starting P2P
  let Peer;
  try {
    Peer = await loadPeerJS();
  } catch (err) {
    showToast('Failed to load P2P library.', 'danger');
    console.error(err);
    return;
  }

  els.tagline.textContent = 'Direct Transfer (P2P)';
  // Copy and the QR code read the link as it's shown, so they work as soon as
  // the code shows, which is before the send below resolves.
  els.copyP2PLink.onclick = () => copyToClipboard(els.p2pLink.value).then(() => showToast('Copied link.', 'success'));
  els.qrP2PLink.onclick = () => showQRModal(els.p2pLink.value, els.qrP2PLink);
  state.p2pSession = await coreClient.direct.send({
    file,
    Peer,
    onCode: (id) => {
      showPanels('p2pwait');
      // Reset visibility of share elements for new session
      setHidden(els.p2pCode, false);
      setHidden(els.p2pLinkLabel, false);
      setHidden(els.p2pLink, false);
      setHidden(els.copyP2PLink, false);
      setHidden(els.qrP2PLink, false);
      // Reset title/subtitle
      const waitTitle = els.p2pWaitCard?.querySelector('h5');
      const waitSub = els.p2pWaitCard?.querySelector('.text-body-secondary');
      if (waitTitle) waitTitle.textContent = 'Awaiting connection...';
      if (waitSub) waitSub.textContent = 'Provide your recipient with the code below:';
      els.p2pCode.textContent = id;
      const link = `${location.origin}/p2p/${encodeURIComponent(id)}`;
      els.p2pLink.value = link;
    },
    onStatus: ({ phase, message }) => {
      if (phase === 'waiting') {
        // Update p2pWaitCard title/subtitle to show waiting status
        const waitTitle = els.p2pWaitCard?.querySelector('h5');
        const waitSub = els.p2pWaitCard?.querySelector('.text-body-secondary');
        if (waitTitle) waitTitle.textContent = 'Connected!';
        if (waitSub) waitSub.textContent = message;
        setHidden(els.p2pCode, true);
        setHidden(els.p2pLinkLabel, true);
        setHidden(els.p2pLink, true);
        setHidden(els.copyP2PLink, true);
        setHidden(els.qrP2PLink, true);
      } else if (phase === 'transferring') {
        // Switch to progress card when transfer actually starts
        showProgress({ title: 'Sending...', sub: message, percent: 0, doneBytes: 0, totalBytes: p2pTotalSize, icon: 'sync_alt', iconColor: 'text-primary' });
        // Show P2P cancel button
        els.cancelP2PSend.style.display = 'inline-block';
        els.cancelStandardUpload.style.display = 'none';
      } else {
        // Default behaviour for other statuses
        showProgress({ title: 'Sending...', sub: message, percent: 0, doneBytes: 0, totalBytes: p2pTotalSize, icon: 'sync_alt', iconColor: 'text-primary' });
      }
    },
    onProgress: ({ processedBytes, totalBytes, percent }) => {
      // Update title and store progress for visibility handler
      updateTitleProgress(percent);
      currentTransferProgress = {
        percent,
        doneBytes: processedBytes,
        totalBytes,
        showProgress: (pct, done, total) => {
          showProgress({ title: 'Sending...', sub: 'Keep this tab open until the transfer completes.', percent: pct, doneBytes: done, totalBytes: total, icon: 'sync_alt', iconColor: 'text-primary' });
        }
      };

      showProgress({ title: 'Sending...', sub: 'Keep this tab open until the transfer completes.', percent, doneBytes: processedBytes, totalBytes, icon: 'sync_alt', iconColor: 'text-primary' });
    },
    onComplete: () => {
      resetTitleProgress();
      els.cancelP2PSend.style.display = 'none';
      stopP2P();
      state.uploaded = null;
      showShare({
        title: 'Transfer Complete',
        sub: `Your recipient has received the file${Array.isArray(file) ? 's' : ''}.`,
        showLinkGroup: false,
      });
    },
    onError: (err) => {
      console.error(err);
      resetTitleProgress();
      els.cancelP2PSend.style.display = 'none';
      showProgress({ title: 'Transfer Failed', sub: err?.message || 'An error occurred during transfer.', percent: 0, doneBytes: 0, totalBytes: p2pTotalSize, icon: 'error', iconColor: 'text-danger' });
      stopP2P();
    },
    onDisconnect: () => {
      resetTitleProgress();
      els.cancelP2PSend.style.display = 'none';
      showToast('The receiver disconnected.', 'warning');
      resetToMain();
    },
    onCancel: (evt) => {
      resetTitleProgress();
      els.cancelP2PSend.style.display = 'none';
      const msg = evt?.cancelledBy === 'receiver'
        ? 'The receiver cancelled the transfer.'
        : 'Transfer cancelled.';
      showToast(msg, 'warning');
      resetToMain();
    },
  });

  els.cancelP2P.onclick = () => {
    resetTitleProgress();
    stopP2P();
    showToast('Transfer cancelled.', 'warning');
    resetToMain();
  };
  els.cancelP2PSend.onclick = () => {
    resetTitleProgress();
    stopP2P();
    showToast('Transfer cancelled.', 'warning');
    resetToMain();
  };
}

function wireUI() {
  // File selection
  els.selectFileBtn?.addEventListener('click', (e) => { e.stopPropagation(); els.fileInput?.click(); });
  els.browseMoreBtn?.addEventListener('click', (e) => { e.stopPropagation(); els.fileInput?.click(); });
  els.btnClearAll?.addEventListener('click', (e) => {
    e.stopPropagation();
    state.files = [];
    state.fileTooLargeForStandard = false;
    updateFileUI();
    updateStartEnabled();
  });
  els.dropzone?.addEventListener('click', (e) => {
    // Don't steal button clicks
    if (e.target?.closest('button')) return;
    els.fileInput?.click();
  });

  els.fileInput?.addEventListener('change', () => {
    const fileList = els.fileInput.files;
    if (!fileList || !fileList.length) return;
    handleFileSelection(fileList);
    // Reset the input so the same files can be selected again
    els.fileInput.value = '';
  });

  // Drag & drop
  ['dragenter', 'dragover'].forEach((ev) => {
    els.dropzone?.addEventListener(ev, (e) => {
      e.preventDefault();
      els.dropzone.classList.add('dragover');
    });
  });
  ['dragleave', 'drop'].forEach((ev) => {
    els.dropzone?.addEventListener(ev, (e) => {
      e.preventDefault();
      els.dropzone.classList.remove('dragover');
    });
  });
  els.dropzone?.addEventListener('drop', async (e) => {
    const fileList = e.dataTransfer?.files;
    if (!fileList || !fileList.length) return;

    // Filter out directories
    const validFiles = [];
    for (const f of Array.from(fileList)) {
      if (await isFile(f)) validFiles.push(f);
    }

    if (validFiles.length === 0) {
      showToast('Folders cannot be uploaded.', 'warning');
      return;
    }

    handleFileSelection(validFiles);
  });

  // Mode toggles
  els.modeStandard?.addEventListener('click', () => {
    if (els.modeStandard.hasAttribute('disabled')) return;
    setMode('standard');
  });
  els.modeP2P?.addEventListener('click', () => {
    if (els.modeP2P.hasAttribute('disabled')) return;
    setMode('p2p');
  });

  // Lifetime input - mirror Electron behavior
  const normaliseLifetimeValue = () => {
    if (els.lifetimeUnit.value === 'unlimited') {
      els.lifetimeValue.value = '0';
      setDisabled(els.lifetimeValue, true);
      return;
    }

    setDisabled(els.lifetimeValue, false);
    const value = parseFloat(els.lifetimeValue.value);
    if (Number.isNaN(value) || value <= 0) {
      els.lifetimeValue.value = '0.5';
    }
  };

  els.lifetimeValue?.addEventListener('input', () => {
    if (!state.uploadEnabled) return;
    normaliseLifetimeValue();
    validateLifetimeInput();
    updateStartEnabled();
  });

  els.lifetimeUnit?.addEventListener('change', () => {
    if (!state.uploadEnabled) return;
    normaliseLifetimeValue();
    validateLifetimeInput();
    updateStartEnabled();
  });

  els.maxDownloadsValue?.addEventListener('input', () => {
    if (!state.uploadEnabled) return;
    if (els.maxDownloadsValue.value === '') {
      els.maxDownloadsValue.value = '1';
    }
    validateMaxDownloadsInput();
    updateStartEnabled();
  });

  // Help buttons are integrated into the existing help buttons in HTML
  // They send tooltips that are handled by the tooltip functionality

  // Start
  els.startBtn?.addEventListener('click', async () => {
    try {
      if (state.mode === 'standard') await startStandardUpload();
      else await startP2PSendFlow();
    } catch (err) {
      console.error(err);
      showToast(err?.message || 'Something went wrong.', 'danger');
      resetToMain();
    }
  });

  // Share actions
  els.copyShare?.addEventListener('click', () => copyToClipboard(els.shareLink.value).then(() => showToast('Copied link.', 'success')));
  els.qrShare?.addEventListener('click', () => showQRModal(els.shareLink.value, els.qrShare));
  els.newUpload?.addEventListener('click', resetToMain);
  els.deleteUpload?.addEventListener('click', deleteUploaded);

  // Enter code
  const goWithCode = async () => {
    const value = normalizeCode(els.codeInput.value);
    if (!value) return;

    setDisabled(els.codeGo, true);
    try {
      const result = await coreClient.links.resolve(value, {
        timeoutMs: 5000,
      });
      if (!result?.valid || !result?.target) {
        showToast(result?.reason || 'That sharing code could not be validated.', 'warning');
        return;
      }
      window.location.href = result.target;
    } catch (err) {
      console.error(err);
      showToast(err?.message || 'Failed to validate sharing code.', 'warning');
    } finally {
      setDisabled(els.codeGo, false);
    }
  };

  els.codeGo?.addEventListener('click', () => {
    void goWithCode();
  });
  els.codeInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') void goWithCode();
  });
  els.codeInput?.addEventListener('input', () => {
    const hasValue = els.codeInput.value.trim().length > 0;
    setDisabled(els.codeGo, !hasValue);
  });
  // Initial state
  setDisabled(els.codeGo, true);

  // Escape closes the modal that's open, as Cancel, wherever the focus is,
  // and does nothing else; it's caught first, so Bootstrap's own handler on
  // the modal never sees it. With no modal, Escape resets the page, but
  // never under an upload, whose card (and, paused, its Resume) would go
  // while it carries on.
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (openModal) {
      e.preventDefault();
      e.stopPropagation();
      closeOpenModal();
      return;
    }
    if (!state.upload) resetToMain();
  }, true);
}

async function init() {
  wireUI();

  try {
    await loadServerInfo();
  } catch (err) {
    console.error(err);
    els.maxUploadHint.textContent = 'Could not load server info.';
    showToast('Could not load server info.', 'warning');
  }

  // Defaults
  setMode('standard');
  setSelected(els.encYes, els.encNo, true);
  state.encrypt = true;

  // If standard is disabled, updateCapabilitiesUI will force P2P mode.
  updateCapabilitiesUI();
  updateStartEnabled();

  if (state.p2pEnabled && !state.p2pSecureOk) {
    showToast('Direct transfer requires HTTPS (or localhost).', 'warning');
  }
}

init();
