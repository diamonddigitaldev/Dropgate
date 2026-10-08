import { DropgateError, filenames } from './dropgate-core.js';
import { pageClient } from './page-common.js';
import { showBundle } from './download-bundle.js';
import { setStatusError, setStatusSuccess, StatusType, Icons, updateStatusCard } from './status-card.js';

const statusTitle = document.getElementById('status-title');
const statusMessage = document.getElementById('status-message');
const downloadButton = document.getElementById('download-button');
const fileDetails = document.getElementById('file-details');
const fileNameEl = document.getElementById('file-name');
const fileSizeEl = document.getElementById('file-size');
const fileEncryptionEl = document.getElementById('file-encryption');
const fileIdEl = document.getElementById('file-id');
const progressContainer = document.getElementById('progress-container');
const progressBar = document.getElementById('progress-bar');
const progressText = document.getElementById('progress-text');
const iconContainer = document.getElementById('icon-container');
const card = document.getElementById('status-card');
const trustStatement = document.getElementById('trust-statement');
const encryptionStatement = document.getElementById('encryption-statement');

const client = pageClient();

const downloadState = {
  id: null,
  isEncrypted: false,
  secret: null,
  fileName: null,
  sizeBytes: 0,
};

// Title progress tracking
const originalTitle = document.title;

const updateTitleProgress = (percent) => {
  if (percent > 1 && percent < 100) {
    document.title = `${Math.floor(percent)}% - ${originalTitle}`;
  } else {
    document.title = originalTitle;
  }
};

const resetTitleProgress = () => {
  document.title = originalTitle;
};

