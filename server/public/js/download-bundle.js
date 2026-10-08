import { filenames } from './dropgate-core.js';
import { setStatusError, setStatusSuccess, StatusType, Icons, updateStatusCard } from './status-card.js';

// The download page's half for an upload of several files. Every download it
// makes counts as one download of the upload, however many there are: core's
// opened upload holds one lease from the first download until the page goes.

const statusTitle = document.getElementById('status-title');
const statusMessage = document.getElementById('status-message');
const pageLead = document.getElementById('page-lead');
const bundleDetails = document.getElementById('bundle-details');
const bundleFileCount = document.getElementById('bundle-file-count');
const bundleTotalSize = document.getElementById('bundle-total-size');
const bundleEncryption = document.getElementById('bundle-encryption');
const fileListContainer = document.getElementById('file-list-container');
const toggleFileListBtn = document.getElementById('toggle-file-list');
const fileList = document.getElementById('file-list');
const fileListItems = document.getElementById('file-list-items');
const downloadActions = document.getElementById('download-actions');
const downloadAllButton = document.getElementById('download-all-button');
const progressContainer = document.getElementById('progress-container');
const progressBar = document.getElementById('progress-bar');
const progressText = document.getElementById('progress-text');
const progressFileName = document.getElementById('progress-file-name');
const iconContainer = document.getElementById('icon-container');
const card = document.getElementById('status-card');
const encryptionStatement = document.getElementById('encryption-statement');
const encryptionStatementTitle = document.getElementById('encryption-statement-title');
const encryptionStatementText = document.getElementById('encryption-statement-text');

// How often the page renews the lease its browser downloads are under: well
// inside the 5 minutes the server holds one with no request.
const LEASE_RENEW_MS = 2 * 60 * 1000;

const bundleState = {
  id: null,
  opened: null,
  isEncrypted: false,
  filenames: [],
  files: [],
  // The lease the browser's own downloads are under, on a page with no secure context.
  lease: null,
  leaseTaking: null,
  leaseTimer: null,
};

let fileListVisible = false;
let formatBytes = (bytes) => `${bytes} bytes`;
let takeLease = async () => { throw new Error('The download could not start.'); };

/** Whether this page can stream a download through core: a secure context, with StreamSaver. */
const canStream = () => window.isSecureContext && Boolean(window.streamSaver?.createWriteStream);

function showError(title, message) {
  setStatusError({
    card,
    iconContainer,
    titleEl: statusTitle,
    messageEl: statusMessage,
    title,
    message,
  });
  downloadActions.style.display = 'none';
  progressContainer.style.display = 'none';
  fileListContainer.style.display = 'none';
}

function toggleFileList() {
  fileListVisible = !fileListVisible;
  fileList.style.display = fileListVisible ? 'block' : 'none';
  toggleFileListBtn.innerHTML = fileListVisible
    ? '<span class="material-icons-round" style="font-size: 1rem; vertical-align: middle;">expand_less</span> Hide files'
    : '<span class="material-icons-round" style="font-size: 1rem; vertical-align: middle;">expand_more</span> Show files';
}

function buildFileList() {
  fileListItems.innerHTML = '';
  for (let i = 0; i < bundleState.filenames.length; i++) {
    const name = bundleState.filenames[i];
    const size = bundleState.files[i].size;

    const li = document.createElement('li');
    li.className = 'list-group-item py-2';
    li.id = `file-item-${i}`;

    const row = document.createElement('div');
    row.className = 'd-flex justify-content-between align-items-center';

    const nameSpan = document.createElement('span');
    nameSpan.className = 'text-truncate me-2';
    nameSpan.textContent = name;
    nameSpan.title = name;

    const rightSide = document.createElement('span');
    rightSide.className = 'd-flex align-items-center gap-2 flex-shrink-0';

    const sizeSpan = document.createElement('span');
    sizeSpan.className = 'text-body-secondary small';
    sizeSpan.textContent = formatBytes(size);
    rightSide.appendChild(sizeSpan);

    // An encrypted file needs streaming, to decrypt it here; without it there's no button.
    if (!bundleState.isEncrypted || canStream()) {
      const dlBtn = document.createElement('button');
      dlBtn.className = 'btn btn-sm btn-outline-primary d-inline-flex align-items-center justify-content-center';
      dlBtn.title = `Download ${name}`;
      dlBtn.innerHTML = '<span class="material-icons-round" style="font-size: 1rem; line-height: 1;">download</span>';
      dlBtn.addEventListener('click', () => downloadSingleFile(i, dlBtn));
      rightSide.appendChild(dlBtn);
    }

    row.appendChild(nameSpan);
    row.appendChild(rightSide);
    li.appendChild(row);

    // Per-file progress bar (hidden by default)
    const fileProgress = document.createElement('div');
    fileProgress.className = 'mt-2';
    fileProgress.id = `file-progress-${i}`;
    fileProgress.style.display = 'none';
    fileProgress.innerHTML = `
      <div class="progress" style="height: 4px;">
        <div class="progress-bar" id="file-progress-bar-${i}" style="width: 0%"></div>
      </div>
      <div class="text-body-secondary small mt-1" id="file-progress-text-${i}"></div>
    `;
    li.appendChild(fileProgress);

    fileListItems.appendChild(li);
  }
}

