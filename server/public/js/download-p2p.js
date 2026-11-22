import { NOT_A_CODE, mountCodeInput } from './code-input.js';
import { DropgateError, codes, filenames, hosts } from './dropgate-core.js';
import { bundleZipName, countOf, formatBytes, formatDeadline, pageClient, saveStream, showServerVersion } from './page-common.js';
import { setStatusError, setStatusSuccess, setStatusWarning, StatusType, Icons, updateStatusCard, clearStatusBorder } from './status-card.js';

// A direct transfer's receive page, /p2p. What it receives is after the #,
// which a browser never sends: a link's secret (43 characters), or a code
// someone typed on the home page. It's read here, on this device:
// - a link shows "Ready to Connect", and nothing is asked of the server, or
//   anyone, until Connect is clicked; then the address becomes /p2p, and the
//   secret is kept in this page's memory only, for Retry;
// - a code is taken out of the address (/p2p, in its place in the tab's
//   history) before anything else happens, and connects at once;
// - with nothing after the #, the page asks for a code.
// Then the files and their size, Download (into StreamSaver, which hands the
// file to the browser's own downloads; several files as one ZIP) or Decline,
// Pause and Resume, Cancel, and how it ended, in core's words.

const DIRECT_LINK_SECRET = /^[A-Za-z0-9_-]{43}$/;

/** What came after the #: a link's secret, a code, nothing, or something else. */
function readFragment() {
  const raw = location.hash.slice(1);
  if (!raw) return { kind: 'none' };
  if (DIRECT_LINK_SECRET.test(raw)) return { kind: 'link', secret: raw };
  let typed = raw;
  try {
    typed = decodeURIComponent(raw);
  } catch {
    // Not percent-encoded text: read as it is.
  }
  if (codes.isLike(typed)) return { kind: 'code', code: typed };
  return { kind: 'invalid' };
}

/** The address without what came after the #, in the same place in the tab's history. */
function clearAddress() {
  history.replaceState(null, '', location.pathname);
}

// A code (or anything that isn't a link) goes from the address before anything else is done.
const arrived = readFragment();
if (arrived.kind === 'code' || arrived.kind === 'invalid') clearAddress();

const $ = (id) => document.getElementById(id);
const card = $('status-card');
const iconContainer = $('icon-container');
const elTitle = $('title');
const elMsg = $('message');
const elMeta = $('meta');
const elConnect = $('connect-button');
const elFileDetails = $('file-details');
const elFileNameLabel = $('file-name-label');
const elFileName = $('file-name');
const elFileSizeLabel = $('file-size-label');
const elFileSize = $('file-size');
const elListContainer = $('p2p-file-list-container');
const elToggleList = $('p2p-toggle-file-list');
const elToggleListText = $('p2p-toggle-file-list-text');
const elList = $('p2p-file-list');
const elListItems = $('p2p-file-list-items');
const elOfferActions = $('offer-actions');
const elDownload = $('download-button');
const elDecline = $('decline-button');
const elProgress = $('progress-container');
const elBar = $('bar');
const elBytes = $('bytes');
const elPause = $('pause-button');
const elResume = $('resume-button');
const elCancel = $('cancel-button');
const elRetry = $('retry-button');
const elCodeCard = $('code-card');

const client = pageClient();

/** The one transfer this page runs: its handle, how it was reached, and what it was offered. */
let current = null;
let versionShown = false;

const show = (el, shown) => { el.hidden = !shown; };
const setText = (el, text) => { el.textContent = text; };
/** The text core gives with the one-character ellipsis, as the desktop app writes it. */
const tidy = (text) => String(text ?? '').replace(/\.\.\.$/, '…');

// The tab's title shows how far the transfer has got.
const originalTitle = document.title;
const setTitleProgress = (percent, paused) => {
  if (paused) document.title = `Paused - ${originalTitle}`;
  else if (percent > 1 && percent < 100) document.title = `${Math.floor(percent)}% - ${originalTitle}`;
  else document.title = originalTitle;
};

/** Every button and part that belongs to one step, hidden. */
function hideSteps() {
  for (const el of [elConnect, elFileDetails, elOfferActions, elProgress, elPause, elResume, elCancel, elRetry, elCodeCard]) show(el, false);
  setText(elMeta, '');
}

function showStatus({ status = StatusType.PRIMARY, icon = Icons.SYNC, title, message }) {
  updateStatusCard({ card, iconContainer, titleEl: elTitle, messageEl: elMsg, status, icon, title, message });
}

