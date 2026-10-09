import { DropgateClient, DropgateError, lifetime } from './dropgate-core.js';

// The page: Dropgate's Upload section and its Server tab, in the kit's frame
// (kit.ui.mountShell()): the nav rail, the header, and the Settings view, with
// Update and Credits after Dropgate's own tab. The drop zone, the action bar,
// the prompts and the toasts are the kit's too. The settings are the kit's
// (window.kitAPI), saved as they change. The same page runs hidden for Share
// with Dropgate, which main hands its files (onBackgroundUploadStart).

const api = window.electronAPI;
const kitApi = window.kitAPI;

/**
 * A file on disk, as one of core's file sources: core asks for one range of
 * bytes at a time (read()), and main reads just that range, for a file it has
 * handed this page. Like a browser's File, it can't be read once the file has
 * changed since it was chosen (main checks its size and modification time), so
 * a file edited during an upload, or while it's paused, is never sent part
 * old, part new: the upload fails SOURCE_UNAVAILABLE, as core's own
 * sources.fileHandle() does.
 */
class LazyFile {
    constructor(filePath, name, size) {
        this.filePath = filePath;
        this.name = name;
        this.size = size;
    }

    async read(start, end) {
        // IPC gives a Uint8Array (main's Buffer); core checks it has every byte asked for.
        const bytes = await api.readFileRange(this.filePath, start, end);
        if (bytes?.changed) {
            throw new DropgateError({
                code: 'SOURCE_UNAVAILABLE',
                message: "A file changed after the upload started, so the rest of it can't be read as it was.",
            });
        }
        return bytes;
    }
}

/** What Restart Now says while an upload runs, in this window or another. */
const BUSY_REASON = 'An upload is in progress.';