/**
 * The lease the browser's own downloads are under, taken at the first and
 * renewed while the page is open, so every file it downloads counts as one.
 */
async function pageLease() {
  if (bundleState.lease) return bundleState.lease;
  bundleState.leaseTaking ??= takeLease(bundleState.id).finally(() => { bundleState.leaseTaking = null; });
  bundleState.lease = await bundleState.leaseTaking;
  bundleState.leaseTimer ??= setInterval(renewPageLease, LEASE_RENEW_MS);
  return bundleState.lease;
}

async function renewPageLease() {
  const lease = bundleState.lease;
  if (!lease) return;
  try {
    const res = await fetch('/api/v4/lease/renew', {
      method: 'POST',
      credentials: 'omit',
      headers: { Accept: 'application/json', 'Dropgate-Lease': lease },
    });
    // It ended (the upload went, or it ran out): the next download takes another.
    if (res.status === 404 && bundleState.lease === lease) bundleState.lease = null;
  } catch { /* Tried again in 2 minutes; the server holds it for 5. */ }
}

/** Hands file `index` to the browser to download itself, under the page's lease. */
function browserDownload(lease, index) {
  const iframe = document.createElement('iframe');
  iframe.style.display = 'none';
  iframe.src = `/api/v4/leases/${encodeURIComponent(lease)}/files/${index}`;
  document.body.appendChild(iframe);
}

async function downloadSingleFile(index, dlBtn) {
  const name = bundleState.filenames[index];
  const size = bundleState.files[index].size;

  const fileProgressEl = document.getElementById(`file-progress-${index}`);
  const fileProgressBar = document.getElementById(`file-progress-bar-${index}`);
  const fileProgressText = document.getElementById(`file-progress-text-${index}`);
  const failed = (message) => {
    if (fileProgressText) {
      fileProgressText.textContent = message;
      fileProgressText.classList.remove('text-success');
      fileProgressText.classList.add('text-danger');
    }
  };

  if (dlBtn) dlBtn.disabled = true;
  if (fileProgressEl) fileProgressEl.style.display = 'block';
  if (fileProgressBar) fileProgressBar.style.width = '0%';
  if (fileProgressText) fileProgressText.textContent = 'Starting...';

  // With no secure context, an unencrypted file goes to the browser itself.
  if (!canStream()) {
    try {
      browserDownload(await pageLease(), index);
      if (fileProgressBar) fileProgressBar.style.width = '100%';
      if (fileProgressText) fileProgressText.textContent = 'Download started. Check your browser downloads.';
    } catch (error) {
      console.error(error);
      failed(error.message || 'The download could not start.');
    } finally {
      if (dlBtn) dlBtn.disabled = false;
    }
    return;
  }

  // Streamed through core, under the page's one lease: only this file's chunks are asked for.
  try {
    const download = bundleState.opened.download({
      files: [index],
      timeoutMs: 0,
      sink: () => streamSaver.createWriteStream(name, size ? { size } : undefined).getWriter(),
    });
    download.subscribe(({ percent, processedBytes, totalBytes }) => {
      if (fileProgressBar) fileProgressBar.style.width = `${percent}%`;
      if (fileProgressText) fileProgressText.textContent = `${formatBytes(processedBytes)} / ${formatBytes(totalBytes)}`;
    });
    const outcome = await download.result;
    if (outcome.status !== 'completed') throw outcome.error ?? new Error('Download cancelled.');
    if (fileProgressBar) fileProgressBar.style.width = '100%';
    if (fileProgressText) {
      fileProgressText.textContent = 'Download complete!';
      fileProgressText.classList.remove('text-danger');
      fileProgressText.classList.add('text-success');
    }
  } catch (error) {
    console.error('Single file download failed:', error);
    failed(error.message || `Failed to download "${name}".`);
  } finally {
    if (dlBtn) dlBtn.disabled = false;
  }
}