/**
 * The page can't receive here, so it never connects: no code is spent, and
 * the sender is never told anyone came.
 */
function cannotReceive(title, message) {
  hideSteps();
  setStatusError({ card, iconContainer, titleEl: elTitle, messageEl: elMsg, title, message });
}

/** Why this browser can't receive a direct transfer here, or null if it can. */
function whyNotHere() {
  if (!hosts.isSecureForDirect(location.hostname, window.isSecureContext)) {
    return ['Secure Connection Required', 'Direct transfers need this page to be opened over HTTPS.'];
  }
  if (typeof window.RTCPeerConnection !== 'function') {
    return ["Browser Can't Connect", "This browser can't make direct transfers. Try another browser."];
  }
  if (!window.streamSaver?.createWriteStream) {
    return ["Can't Save Here", "This browser can't save the download here."];
  }
  return null;
}

// ---------------------------------------------------------------------------
// Each way in.

/** A link: "Ready to Connect", and nothing more until Connect. */
function readyToConnect(secret) {
  hideSteps();
  clearStatusBorder(card);
  showStatus({ icon: Icons.WIFI_TETHERING, title: 'Ready to Connect', message: 'Connect to the sender to see the files they are sending.' });
  show(elConnect, true);
  elConnect.disabled = false;
  elConnect.onclick = () => {
    elConnect.disabled = true;
    // The secret leaves the address now, kept in this page's memory for Retry.
    clearAddress();
    void receive({ link: `${location.origin}${location.pathname}#${secret}` }, { retry: () => receive({ link: `${location.origin}${location.pathname}#${secret}` }) });
  };
}

/** No code or link: the code entry. */
function askForCode(message) {
  hideSteps();
  clearStatusBorder(card);
  showStatus({ icon: Icons.WIFI_TETHERING, title: 'Receive Files', message: message ?? 'Enter the sharing code the sender gave you.' });
  show(elCodeCard, true);
  codeEntry.clear();
}

/** A link pasted into the code entry: another direct link's Ready to Connect, here; any other its own page. */
async function openPastedLink(link) {
  codeEntry.setStatus({ message: 'Opening the link…', busy: true });
  try {
    const result = await client.links.resolve(link, { timeoutMs: 5000 });
    if (!result?.valid || !result?.target) {
      const reason = result?.reason;
      codeEntry.setStatus({ message: !reason || reason.startsWith('Unrecognised') ? NOT_A_CODE : reason, error: true });
      return;
    }
    const target = new URL(result.target, location.origin);
    if (target.pathname === location.pathname && DIRECT_LINK_SECRET.test(target.hash.slice(1))) {
      history.replaceState(null, '', target.href);
      readyToConnect(target.hash.slice(1));
      return;
    }
    window.location.href = target.href;
  } catch (err) {
    console.error(err);
    codeEntry.setStatus({ message: err?.message || "That code or link couldn't be checked.", error: true });
  }
}

// ---------------------------------------------------------------------------
// Receiving.

/**
 * Connects by link or code, shows the offer, then the transfer and how it
 * ended. `retry`, for a link, starts again from this page's memory.
 */
async function receive(by, { retry } = {}) {
  hideSteps();
  clearStatusBorder(card);
  showStatus({ title: 'Connecting…', message: 'Connecting to the sender…' });
  if (!versionShown) {
    versionShown = true;
    void showServerVersion(client);
  }

  let handle;
  try {
    handle = await client.direct.receive(by);
  } catch (err) {
    // Refused on this device before anything was sent: a code that isn't one.
    console.error(err);
    showEnded({ status: 'failed', error: err }, { retry });
    return;
  }
  const transfer = { handle, offer: null, declined: false, files: 0, retry };
  current = transfer;

  elCancel.onclick = () => {
    elCancel.disabled = true;
    handle.cancel();
  };
  elPause.onclick = () => pauseOrResume(transfer, 'pause');
  elResume.onclick = () => pauseOrResume(transfer, 'resume');
  show(elCancel, true);
  elCancel.disabled = false;

  handle.subscribe((snapshot) => {
    if (current === transfer) render(snapshot);
  });

  handle.offer().then((offer) => {
    if (current === transfer && handle.snapshot.status === 'offered') showOffer(transfer, offer);
  }, () => undefined);

  const outcome = await handle.result;
  if (current !== transfer) return;
  current = null;
  showEnded(outcome, { declined: transfer.declined, retry, files: transfer.files });
}