document.addEventListener('DOMContentLoaded', async () => {
    // The files the app is opened with (#93): "Open with", files dropped on its
    // icon, a second launch. The kit can push them while the page is still
    // setting itself up, so they wait for it.
    const opened = [];
    let addOpened = null;
    kitApi.onFilesOpened((paths) => (addOpened ? addOpened(paths) : opened.push(...paths)));

    try {
        // --- DOM Element References ---
        const $ = (id) => document.getElementById(id);
        const uploadView = $('upload-view');
        const emptyState = $('empty-state');
        const fileInput = $('file-input');
        const browseMoreBtn = $('browse-more-btn');
        const fileListSection = $('file-list-section');
        const fileListContainer = $('file-list');
        const fileCount = $('file-count');
        const fileChosenTotal = $('file-chosen-total');
        const maxUploadHint = $('max-upload-hint');
        const serverUrlInput = $('server-url');
        const testConnectionBtn = $('test-connection-btn');
        const connectionStatus = $('connection-status');
        const fileLifetimeValueInput = $('file-lifetime-value');
        const fileLifetimeUnitSelect = $('file-lifetime-unit');
        const fileLifetimeHelp = $('file-lifetime-help');
        const maxDownloadsValue = $('max-downloads-value');
        const maxDownloadsHelp = $('max-downloads-help');
        const securityStatus = $('security-status');
        const securityIcon = $('security-icon');
        const securityText = $('security-text');
        const linkSection = $('link-section');
        const downloadLinkInput = $('download-link');
        const copyBtn = $('copy-btn');
        const keepLogSwitch = $('keep-log-on-disk');

        // Share with Dropgate is Windows' right-click entry: elsewhere, the Server tab doesn't mention it.
        if (!navigator.userAgent.includes('Windows')) $('server-help').textContent = 'Uploads go to this server.';

        let serverCapabilities = null;
        let selectedFiles = [];
        /** @type {{compatible:boolean, message?:string}} */
        let lastServerCheck = { compatible: false, message: '' };
        let activeUpload = null;
        // Tells main where the upload this window runs is (performUpload()), so the buttons can be set again after a click.
        let reportUpload = null;
        // The notification before a paused upload's server drops it: its timer, and the deadline it's for.
        let pauseEnding = { timer: null, deadline: null };
        // Whether this window shows an upload running: its own, or one main tells it about.
        let uploading = false;
        let uploadsAllowed = false;

        // --- The frame ---
        const shell = kit.ui.mountShell({
            title: 'Dropgate Client',
            sections: [{ view: 'upload', label: 'Upload', icon: 'upload_file', element: uploadView }],
            settingsTabs: [
                { id: 'server', label: 'Server', render: (pane) => pane.append($('server-settings')) },
                { id: 'privacy', label: 'Privacy', render: (pane) => pane.append($('privacy-settings')) },
            ],
            credits: { logo: 'img/dropgate.png' },
            // Restart Now asks first while an upload runs here, or in a hidden window (Share with Dropgate).
            busy: async () => (uploading || await api.isUploading() ? BUSY_REASON : null),
        });

        // Files dropped anywhere in Upload, and the drop zone while there are none.
        const { zone } = kit.ui.dropZone(uploadView, {
            onPaths: (paths) => addPaths(paths),
            icon: 'upload_file',
            label: 'Drag & Drop Files Here',
            onBrowse: () => fileInput.click(),
        });
        emptyState.append(zone);

        const actions = kit.ui.actionBar({
            run: { label: 'Upload', onClick: () => performUpload() },
            // Main passes it on to whichever window runs the upload.
            abort: { onClick: () => api.cancelUpload() },
            clear: { onClick: () => clearFiles() },
            progressLabel: 'Upload progress',
        });
        $('action-bar').append(actions.element);
        actions.update({ canRun: false, canClear: false });

        // Pause Upload and Resume Upload, beside Cancel while an upload runs, on
        // a server that lets uploads pause. The kit's action bar has no place
        // for them, so they're the app's own, as a transfer's own buttons are
        // (Will, 2026-10-09). Main passes a click on to whichever window runs
        // the upload, as it does Cancel.
        const pauseButton = (label, paused) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'btn btn-outline-secondary';
            button.textContent = label;
            button.hidden = true;
            button.addEventListener('click', () => {
                button.disabled = true;
                api.pauseUpload(paused);
            });
            return button;
        };
        const pauseBtn = pauseButton('Pause Upload', true);
        const resumeBtn = pauseButton('Resume Upload', false);
        // Just before Cancel, the bar's danger button.
        actions.element.querySelector('.kit-action-buttons > .btn-danger').before(pauseBtn, resumeBtn);

        /** Pause while the upload runs, Resume while it's paused, each usable only when core says it can be now. */
        function showPauseControls({ pausable = false, paused = false, canPause = false } = {}) {
            pauseBtn.hidden = !pausable || paused;
            pauseBtn.disabled = !canPause;
            resumeBtn.hidden = !paused;
            resumeBtn.disabled = !(paused && canPause);
        }

        /** Say what's happening, on the action bar's status line. */
        function setStatus(text) {
            actions.update({ summary: text });
        }

        // --- Core client (shared logic for Electron + Web UI) ---
        // The app's own name and version, for display only: core works out
        // compatibility with the server itself, and never sends these.
        const appInfo = { name: 'Dropgate Client', version: await kitApi.getVersion() };
        /** @type {DropgateClient|null} */
        let coreClient = null;

        /** Whether an address is plain HTTP, as typed: one without a scheme is HTTPS. */
        const isPlainHttp = (serverUrl) => /^http:\/\//i.test(serverUrl);

        /**
         * Create or recreate the core client for a given server URL.
         * Must be called whenever the server URL changes.
         */
        function createClient(serverUrl) {
            if (!serverUrl) {
                coreClient = null;
                return;
            }
            coreClient = new DropgateClient({
                server: serverUrl,
                // Only an address typed with http:// is used over plain HTTP, and
                // then as it is: an https:// one is never retried over HTTP.
                allowInsecure: isPlainHttp(serverUrl),
                appInfo,
            });
        }

        /** Why Test couldn't connect, and what to try. */
        function connectionFailedText(serverUrl, error) {
            if (error?.code === 'REDIRECT_NOT_FOLLOWED') return error.message;
            const text = 'Connection failed. Check the URL, and that the server is running.';
            return isPlainHttp(serverUrl) ? text : `${text} If the server only serves plain HTTP, enter its address starting with http://.`;
        }

        // --- Initial Settings Load ---
        const settings = await kitApi.getSettings();
        serverUrlInput.value = settings.serverURL;
        fileLifetimeValueInput.value = settings.lifetimeValue;
        fileLifetimeUnitSelect.value = settings.lifetimeUnit;
        if (fileLifetimeUnitSelect.value === 'unlimited') {
            fileLifetimeValueInput.disabled = true;
            fileLifetimeValueInput.value = 0;
        }
        maxDownloadsValue.value = settings.maxDownloads;
        // The kit's own setting: on, the redacted log is kept in debug.log too; off, that file is deleted.
        keepLogSwitch.checked = settings.keepLogOnDisk;
        keepLogSwitch.addEventListener('change', () => kitApi.setSettings({ keepLogOnDisk: keepLogSwitch.checked }));

        // Create initial client with loaded server URL
        createClient(serverUrlInput.value.trim());

        await checkServerCompatibility();

        // --- Event Listeners ---
        const updateLifetimeSettings = () => {
            const isUnlimited = fileLifetimeUnitSelect.value === 'unlimited';
            fileLifetimeValueInput.disabled = isUnlimited;

            if (isUnlimited) {
                fileLifetimeValueInput.value = 0;
            } else {
                const value = parseFloat(fileLifetimeValueInput.value);
                if (isNaN(value) || value <= 0) {
                    fileLifetimeValueInput.value = 0.5;
                }
            }
            updateUploadButtonState();
            saveSettings();
        };

        const updateMaxDownloadsSettings = () => {
            if (maxDownloadsValue.value === '') {
                maxDownloadsValue.value = 1;
            }
            updateUploadButtonState();
            saveSettings();
        };

        fileLifetimeValueInput.addEventListener('blur', () => updateLifetimeSettings());
        fileLifetimeValueInput.addEventListener('input', () => updateLifetimeSettings());
        fileLifetimeUnitSelect.addEventListener('change', () => updateLifetimeSettings());
        maxDownloadsValue.addEventListener('input', () => updateMaxDownloadsSettings());
        maxDownloadsValue.addEventListener('blur', () => updateMaxDownloadsSettings());

        browseMoreBtn.addEventListener('click', () => fileInput.click());
        fileInput.addEventListener('change', (e) => {
            if (e.target.files && e.target.files.length) {
                handleFiles(Array.from(e.target.files));
                fileInput.value = '';
            }
        });

        // The server is kept as it's changed, and as Test finds it.
        serverUrlInput.addEventListener('change', () => saveServer(serverUrlInput.value.trim()));

        testConnectionBtn.addEventListener('click', async () => {
            const serverUrl = serverUrlInput.value.trim();
            if (!serverUrl) {
                updateUploadabilityState(false);
                connectionStatus.textContent = 'Enter a server URL.';
                connectionStatus.className = 'form-text reserved text-warning-emphasis';
                return;
            }

            testConnectionBtn.disabled = true;
            testConnectionBtn.textContent = 'Testing…';
            connectionStatus.textContent = 'Checking server…';
            connectionStatus.className = 'form-text reserved';

            try {
                // Recreate client with current URL
                createClient(serverUrl);
                await coreClient.server.connect({ timeoutMs: 5000 });

                if (coreClient.server.baseUrl.startsWith('https://')) {
                    connectionStatus.textContent = 'Connection successful (HTTPS).';
                    connectionStatus.className = 'form-text reserved text-success-emphasis';
                } else {
                    connectionStatus.textContent = 'Connection successful (HTTP), but the connection is insecure.';
                    connectionStatus.className = 'form-text reserved text-warning-emphasis';
                }

                // The address as the client reads it: https:// added if it had no scheme.
                serverUrlInput.value = coreClient.server.baseUrl;
                await saveServer(coreClient.server.baseUrl);

                await checkServerCompatibility();
            } catch (error) {
                connectionStatus.textContent = connectionFailedText(serverUrl, error);
                updateUploadabilityState(false);
                connectionStatus.className = 'form-text reserved text-danger-emphasis';
            } finally {
                testConnectionBtn.disabled = uploading;
                testConnectionBtn.textContent = 'Test';
            }
        });

        // Copied by main, kept out of the clipboard's history and sync: the link holds the key.
        copyBtn.addEventListener('click', async () => {
            try {
                await api.copyLink(downloadLinkInput.value);
                kit.ui.toast('Link copied.', { type: 'success' });
            } catch {
                kit.ui.toast("Couldn't copy the link.", { type: 'danger' });
            }
        });

        // --- IPC Listeners (Communication from Main Process) ---

        // An upload's progress and outcome, from this window or a hidden one.
        api.onUploadStatus((event) => {
            switch (event.type) {
                case 'progress':
                    {
                        const { text, percent } = event.data;
                        if (text) setStatus(text);
                        uploading = true;
                        actions.update({ running: true, ...(percent !== undefined ? { percent } : {}) });
                        showPauseControls(event.data);
                        linkSection.classList.add('d-none');
                        break;
                    }
                case 'success':
                    {
                        const { link } = event.data;
                        downloadLinkInput.value = link;
                        linkSection.classList.remove('d-none');
                        uploading = false;
                        showPauseControls();
                        setStatus('Upload successful.');
                        actions.update({ running: false, percent: 100 });
                        resetUI();
                        break;
                    }
                case 'error':
                    {
                        const { error } = event.data;
                        uploading = false;
                        showPauseControls();
                        setStatus(`Upload failed: ${error}`);
                        actions.update({ running: false });
                        kit.ui.toast(`Upload failed: ${error}`, { type: 'danger' });
                        resetUI(false);
                        break;
                    }
                case 'cancelled':
                    {
                        uploading = false;
                        showPauseControls();
                        setStatus('Upload cancelled.');
                        actions.update({ running: false });
                        resetUI(false);
                        break;
                    }
            }
        });

        // Cancel the upload this window runs (main passes on a Cancel from any window).
        api.onCancelUpload(() => {
            if (activeUpload) {
                activeUpload.cancel();
                activeUpload = null;
            }
        });

        // Pause or resume the upload this window runs (main passes on Pause Upload and Resume Upload from any window).
        api.onPauseUpload(async (paused) => {
            const upload = activeUpload;
            if (!upload) return;
            try {
                await (paused ? upload.pause() : upload.resume());
            } catch (error) {
                const ended = !['initializing', 'uploading', 'paused', 'completing'].includes(upload.snapshot.status);
                // It moved on before the click landed: it's finishing, or a pause is already settling.
                if (!ended && !DropgateError.is(error, 'PAUSE_UNAVAILABLE')) {
                    // The server refused the pause, or couldn't be asked to resume: nothing changed.
                    kit.ui.toast(error?.message || (paused ? "The upload couldn't be paused." : "The upload couldn't be resumed."), { type: 'warning' });
                }
            } finally {
                // The buttons, as the upload is now: a click disabled its own.
                if (activeUpload === upload) reportUpload?.(upload.snapshot);
            }
        });

        // A file picked with the menu's Open File
        api.onFileOpened((file) => {
            if (file && file.filePath) handleFiles([new LazyFile(file.filePath, file.name, file.size)]);
        });
        api.onFileOpenError((message) => kit.ui.toast(message, { type: 'danger' }));

        // Share with Dropgate: main hands this hidden window its files.
        api.onBackgroundUploadStart(async (details) => {
            if (!details?.files?.length) return;
            selectedFiles = details.files.map(f => new LazyFile(f.filePath, f.name, f.size));

            const saved = await kitApi.getSettings();
            if (!saved.serverURL) {
                api.uploadFinished({ status: 'error', error: 'Server URL is not configured.' });
                return;
            }
            serverUrlInput.value = saved.serverURL;
            createClient(saved.serverURL);
            await performUpload();
        });

        /** Files dropped on Upload, by path: main checks each, and hands over the files. */
        async function addPaths(paths) {
            if (uploading || !uploadsAllowed) return;
            const { files, folders } = await api.addFiles(paths);
            if (folders > 0) kit.ui.toast(`Skipped ${kit.format.countOf(folders, 'folder')}: folders can't be uploaded.`, { type: 'warning' });
            handleFiles(files.map((f) => new LazyFile(f.filePath, f.name, f.size)));
        }

        /** Files the app was opened with: added to Upload, as Open File's are, and shown there. */
        async function addOpenedPaths(paths) {
            if (uploading) {
                kit.ui.toast(`Couldn't add ${kit.format.countOf(paths.length, 'file')}: an upload is running.`, { type: 'warning' });
                return;
            }
            shell.showView('upload');
            const { files, folders } = await api.addFiles(paths);
            if (folders > 0) kit.ui.toast(`Skipped ${kit.format.countOf(folders, 'folder')}: folders can't be uploaded.`, { type: 'warning' });
            handleFiles(files.map((f) => new LazyFile(f.filePath, f.name, f.size)));
        }

        function handleFiles(newFiles) {
            if (!newFiles || newFiles.length === 0) {
                return;
            }

            // Filter out empty files
            const valid = newFiles.filter(f => f.size > 0);
            const skipped = newFiles.length - valid.length;
            if (skipped > 0) {
                kit.ui.toast(`Skipped ${kit.format.countOf(skipped, 'empty file')}.`, { type: 'warning' });
            }

            // A file already in the list isn't added twice: by its path, or, picked with
            // Select Files, by its name, size and date.
            const keyOf = (f) => (f instanceof LazyFile ? `path:${f.filePath}` : `pick:${f.name}:${f.size}:${f.lastModified}`);
            const listed = new Set(selectedFiles.map(keyOf));
            const fresh = valid.filter((f) => {
                const key = keyOf(f);
                if (listed.has(key)) return false;
                listed.add(key);
                return true;
            });
            const repeated = valid.length - fresh.length;
            if (repeated > 0) {
                kit.ui.toast(`Skipped ${kit.format.countOf(repeated, 'file')} already in the list.`, { type: 'warning' });
            }

            if (fresh.length === 0) return;

            // Append to existing selection
            selectedFiles = [...selectedFiles, ...fresh];
            updateFileListUI();
            linkSection.classList.add('d-none');

            // Only enable upload if all conditions are met
            updateUploadButtonState();
        }

        function clearFiles() {
            for (const f of selectedFiles) {
                if (f instanceof LazyFile) api.revokeFileAccess(f.filePath);
            }
            selectedFiles = [];
            updateFileListUI();
            updateUploadButtonState();
        }

        function updateFileListUI() {
            const count = selectedFiles.length;
            const isEmpty = count === 0;

            emptyState.classList.toggle('d-none', !isEmpty);
            fileListSection.classList.toggle('d-none', isEmpty);
            if (isEmpty) return;

            fileCount.textContent = `${kit.format.countOf(count, 'file')} selected`;

            fileListContainer.replaceChildren();
            selectedFiles.forEach((f, i) => {
                const row = document.createElement('div');
                row.className = 'file-row';

                const icon = document.createElement('span');
                icon.className = 'material-icons-round text-secondary';
                icon.setAttribute('aria-hidden', 'true');
                icon.textContent = 'insert_drive_file';

                const name = document.createElement('span');
                name.className = 'file-row-name';
                name.textContent = f.name;
                name.title = f.name;

                const size = document.createElement('span');
                size.className = 'file-row-size';
                size.textContent = kit.format.formatBytes(f.size);

                const removeBtn = document.createElement('button');
                removeBtn.type = 'button';
                removeBtn.className = 'file-remove-btn';
                removeBtn.title = 'Remove file';
                removeBtn.setAttribute('aria-label', `Remove ${f.name}`);
                removeBtn.disabled = uploading;
                const removeIcon = document.createElement('span');
                removeIcon.className = 'material-icons-round';
                removeIcon.setAttribute('aria-hidden', 'true');
                removeIcon.textContent = 'close';
                removeBtn.append(removeIcon);
                removeBtn.addEventListener('click', () => {
                    const [removed] = selectedFiles.splice(i, 1);
                    if (removed instanceof LazyFile) api.revokeFileAccess(removed.filePath);
                    updateFileListUI();
                    updateUploadButtonState();
                });

                row.append(icon, name, size, removeBtn);
                fileListContainer.append(row);
            });

            const totalSize = selectedFiles.reduce((sum, f) => sum + f.size, 0);
            fileChosenTotal.textContent = kit.format.formatBytes(totalSize);
        }

        /**
         * The main upload logic.
         * It reports progress and final status back to the main process via IPC.
         */
        async function performUpload() {
            const serverCheck = await checkServerCompatibility();
            if (!serverCheck.compatible) {
                api.uploadFinished({ status: 'error', error: serverCheck.message || 'Server is not compatible.' });
                return;
            }

            if (fileLifetimeUnitSelect.value !== 'unlimited') {
                const value = parseFloat(fileLifetimeValueInput.value);
                if (isNaN(value) || value <= 0) fileLifetimeValueInput.value = 0.5;
            }

            if (!selectedFiles.length) {
                api.uploadFinished({ status: 'error', error: 'No files selected.' });
                return;
            }

            // Double check lifetime against server before starting
            if (!validateLifetimeInput()) {
                api.uploadFinished({
                    status: 'error',
                    error: fileLifetimeHelp.textContent || 'Invalid file lifetime.'
                });
                return;
            }

            const isTargetSecure = coreClient?.server.baseUrl.startsWith('https://') ?? false;
            const hasE2EE = serverCapabilities?.upload?.e2ee && isTargetSecure;

            // Check if E2EE is available - show warning if not
            if (!hasE2EE) {
                // Show the window if it's hidden (background upload) so user can see the prompt
                await api.showWindow();
                const confirmed = await kit.ui.confirm({
                    title: 'Upload Security Warning',
                    body: 'This server does not support end-to-end encryption. Your file will be uploaded without encryption.',
                    detail: 'The server administrator may be able to access your file contents.',
                    confirmLabel: 'Upload Anyway',
                    variant: 'warning',
                    icon: 'warning',
                });
                if (!confirmed) {
                    api.uploadFinished({
                        status: 'error',
                        error: 'Upload cancelled by user (insecure connection).'
                    });
                    return;
                }
            }

            const encrypt = hasE2EE; // Auto-set encryption based on capability

            const lifetimeMs = getLifetimeInMs();
            saveSettings();

            // Revoke main-process file access for any LazyFile instances after upload ends
            const revokeAllLazyFiles = () => {
                for (const f of selectedFiles) {
                    if (f instanceof LazyFile) api.revokeFileAccess(f.filePath);
                }
            };

            try {
                const files = [...selectedFiles];
                const upload = coreClient.hosted.upload({
                    files: files.length === 1 ? files[0] : files,
                    lifetimeMs,
                    maxDownloads: (() => {
                        const val = parseInt(maxDownloadsValue.value, 10);
                        return (Number.isInteger(val) && val >= 0) ? val : 1;
                    })(),
                    encrypt: encrypt,
                });

                // Whether the server lets an upload pause: its pause length is 0 when the operator has turned pausing off.
                const pausable = (serverCapabilities?.upload?.maxPauseMinutes ?? 0) > 0;

                // Where the upload is, while it runs. Core's snapshots never
                // name a file, so the name of the one an upload of several is
                // on comes from this page's own list.
                const report = (snapshot) => {
                    const { status, text, deadline } = snapshot;
                    if (status !== 'paused') warnBeforeDeadline(null);
                    if (!['initializing', 'uploading', 'paused', 'completing'].includes(status)) return;
                    const paused = status === 'paused';
                    const onFile = files.length > 1 && snapshot.phase === 'chunk';
                    const fileName = onFile ? files[snapshot.fileIndex]?.name : null;
                    let line = fileName ? `${text} — ${fileName}` : text;
                    // Paused, the server holds the upload until its deadline, and nothing resumes it but Resume Upload.
                    // Short, to fit the status line beside its buttons (Will, 2026-10-09).
                    if (paused && text === 'Paused.' && deadline) {
                        line = `Paused. Kept until ${formatDeadline(deadline)}.`;
                        warnBeforeDeadline(deadline);
                    }
                    api.uploadProgress({
                        text: line,
                        // The step alone, with no file name, for the window's title.
                        step: text,
                        percent: snapshot.percent,
                        pausable: pausable && ['initializing', 'uploading', 'paused'].includes(status),
                        paused,
                        canPause: snapshot.canPause,
                    });
                };
                reportUpload = report;
                report(upload.snapshot);
                upload.subscribe(report);

                activeUpload = upload;
                uploading = true;
                actions.update({ running: true });
                setUploadingState(true);

                // The upload's one outcome: completed, cancelled or failed.
                const outcome = await upload.result;

                warnBeforeDeadline(null);
                reportUpload = null;
                activeUpload = null;
                setUploadingState(false);
                revokeAllLazyFiles();

                if (outcome.status === 'completed') {
                    api.uploadFinished({ status: 'success', link: outcome.value.downloadUrl });
                } else if (outcome.status === 'cancelled') {
                    uploading = false;
                    actions.update({ running: false });
                    api.uploadFinished({ status: 'cancelled' });
                } else {
                    uploading = false;
                    actions.update({ running: false });
                    api.uploadFinished({ status: 'error', error: outcome.error.message });
                }
            } catch (error) {
                // Only an upload that never started gets here.
                activeUpload = null;
                uploading = false;
                actions.update({ running: false });
                setUploadingState(false);

                revokeAllLazyFiles();
                api.uploadFinished({
                    status: 'error',
                    error: error?.message || String(error)
                });
            }
        }

        // --- Utility Functions ---

        /** How long before a paused upload's deadline the notification comes. */
        const PAUSE_WARNING_MS = 5 * 60 * 1000;

        /**
         * The notification that a paused upload's server will drop it, 5
         * minutes before its deadline, or at once when less is left (Will,
         * 2026-10-09): nothing resumes it by itself. With null, or a new
         * deadline, the one waiting is called off. Pausing again renews the
         * deadline, and so the notification.
         */
        function warnBeforeDeadline(deadline) {
            if (deadline === pauseEnding.deadline) return;
            clearTimeout(pauseEnding.timer);
            pauseEnding = { timer: null, deadline };
            if (deadline === null) return;
            const wait = Math.max(0, deadline - PAUSE_WARNING_MS - Date.now());
            pauseEnding.timer = setTimeout(() => api.pauseEnding(deadline), wait);
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

        /**
         * Update the security status card based on E2EE and HTTPS availability.
         */
        function updateSecurityStatus() {
            // What counts is the server's address: its capability, and whether it's reached over HTTPS.
            const isTargetSecure = coreClient?.server.baseUrl.startsWith('https://') ?? false;
            const hasE2EE = serverCapabilities?.upload?.e2ee && isTargetSecure;

            if (hasE2EE) {
                // Green: Full E2EE
                securityIcon.textContent = 'verified';
                securityIcon.className = 'material-icons-round text-success-emphasis';
                securityText.textContent = 'Your upload will be end-to-end encrypted.';
                securityStatus.className = 'security-status-card security-green mb-3';
            } else if (isTargetSecure) {
                // Yellow: HTTPS but no E2EE
                securityIcon.textContent = 'warning';
                securityIcon.className = 'material-icons-round text-warning-emphasis';
                securityText.textContent = "This server doesn't support encryption. Your upload is protected in transit by HTTPS.";
                securityStatus.className = 'security-status-card security-yellow mb-3';
            } else {
                // Red: HTTP, no encryption at all
                securityIcon.textContent = 'gpp_bad';
                securityIcon.className = 'material-icons-round text-danger-emphasis';
                securityText.textContent = 'This connection is not secure. Your upload will not be encrypted.';
                securityStatus.className = 'security-status-card security-red mb-3';
            }
        }

        /** Keep the upload options, as they change. A value that isn't a number yet is left as it was. */
        function saveSettings() {
            const changes = { lifetimeUnit: fileLifetimeUnitSelect.value };
            const lifetime = parseFloat(fileLifetimeValueInput.value);
            if (Number.isFinite(lifetime)) changes.lifetimeValue = lifetime;
            const downloads = parseInt(maxDownloadsValue.value, 10);
            if (Number.isInteger(downloads)) changes.maxDownloads = downloads;
            return kitApi.setSettings(changes);
        }

        /** Keep the server. */
        function saveServer(url) {
            return kitApi.setSettings({ serverURL: url });
        }

        function getLifetimeInMs() {
            const unit = fileLifetimeUnitSelect.value;
            if (unit === 'unlimited') return 0;
            const value = parseFloat(fileLifetimeValueInput.value);
            return lifetime.toMs(value, unit);
        }

        async function checkServerCompatibility() {
            const inputUrl = serverUrlInput.value.trim();
            if (!inputUrl) {
                const message = 'No server URL. Add one in Settings, under Server.';
                updateUploadabilityState(false, message);
                lastServerCheck = { compatible: false, message };
                return lastServerCheck;
            }

            try {
                // Recreate client if URL changed
                createClient(inputUrl);
                const compat = await coreClient.server.connect({ timeoutMs: 5000 });

                // The address as the client reads it: https:// added if it had no scheme.
                serverUrlInput.value = coreClient.server.baseUrl;

                const { serverInfo } = compat;

                if (!serverInfo || !serverInfo?.version || !serverInfo?.capabilities) {
                    const message = 'Cannot determine the server\'s version or capabilities.';
                    updateUploadabilityState(false, message);
                    lastServerCheck = { compatible: false, message };
                    return lastServerCheck;
                }

                serverCapabilities = serverInfo.capabilities;

                // Check if uploads are explicitly disabled by the server
                if (serverCapabilities.upload && serverCapabilities.upload.enabled === false) {
                    const message = 'File uploads are disabled on this server.';
                    updateUploadabilityState(false, message);
                    lastServerCheck = { compatible: false, message };
                    return lastServerCheck;
                }
                updateUploadabilityState(true);

                applyServerLimits();

                // Uploads need the server's hosted transfer protocol to work with this app's.
                if (!compat.dgup.compatible) {
                    lastServerCheck = { compatible: false, message: compat.dgup.message };
                    updateUploadabilityState(false, compat.dgup.message);
                    return lastServerCheck;
                }

                // compatible
                const message = `Server: v${compat.serverVersion}${serverInfo.name ? ` (${serverInfo.name})` : ''}, Client: v${appInfo.version}.`;
                setStatus(message);
                lastServerCheck = { compatible: true, message };
                updateUploadButtonState();

                return lastServerCheck;
            } catch (error) {
                const message = 'Could not connect to the server.';
                lastServerCheck = { compatible: false, message };
                updateUploadabilityState(false, message);
                return lastServerCheck;
            }
        }

        function validateLifetimeInput() {
            if (!serverCapabilities || !serverCapabilities.upload) return true;

            const limitHours = serverCapabilities.upload.maxLifetimeHours;
            const unit = fileLifetimeUnitSelect.value;

            // If server allows unlimited, and user selected unlimited, we are good.
            if (limitHours === 0 && unit === 'unlimited') {
                setHelp(fileLifetimeHelp, 'No lifetime limit enforced by the server.');
                return true;
            }

            // If user selected unlimited but server forbids it
            if (limitHours > 0 && unit === 'unlimited') {
                fileLifetimeUnitSelect.value = 'hours';
                fileLifetimeValueInput.disabled = false;
            }

            const currentMs = getLifetimeInMs();
            const limitMs = limitHours * 60 * 60 * 1000;

            if (limitHours > 0 && currentMs > limitMs) {
                setHelp(fileLifetimeHelp, `File lifetime too long. Server limit: ${hours(limitHours)}.`, 'danger');
                return false;
            }
            setHelp(fileLifetimeHelp, limitHours === 0 ? 'No lifetime limit enforced by the server.' : `Max: ${hours(limitHours)}`);
            return true;
        }

        function validateMaxDownloadsInput() {
            if (!serverCapabilities || !serverCapabilities.upload) return true;

            const maxFileDownloads = serverCapabilities.upload.maxFileDownloads ?? 1;
            const value = parseInt(maxDownloadsValue.value, 10);

            // Handle invalid input
            if (isNaN(value) || value < 0) {
                setHelp(maxDownloadsHelp, 'Max downloads must be 0 or more.', 'danger');
                return false;
            }

            // Server allows unlimited (0) - any value is valid
            if (maxFileDownloads === 0) {
                setHelp(maxDownloadsHelp, '0 means unlimited downloads.');
                return true;
            }

            // Server has limit of 1 - input should be disabled anyway (handled by applyServerLimits)
            if (maxFileDownloads === 1) {
                setHelp(maxDownloadsHelp, 'Server enforces single-use download links.');
                return true;
            }

            // Server has limit > 1
            if (value === 0) {
                setHelp(maxDownloadsHelp, `0 (unlimited) not allowed. Server limit: ${kit.format.countOf(maxFileDownloads, 'download')}.`, 'danger');
                return false;
            }

            if (value > maxFileDownloads) {
                setHelp(maxDownloadsHelp, `Exceeds the server's limit of ${kit.format.countOf(maxFileDownloads, 'download')}.`, 'danger');
                return false;
            }

            setHelp(maxDownloadsHelp, `Max: ${kit.format.countOf(maxFileDownloads, 'download')}`);
            return true;
        }

        /** A number of hours: a server's limit can be part of one, which countOf() would round. */
        function hours(n) {
            return Number.isInteger(n) ? kit.format.countOf(n, 'hour') : `${n} hours`;
        }

        /** A field's help line, plain, or in a tone. */
        function setHelp(element, text, tone) {
            element.textContent = text;
            element.className = `form-text reserved${tone ? ` text-${tone}-emphasis` : ''}`;
        }

        function updateUploadButtonState() {
            // Check all validity conditions
            const isLifetimeValid = validateLifetimeInput();
            const isDownloadsValid = validateMaxDownloadsInput();
            const isServerCompatible = lastServerCheck.compatible;
            const isFileSelected = selectedFiles.length > 0;

            actions.update({
                canRun: isFileSelected && isServerCompatible && isLifetimeValid && isDownloadsValid && !uploading,
                canClear: isFileSelected && !uploading,
            });
        }

        // Update UI based on whether uploads are enabled
        function updateUploadabilityState(enabled, message = '') {
            uploadsAllowed = enabled;
            if (!enabled) {
                if (message) setStatus(message);

                // Clear loading text and hide security badge
                setHelp(fileLifetimeHelp, '');
                setHelp(maxDownloadsHelp, '');
                maxUploadHint.textContent = '';
                securityStatus.classList.add('d-none');

                actions.update({ canRun: false });
                emptyState.classList.add('disabled');
                browseMoreBtn.disabled = true;

                // Disable inputs
                fileLifetimeValueInput.disabled = true;
                fileLifetimeUnitSelect.disabled = true;
                maxDownloadsValue.disabled = true;
            } else {
                emptyState.classList.remove('disabled');
                browseMoreBtn.disabled = false;
                securityStatus.classList.remove('d-none');

                // Inputs will be further refined by applyServerLimits, but enable them generally here
                fileLifetimeValueInput.disabled = false;
                fileLifetimeUnitSelect.disabled = false;
                maxDownloadsValue.disabled = false;
            }
        }

        // Apply server-enforced limits to the UI
        function applyServerLimits() {
            if (!serverCapabilities || !serverCapabilities.upload) return;

            const limitHours = serverCapabilities.upload.maxLifetimeHours;
            const unlimitedOption = fileLifetimeUnitSelect.querySelector('option[value="unlimited"]');

            if (limitHours > 0) {
                // Server has a limit: Disable "Unlimited"
                if (unlimitedOption) {
                    unlimitedOption.disabled = true;
                    unlimitedOption.textContent = 'Unlimited (not allowed by the server)';
                }

                // If currently selected is unlimited, switch to hours
                if (fileLifetimeUnitSelect.value === 'unlimited') {
                    fileLifetimeUnitSelect.value = 'hours';
                    fileLifetimeValueInput.disabled = false;
                    fileLifetimeValueInput.value = Math.min(24, limitHours);
                }
            } else if (unlimitedOption) {
                // Server allows unlimited
                unlimitedOption.disabled = false;
                unlimitedOption.textContent = 'Unlimited';
            }

            // The server's limit, as its operator set it, in MB.
            const maxSizeMB = serverCapabilities.upload.maxSizeMB;
            maxUploadHint.textContent = maxSizeMB === 0 ? 'You can upload files of any size.' : `Max upload size: ${maxSizeMB} MB.`;

            // Update Security Status UI (Auto-managed E2EE)
            updateSecurityStatus();

            // Max Downloads UI
            const maxFileDownloads = serverCapabilities.upload.maxFileDownloads ?? 1;

            // Get current value (loaded from settings or user input)
            let currentValue = parseInt(maxDownloadsValue.value, 10);
            if (isNaN(currentValue)) currentValue = 1;

            if (maxFileDownloads === 1) {
                // Server forces single-download: disable input
                maxDownloadsValue.value = '1';
                maxDownloadsValue.min = '1';
                maxDownloadsValue.disabled = true;
                setHelp(maxDownloadsHelp, 'Server enforces single-use download links.');
            } else if (maxFileDownloads === 0) {
                // Server allows unlimited
                maxDownloadsValue.disabled = false;
                maxDownloadsValue.min = '0';
                setHelp(maxDownloadsHelp, '0 means unlimited downloads.');
            } else {
                // Server has a limit > 1 (0 is not allowed)
                maxDownloadsValue.disabled = false;
                maxDownloadsValue.min = '1';
                setHelp(maxDownloadsHelp, `Max: ${kit.format.countOf(maxFileDownloads, 'download')}`);

                // Auto-clamp if needed (if current is 0/unlimited or exceeds limit)
                if (currentValue === 0 || currentValue > maxFileDownloads) {
                    maxDownloadsValue.value = String(maxFileDownloads);
                }
            }

            // Re-validate current inputs
            validateLifetimeInput();
        }

        /**
         * Lock or unlock the UI while an upload is in progress.
         * Only Cancel stays usable while it runs.
         */
        function setUploadingState(running) {
            emptyState.classList.toggle('disabled', running);
            browseMoreBtn.disabled = running;
            fileInput.disabled = running;
            fileListContainer.querySelectorAll('.file-remove-btn').forEach(btn => { btn.disabled = running; });
            serverUrlInput.disabled = running;
            testConnectionBtn.disabled = running;
            fileLifetimeValueInput.disabled = running;
            fileLifetimeUnitSelect.disabled = running;
            maxDownloadsValue.disabled = running;
            if (!running) applyServerLimits();
            updateUploadButtonState();
        }

        // Helper to reset the UI state after an upload completes or fails
        function resetUI(clearFile = true) {
            if (clearFile) {
                selectedFiles = [];
                updateFileListUI();
                fileInput.value = '';
            }
            updateUploadButtonState();

            setTimeout(() => {
                if (!uploading) actions.update({ percent: 0 });
            }, 3000);
        }

        // From now on the files the app is opened with go straight in; any that came early, now.
        addOpened = (paths) => addOpenedPaths(paths);
        if (opened.length > 0) addOpened(opened.splice(0));

        await shell.ready;
        await api.rendererReady();
    } catch (error) {
        console.error('The page could not set itself up:', error);
        window.kit?.ui.toast(`Dropgate Client could not start: ${error.message}`, { type: 'danger', timeout: 0 });
    }
});