async function downloadAllAsZip() {
  downloadAllButton.style.display = 'none';
  progressContainer.style.display = 'block';
  progressBar.style.width = '0%';
  progressText.textContent = 'Starting...';

  updateStatusCard({
    card,
    iconContainer,
    status: StatusType.PRIMARY,
    icon: bundleState.isEncrypted ? Icons.DOWNLOAD_ENCRYPTED : Icons.DOWNLOAD,
  });

  // With no secure context, each file goes to the browser itself, one after another, under the page's lease.
  if (!canStream()) {
    progressContainer.style.display = 'none';
    statusTitle.textContent = 'Downloading Files...';
    statusMessage.textContent = 'Your browser will download each file individually.';
    try {
      const lease = await pageLease();
      for (let i = 0; i < bundleState.files.length; i++) {
        browserDownload(lease, i);
        // Staggered, so the browser doesn't hold any back.
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    } catch (error) {
      console.error(error);
      showError('Download Failed', error.message || 'The download could not start.');
      return;
    }

    setStatusSuccess({
      card,
      iconContainer,
      titleEl: statusTitle,
      messageEl: statusMessage,
      title: 'Downloads Started',
      message: `${bundleState.files.length} files should be downloading. Check your browser's download bar.`,
    });
    return;
  }

  try {
    const zipName = `dropgate-bundle-${bundleState.id}.zip`;
    statusTitle.textContent = bundleState.isEncrypted ? 'Downloading & Decrypting' : 'Downloading';
    statusMessage.textContent = `Your browser will ask you where to save "${zipName}".`;

    const download = bundleState.opened.download({
      asZip: true,
      timeoutMs: 0,
      sink: streamSaver.createWriteStream(zipName).getWriter(),
    });
    // Core's snapshots never name a file, so the name comes from this page's own list.
    download.subscribe(({ percent, processedBytes, totalBytes, fileIndex }) => {
      progressBar.style.width = `${percent}%`;
      progressText.textContent = `${formatBytes(processedBytes)} / ${formatBytes(totalBytes)}`;
      if (Number.isInteger(fileIndex) && bundleState.filenames[fileIndex] !== undefined) {
        progressFileName.textContent = bundleState.filenames[fileIndex];
      }
    });
    const outcome = await download.result;
    if (outcome.status !== 'completed') throw outcome.error ?? new Error('Download cancelled.');

    progressBar.style.width = '100%';
    progressFileName.textContent = '';
    setStatusSuccess({
      card,
      iconContainer,
      titleEl: statusTitle,
      messageEl: statusMessage,
      title: 'Download Complete!',
      message: bundleState.isEncrypted
        ? `All ${bundleState.files.length} files have been decrypted and saved as "${zipName}".`
        : `All ${bundleState.files.length} files have been saved as "${zipName}".`,
    });
  } catch (error) {
    if (error) console.error(error);
    progressContainer.style.display = 'none';
    progressFileName.textContent = '';
    downloadActions.style.display = 'block';
    downloadAllButton.style.display = 'inline-block';
    downloadAllButton.textContent = 'Retry Download';

    setStatusError({
      card,
      iconContainer,
      titleEl: statusTitle,
      messageEl: statusMessage,
      title: 'Download Failed',
      message: error?.message || 'The upload may have expired, or the download failed.',
    });
  }
}

/**
 * Shows an upload of several files, opened with core: its list, a button for
 * each file, and Download All. `takeLease` takes a lease for the browser's
 * own downloads, on a page with no secure context.
 */
export function showBundle({ id, opened, format, takeLease: take }) {
  const meta = opened.metadata;
  bundleState.id = id;
  bundleState.opened = opened;
  bundleState.isEncrypted = meta.encrypted;
  bundleState.files = meta.files.map(({ size }) => ({ size }));
  // Shown and saved under their safe names: the one file name rule.
  bundleState.filenames = meta.files.map(({ name }) => filenames.sanitize(name));
  formatBytes = format;
  takeLease = take;

  // Leaving the page closes the opened upload: its lease is released, and
  // counts as one download if anything was downloaded. The browser's own
  // downloads go on after the page, so their lease isn't released: it runs
  // out by itself, 5 minutes after their last bytes.
  window.addEventListener('pagehide', () => {
    opened.close();
    clearInterval(bundleState.leaseTimer);
    bundleState.leaseTimer = null;
  });
  // Back from the back-forward cache, it's closed: the page starts again.
  window.addEventListener('pageshow', (event) => { if (event.persisted) window.location.reload(); });

  pageLead.textContent = 'This link contains multiple files.';
  iconContainer.innerHTML = '<span class="material-icons-round">folder_zip</span>';
  encryptionStatementTitle.textContent = 'End-to-End Encryption enabled for these files!';
  encryptionStatementText.textContent = 'Your files will be decrypted locally in your browser using the key in the URL. The server never sees the decrypted data.';

  bundleFileCount.textContent = `${meta.files.length}`;
  bundleTotalSize.textContent = formatBytes(meta.totalSize);
  bundleEncryption.textContent = meta.encrypted ? 'End-to-End Encrypted' : 'None';

  if (meta.encrypted) {
    encryptionStatement.style.display = 'block';
    if (!window.isSecureContext) {
      showError('Secure Connection Required', 'Encrypted files can only be downloaded over HTTPS.');
      return;
    }
  }

  bundleDetails.style.display = 'block';
  fileListContainer.style.display = 'block';
  downloadActions.style.display = 'block';
  if (!canStream()) downloadAllButton.textContent = 'Download All';

  buildFileList();
  toggleFileListBtn.addEventListener('click', toggleFileList);
  downloadAllButton.addEventListener('click', downloadAllAsZip);

  statusTitle.textContent = 'Ready to Download';
  statusMessage.textContent = `${meta.files.length} files available. Click "${downloadAllButton.textContent}" or expand the list to download individually.`;
}