/** The files and their size, Download and Decline. */
function showOffer(transfer, offer) {
  transfer.offer = offer;
  transfer.files = offer.files.length;
  const several = offer.files.length > 1;
  hideSteps();
  clearStatusBorder(card);
  showStatus({ icon: Icons.DOWNLOAD, title: 'Ready to Download', message: 'Review the details below, then click Download.' });
  // Shown and saved under its safe name: the one file name rule.
  setText(elFileNameLabel, several ? 'Files' : 'File name');
  setText(elFileName, several ? countOf(offer.files.length, 'file') : filenames.sanitize(offer.files[0].name));
  setText(elFileSizeLabel, several ? 'Total size' : 'File size');
  setText(elFileSize, formatBytes(offer.totalSize));
  if (several) buildFileList(offer.files);
  show(elListContainer, several);
  show(elFileDetails, true);
  show(elOfferActions, true);
  elDownload.disabled = false;
  elDecline.disabled = false;
  elDownload.onclick = () => download(transfer);
  elDecline.onclick = () => {
    elDownload.disabled = true;
    elDecline.disabled = true;
    transfer.declined = true;
    transfer.handle.decline().catch((err) => console.error(err));
  };
}

function buildFileList(files) {
  elListItems.replaceChildren(...files.map((f) => {
    const li = document.createElement('li');
    li.className = 'list-group-item d-flex justify-content-between align-items-center py-2';
    const name = document.createElement('span');
    name.className = 'text-truncate me-2';
    name.textContent = filenames.sanitize(f.name);
    name.title = name.textContent;
    const size = document.createElement('span');
    size.className = 'text-body-secondary small flex-shrink-0';
    size.textContent = formatBytes(f.size);
    li.append(name, size);
    return li;
  }));
  show(elList, false);
  elToggleList.setAttribute('aria-expanded', 'false');
  setText(elToggleListText, 'Show Files');
}

elToggleList.addEventListener('click', () => {
  const open = elList.hidden;
  show(elList, open);
  elToggleList.setAttribute('aria-expanded', String(open));
  elToggleList.querySelector('.material-icons-round').textContent = open ? 'expand_less' : 'expand_more';
  setText(elToggleListText, open ? 'Hide Files' : 'Show Files');
});

/**
 * Download: StreamSaver is the sink, handing what arrives to the browser's
 * own downloads (several files as one ZIP). Without one there's nothing to
 * save into, so nothing is accepted: the transfer is cancelled instead.
 */
async function download(transfer) {
  elDownload.disabled = true;
  elDecline.disabled = true;
  const { offer, handle } = transfer;
  const several = offer.files.length > 1;
  let sink;
  try {
    if (!window.streamSaver?.createWriteStream) throw new Error('StreamSaver is not here.');
    const name = several ? bundleZipName() : filenames.sanitize(offer.files[0].name);
    sink = saveStream(name, several ? {} : { size: offer.totalSize }).getWriter();
  } catch (err) {
    console.error(err);
    current = null;
    handle.cancel();
    cannotReceive("Can't Save Here", "This browser can't save the download here.");
    return;
  }
  try {
    await handle.accept({ sink, asZip: several, handOff: true });
  } catch (err) {
    // The transfer ended first: its outcome shows how.
    console.error(err);
  }
}

/** The page as the handle's snapshot says, while it runs. */
function render(snapshot) {
  const { status, text, percent, processedBytes, totalBytes, pausedBy, deadline, stalled } = snapshot;
  if (status === 'connecting') {
    showStatus({ title: 'Connecting…', message: tidy(text) });
    return;
  }
  if (status === 'offered') return; // showOffer() has it, once the offer is read.
  if (!['transferring', 'paused', 'finalising'].includes(status)) return;

  show(elFileDetails, false);
  show(elOfferActions, false);
  show(elProgress, true);
  elBar.style.width = `${percent}%`;
  setText(elBytes, `${formatBytes(processedBytes)} / ${formatBytes(totalBytes)}`);
  const paused = status === 'paused';
  setTitleProgress(percent, paused);

  if (paused) {
    // Who paused it, and with a pause limit, when it ends.
    const until = deadline ? ` The transfer ends at ${formatDeadline(deadline)} unless it's resumed.` : '';
    updateStatusCard({ card, iconContainer, status: StatusType.WARNING, icon: 'pause_circle', titleEl: elTitle, messageEl: elMsg, title: 'Transfer Paused', message: `${text}${until}` });
  } else if (status === 'finalising') {
    showStatus({ icon: Icons.DOWNLOAD, title: 'Receiving…', message: tidy(text) });
  } else {
    showStatus({ icon: Icons.DOWNLOAD, title: 'Receiving…', message: 'Keep this tab open until the transfer completes.' });
  }
  setText(elMeta, stalled ? 'Stalled' : '');

  const ownHold = pausedBy === 'self' || pausedBy === 'both';
  show(elPause, status !== 'finalising' && !ownHold);
  elPause.disabled = !snapshot.canPause;
  show(elResume, status !== 'finalising' && ownHold);
  show(elCancel, true);
}

