import { DropgateError, filenames } from './dropgate-core.js';
import { pageClient } from './page-common.js';
import { setStatusError, setStatusSuccess, StatusType, Icons, updateStatusCard } from './status-card.js';

const statusTitle = document.getElementById('status-title');
const statusMessage = document.getElementById('status-message');
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

const client = pageClient();

const bundleState = {
  bundleId: null,
  isEncrypted: false,
  keyB64: null,
  filenames: [],
  files: [],
  totalSizeBytes: 0,
};

let fileListVisible = false;

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

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return '0 bytes';
  if (bytes === 0) return '0 bytes';
  const k = 1000;
  const sizes = ['bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const v = bytes / Math.pow(k, i);
  return `${v.toFixed(v < 10 && i > 0 ? 2 : 1)} ${sizes[i]}`;
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
    const size = bundleState.files[i].sizeBytes;

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

    // Always use a button for individual downloads (routes through dropgate core)
    const canStream = window.isSecureContext && window.streamSaver?.createWriteStream;
    // For encrypted files, streaming is required
    if (bundleState.isEncrypted && !canStream) {
      // No download button — streaming not available
    } else {
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

async function downloadSingleFile(index, dlBtn) {
  const name = bundleState.filenames[index];
  const fileId = bundleState.files[index].fileId;
  const size = bundleState.files[index].sizeBytes;

  const fileProgressEl = document.getElementById(`file-progress-${index}`);
  const fileProgressBar = document.getElementById(`file-progress-bar-${index}`);
  const fileProgressText = document.getElementById(`file-progress-text-${index}`);

  // Disable button during download
  if (dlBtn) dlBtn.disabled = true;

  // Show per-file progress
  if (fileProgressEl) fileProgressEl.style.display = 'block';
  if (fileProgressBar) fileProgressBar.style.width = '0%';
  if (fileProgressText) fileProgressText.textContent = 'Starting...';

  // Check if we can use streaming (required for encrypted, preferred for plaintext)
  const canStream = window.isSecureContext && window.streamSaver?.createWriteStream;

  if (bundleState.isEncrypted && !canStream) {
    if (fileProgressText) {
      fileProgressText.textContent = 'Encrypted files require a secure context (HTTPS).';
      fileProgressText.classList.add('text-danger');
    }
    if (dlBtn) dlBtn.disabled = false;
    return;
  }

  // For plaintext without streaming, check file existence first then fall back to direct download
  if (!bundleState.isEncrypted && !canStream) {
    try {
      const metaRes = await fetch(`/api/file/${fileId}/meta`, { credentials: 'omit' });
      if (!metaRes.ok) {
        if (fileProgressText) {
          fileProgressText.textContent = metaRes.status === 404
            ? 'File not found or has expired.'
            : `Download failed (${metaRes.status}).`;
          fileProgressText.classList.add('text-danger');
        }
        if (dlBtn) dlBtn.disabled = false;
        return;
      }
      // File exists, use hidden iframe for download
      const iframe = document.createElement('iframe');
      iframe.style.display = 'none';
      iframe.src = `/api/file/${fileId}`;
      document.body.appendChild(iframe);
      if (fileProgressBar) fileProgressBar.style.width = '100%';
      if (fileProgressText) fileProgressText.textContent = 'Download started. Check your browser downloads.';
      if (dlBtn) dlBtn.disabled = false;
      return;
    } catch (error) {
      console.error('File check failed:', error);
      if (fileProgressText) {
        fileProgressText.textContent = 'Could not reach the server. Please try again.';
        fileProgressText.classList.add('text-danger');
      }
      if (dlBtn) dlBtn.disabled = false;
      return;
    }
  }

  // Stream download via dropgate-core (both plaintext and encrypted)
  try {
    // This file alone, which the bundle's download limit doesn't count.
    const download = client.hosted.download({
      bundleId: bundleState.bundleId,
      keyB64: bundleState.keyB64,
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
    if (fileProgressText) {
      fileProgressText.textContent = error.message || `Failed to download "${name}".`;
      fileProgressText.classList.add('text-danger');
    }
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

  // For encrypted bundles, require secure context
  if (bundleState.isEncrypted) {
    if (!window.isSecureContext || !window.streamSaver?.createWriteStream) {
      showError('Secure Context Required', 'Encrypted bundles must be downloaded in a secure context (HTTPS).');
      return;
    }
  }

  // For plain bundles in non-secure context, fall back to sequential direct downloads
  if (!bundleState.isEncrypted && (!window.isSecureContext || !window.streamSaver?.createWriteStream)) {
    progressContainer.style.display = 'none';
    statusTitle.textContent = 'Downloading Files...';
    statusMessage.textContent = 'Your browser will download each file individually.';

    for (let i = 0; i < bundleState.files.length; i++) {
      const fileId = bundleState.files[i].fileId;
      // Use iframes for sequential downloads to avoid popup blockers
      const iframe = document.createElement('iframe');
      iframe.style.display = 'none';
      iframe.src = `/api/file/${fileId}`;
      document.body.appendChild(iframe);
      // Stagger to avoid browser throttling
      await new Promise(r => setTimeout(r, 500));
    }

    // Mark bundle as downloaded
    try {
      await fetch(`/api/bundle/${bundleState.bundleId}/downloaded`, {
        method: 'POST',
        credentials: 'omit',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
    } catch { /* Best effort */ }

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
    const zipName = `dropgate-bundle-${bundleState.bundleId}.zip`;
    statusTitle.textContent = bundleState.isEncrypted ? 'Downloading & Decrypting' : 'Downloading';
    statusMessage.textContent = `Your browser will ask you where to save "${zipName}".`;

    const download = client.hosted.download({
      bundleId: bundleState.bundleId,
      keyB64: bundleState.keyB64,
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
      message: error?.message || 'The bundle may have expired, or the download failed.',
    });
  }
}

async function loadMetadata() {
  const bundleId = document.body.dataset.bundleId;
  if (!bundleId) {
    showError('Invalid Link', 'The bundle ID is missing from this link.');
    return;
  }

  bundleState.bundleId = bundleId;

  try {
    // Get decryption key from URL hash if present
    const hash = window.location.hash.substring(1);
    bundleState.keyB64 = hash || null;

    // Core reads the bundle's files, decrypting their names (and a sealed
    // bundle's list of files) with the key, which never leaves this page.
    let meta;
    try {
      meta = await client.hosted.metadata({ bundleId, keyB64: bundleState.keyB64 || undefined });
    } catch (error) {
      // Only an encrypted bundle needs the key, and Web Crypto to read it.
      if (DropgateError.is(error, 'KEY_REQUIRED') || DropgateError.is(error, 'RUNTIME_UNSUPPORTED')) {
        bundleEncryption.textContent = 'End-to-End Encrypted';
        encryptionStatement.style.display = 'block';
        if (!window.isSecureContext) {
          showError('Secure Connection Required', 'Encrypted bundles can only be downloaded over HTTPS.');
        } else {
          showError('Missing Decryption Key', 'The decryption key was not found in the URL.');
        }
        return;
      }
      throw error;
    }

    bundleState.isEncrypted = meta.isEncrypted;
    bundleState.totalSizeBytes = meta.totalSizeBytes;
    bundleState.files = meta.files.map(({ fileId, sizeBytes }) => ({ fileId, sizeBytes }));
    // Shown and saved under their safe names: the one file name rule.
    bundleState.filenames = meta.files.map(({ name }) => filenames.sanitize(name));

    bundleFileCount.textContent = `${meta.fileCount}`;
    bundleTotalSize.textContent = formatBytes(meta.totalSizeBytes);
    bundleEncryption.textContent = meta.isEncrypted ? 'End-to-End Encrypted' : 'None';

    if (meta.isEncrypted) {
      encryptionStatement.style.display = 'block';

      if (!window.isSecureContext) {
        showError('Secure Connection Required', 'Encrypted bundles can only be downloaded over HTTPS.');
        return;
      }
    }

    // Show details
    bundleDetails.style.display = 'block';
    fileListContainer.style.display = 'block';
    downloadActions.style.display = 'block';

    buildFileList();
    toggleFileListBtn.addEventListener('click', toggleFileList);
    downloadAllButton.addEventListener('click', downloadAllAsZip);

    statusTitle.textContent = 'Ready to Download';
    statusMessage.textContent = `${meta.fileCount} file${meta.fileCount !== 1 ? 's' : ''} available. Click "Download All as ZIP" or expand the list to download individually.`;
  } catch (error) {
    console.error(error);
    showError('Error', 'Could not load the bundle details. Please try again later.');
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', loadMetadata);
} else {
  loadMetadata();
}