function showError(title, message) {
  setStatusError({
    card,
    iconContainer,
    titleEl: statusTitle,
    messageEl: statusMessage,
    title,
    message,
  });
  downloadButton.style.display = 'none';
  progressContainer.style.display = 'none';
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

async function startDownload() {
  downloadButton.style.display = 'none';
  progressContainer.style.display = 'block';
  progressBar.style.width = '0%';
  progressText.textContent = 'Starting...';
  downloadButton.disabled = true;

  updateStatusCard({
    card,
    iconContainer,
    status: StatusType.PRIMARY,
    icon: downloadState.isEncrypted ? Icons.DOWNLOAD_ENCRYPTED : Icons.DOWNLOAD,
  });

  // For encrypted files, require secure context with streamSaver
  if (downloadState.isEncrypted) {
    if (!window.isSecureContext || !window.streamSaver?.createWriteStream) {
      showError('Secure Context Required', 'Encrypted files must be downloaded and decrypted in a secure context (HTTPS).');
      return;
    }
  }

  // For plain files in non-secure context, the browser downloads the file
  // itself, under a lease the page takes first: the lease is in that one URL,
  // so the browser's own resume stays under it, and counts once.
  if (!downloadState.isEncrypted && (!window.isSecureContext || !window.streamSaver?.createWriteStream)) {
    let lease;
    try {
      lease = await takeLease(downloadState.id);
    } catch (error) {
      console.error(error);
      showError('Download Failed', error.message || 'The download could not start.');
      return;
    }
    progressContainer.style.display = 'none';
    window.location.href = `/api/v4/leases/${encodeURIComponent(lease)}`;
    setStatusSuccess({
      card,
      iconContainer,
      titleEl: statusTitle,
      messageEl: statusMessage,
      title: 'Download Started',
      message: `Your file "${downloadState.fileName}" should be downloading now. Check your browser\'s download bar.`,
    });
    return;
  }

  try {
    statusTitle.textContent = 'Starting Download...';
    statusMessage.textContent = `Your browser will now ask you where to save "${downloadState.fileName}".`;

    statusTitle.textContent = downloadState.isEncrypted ? 'Downloading & Decrypting' : 'Downloading';
    statusMessage.textContent = 'Streaming directly to file...';

    // The file's writer is the download's sink: core writes each piece to it,
    // closes it once the whole file is in, and aborts it if the download fails.
    const download = client.hosted.download({
      id: downloadState.id,
      secret: downloadState.secret,
      timeoutMs: 0, // No timeout for large file downloads
      sink: streamSaver.createWriteStream(downloadState.fileName).getWriter(),
    });
    download.subscribe(({ percent, processedBytes, totalBytes }) => {
      updateTitleProgress(Math.round(percent));
      progressBar.style.width = `${percent}%`;
      progressText.textContent = `${formatBytes(processedBytes)} / ${formatBytes(totalBytes)}`;
      statusMessage.textContent = totalBytes
        ? `Streaming directly to file... (${Math.round(percent)}%)`
        : `Streaming directly to file... (${formatBytes(processedBytes)})`;
    });
    const outcome = await download.result;
    if (outcome.status !== 'completed') throw outcome.error ?? new Error('Download cancelled.');

    resetTitleProgress();
    progressBar.style.width = '100%';
    setStatusSuccess({
      card,
      iconContainer,
      titleEl: statusTitle,
      messageEl: statusMessage,
      title: 'Download Complete!',
      message: downloadState.isEncrypted
        ? `Your file "${downloadState.fileName}" has been successfully decrypted and saved.`
        : `Your file "${downloadState.fileName}" has been successfully saved.`,
    });
  } catch (error) {
    if (error) console.error(error);
    resetTitleProgress();
    progressContainer.style.display = 'none';
    downloadButton.textContent = 'Retry Download';
    downloadButton.style.display = 'inline-block';
    downloadButton.disabled = false;

    setStatusError({
      card,
      iconContainer,
      titleEl: statusTitle,
      messageEl: statusMessage,
      title: 'Download Failed',
      message: error.message || 'The link may be incorrect, expired, or the download failed.',
    });
  }
}

/**
 * Takes a lease for one download, for the browser to download the file
 * itself. While others are downloading every copy the upload allows, the
 * server says to wait, and the page asks again when it says to.
 */
async function takeLease(id) {
  for (;;) {
    const res = await fetch(`/api/v4/objects/${encodeURIComponent(id)}/leases`, {
      method: 'POST',
      credentials: 'omit',
      headers: { Accept: 'application/json' },
    });
    const body = await res.json().catch(() => null);
    if (res.status === 423) {
      statusTitle.textContent = 'Waiting';
      statusMessage.textContent = 'Someone is downloading this right now.';
      const seconds = Number(res.headers.get('Retry-After'));
      await new Promise((resolve) => setTimeout(resolve, (Number.isFinite(seconds) ? Math.min(seconds, 60) : 5) * 1000));
      continue;
    }
    if (!res.ok || typeof body?.lease !== 'string') {
      throw new Error(body?.error || 'The download could not start.');
    }
    return body.lease;
  }
}

async function loadMetadata() {
  const id = window.location.pathname.split('/').pop();
  if (!id) {
    showError('Invalid Link', 'The file ID is missing from this link.');
    return;
  }

  downloadState.id = id;
  fileIdEl.textContent = id;

  try {
    // The secret is after the #, and never leaves this page. Core opens the
    // files' names with it, and gives their sizes as they will be saved. The
    // upload is opened with no lease: one is only taken to download.
    const secret = window.location.hash.substring(1);
    let opened;
    try {
      opened = await client.hosted.open({ id, secret: secret || undefined });
    } catch (error) {
      // Only an encrypted file needs the secret, and Web Crypto to read it.
      if (DropgateError.is(error, 'KEY_REQUIRED') || DropgateError.is(error, 'RUNTIME_UNSUPPORTED')) {
        fileEncryptionEl.textContent = 'End-to-End Encrypted';
        trustStatement.style.display = 'block';
        encryptionStatement.style.display = 'block';
        if (!window.isSecureContext) {
          showError('Secure Connection Required', 'Encrypted files can only be downloaded over HTTPS.');
        } else {
          showError('Missing Decryption Key', 'The decryption key was not found in the URL.');
        }
        return;
      }
      throw error;
    }

    const { metadata } = opened;
    if (metadata.files.length > 1) {
      showBundle({ id, opened, format: formatBytes, takeLease });
      return;
    }
    // One file is downloaded on its own lease, released as soon as it's saved, so
    // at its download limit it's gone at once. The opened upload, with no lease, holds nothing.
    opened.close();
    const [file] = metadata.files;
    downloadState.isEncrypted = metadata.encrypted;
    downloadState.sizeBytes = file.size;
    downloadState.secret = metadata.encrypted ? secret : null;
    // Shown and saved under its safe name: the one file name rule.
    downloadState.fileName = filenames.sanitize(file.name);
    fileEncryptionEl.textContent = metadata.encrypted ? 'End-to-End Encrypted' : 'None';
    fileSizeEl.textContent = formatBytes(file.size);

    trustStatement.style.display = 'block';

    if (metadata.encrypted) {
      encryptionStatement.style.display = 'block';

      if (!window.isSecureContext) {
        showError('Secure Connection Required', 'Encrypted files can only be downloaded over HTTPS.');
        return;
      }
    }

    fileNameEl.textContent = downloadState.fileName || 'Unknown';
    fileDetails.style.display = 'block';
    downloadButton.style.display = 'inline-block';
    downloadButton.addEventListener('click', startDownload);
    statusTitle.textContent = 'Ready to Download';
    statusMessage.textContent = 'Review the file details below, then click Start Download.';
  } catch (error) {
    console.error(error);
    resetTitleProgress();
    if (DropgateError.is(error, 'DECRYPT_FAILED')) {
      showError('Wrong Link', "This link's key doesn't open the upload. Check that the whole link was copied.");
    } else if (DropgateError.is(error, 'NOT_FOUND')) {
      showError('File Not Found', 'This file may have expired, been downloaded, or been deleted.');
    } else {
      showError('Download Error', 'We could not load the file details. Please try again later.');
    }
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', loadMetadata);
} else {
  loadMetadata();
}