/** Pauses or resumes. The snapshots show the result; a transfer that ends meanwhile shows its outcome. */
async function pauseOrResume(transfer, action) {
  const button = action === 'pause' ? elPause : elResume;
  button.disabled = true;
  try {
    await transfer.handle[action]();
  } catch (err) {
    // It moved on before the click landed.
    if (!DropgateError.is(err, 'PAUSE_UNAVAILABLE')) console.error(err);
  } finally {
    button.disabled = false;
    if (current === transfer) render(transfer.handle.snapshot);
  }
}

/** How it ended, in core's words. */
function showEnded(outcome, { declined = false, retry, files = 0 } = {}) {
  hideSteps();
  setTitleProgress(0, false);
  if (outcome.status === 'completed') {
    const message = outcome.value.assurance === 'handed-off' ? 'Handed to your browser. Check your downloads.' : 'Download complete.';
    setStatusSuccess({ card, iconContainer, titleEl: elTitle, messageEl: elMsg, title: 'Transfer Complete', message });
    show(elProgress, true);
    elBar.style.width = '100%';
    setText(elBytes, `${formatBytes(outcome.value.totalBytes)} / ${formatBytes(outcome.value.totalBytes)}`);
    setText(elMeta, files > 1 ? `${countOf(files, 'file')}, as one ZIP.` : '');
    return;
  }
  if (outcome.status === 'cancelled') {
    const by = outcome.cancellation.by;
    const message = by === 'peer' ? 'The sender cancelled the transfer.'
      : declined ? 'You declined the transfer.' : 'You cancelled the transfer.';
    setStatusWarning({ card, iconContainer, titleEl: elTitle, messageEl: elMsg, title: declined ? 'Transfer Declined' : 'Transfer Cancelled', message });
    return;
  }
  const error = outcome.error;
  setStatusError({ card, iconContainer, titleEl: elTitle, messageEl: elMsg, title: 'Transfer Failed', message: error?.message || 'The transfer stopped.' });
  if (retry) {
    // A link can be tried again: its transfer may still be there.
    show(elRetry, true);
    elRetry.disabled = false;
    elRetry.onclick = () => void retry();
  } else {
    // A code is spent once tried: the sender has a new one.
    show(elCodeCard, true);
    codeEntry.clear();
    if (DropgateError.is(error, 'CODE_MISMATCH') || DropgateError.is(error, 'NOT_FOUND')) {
      codeEntry.setStatus({ message: 'Ask the sender for the code their page shows now.', error: true });
    }
  }
}

// ---------------------------------------------------------------------------

// The code entry: once all eight are in, the code connects here; a pasted link opens.
const codeEntry = mountCodeInput($('code-entry'), {
  onGo: (code) => void receive({ code }),
  onLink: (link) => void openPastedLink(link),
});

// Closing the page, or leaving it, ends the transfer, and tells the sender so (best effort).
window.addEventListener('pagehide', () => client.direct.appClosing());
// Back from the back-forward cache, it has ended: the page starts again.
window.addEventListener('pageshow', (event) => { if (event.persisted) window.location.reload(); });
// Something new after the # (typed into the address bar) is a new page.
window.addEventListener('hashchange', () => { if (!current) window.location.reload(); });

function start() {
  const why = whyNotHere();
  if (arrived.kind === 'invalid') {
    askForCode();
    setStatusError({ card, iconContainer, titleEl: elTitle, messageEl: elMsg, title: 'Invalid Link', message: "This link isn't complete, or isn't a Dropgate link. Check that the whole link was copied." });
    return;
  }
  if (why && arrived.kind !== 'none') {
    cannotReceive(...why);
    return;
  }
  if (arrived.kind === 'link') readyToConnect(arrived.secret);
  else if (arrived.kind === 'code') void receive({ code: arrived.code });
  else if (why) cannotReceive(...why);
  else askForCode();
}

start();
