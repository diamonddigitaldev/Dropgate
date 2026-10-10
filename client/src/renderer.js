// The page: Dropgate's Upload section and its Server tab, in the kit's frame
// (kit.ui.mountShell()): the nav rail, the header, and the Settings view, with
// Update and Credits after Dropgate's own tab. The drop zone, the action bar,
// the prompts and the toasts are the kit's too. The settings are the kit's
// (window.kitAPI), saved as they change. Share with Dropgate is main's, with
// no window: the main window shows how a share goes (onUploadStatus), and
// asks the Upload Security Warning for one to a server with no end-to-end
// encryption, when main opens it to (onAskInsecure).
//
// The page runs no core and makes no request: it holds each file as the
// handle main made for it, with its name and size, never its path, and main
// runs each server check and upload in the transfer window, and tells the
// page how they go (onUploadStatus).

const api = window.electronAPI;
const kitApi = window.kitAPI;

/** What Restart Now says while an upload runs, from this window or Share with Dropgate. */
const BUSY_REASON = 'An upload is in progress.';

/** A file lifetime in ms, to hold it to the server's limit here: core's lifetime.toMs(), which the upload itself uses. */
const LIFETIME_UNIT_MS = { minutes: 60_000, hours: 3_600_000, days: 86_400_000 };
const lifetimeToMs = (value, unit) => (Number.isFinite(value) && value > 0 && LIFETIME_UNIT_MS[unit] ? Math.round(value * LIFETIME_UNIT_MS[unit]) : 0);

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
        // The upload this window shows, by the ID main made: its own, or one main tells it about.
        let currentUpload = null;
        // The upload this window started, until it ends.
        let ownUpload = null;
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
            // Restart Now asks first while main has an upload running, paused, or waiting to (Share with Dropgate's too).
            busy: async () => (await api.isBusy() ? BUSY_REASON : null),
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
            // The upload this window shows, whichever window started it. One that has just ended is left to end.
            abort: { onClick: () => currentUpload && api.cancelTransfer(currentUpload).catch(() => {}) },
            clear: { onClick: () => clearFiles() },
            progressLabel: 'Upload progress',
        });
        $('action-bar').append(actions.element);
        actions.update({ canRun: false, canClear: false });

        // Pause Upload and Resume Upload, beside Cancel while an upload runs, on
        // a server that lets uploads pause. The kit's action bar has no place
        // for them, so they're the app's own, as a transfer's own buttons are
        // (Will, 2026-10-09). A click disables its own button until the next
        // snapshot. The upload moving on before it landed is silent; any
        // other refusal is core's reason, as a warning.
        const pauseButton = (label, paused) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'btn btn-outline-secondary';
            button.textContent = label;
            button.hidden = true;
            button.addEventListener('click', async () => {
                button.disabled = true;
                if (!currentUpload) return;
                const asked = paused ? api.pauseTransfer(currentUpload) : api.resumeTransfer(currentUpload);
                const { message } = await asked.catch(() => ({}));
                if (message) kit.ui.toast(message, { type: 'warning' });
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

        // --- The server ---
        // The app's own version, for display only.
        const appVersion = await kitApi.getVersion();
        // The server's address as the client reads it (https:// added if it had
        // no scheme), from the last check that reached it. Checks are asked of
        // the server by the transfer window, through main (api.checkServer()).
        let serverBaseUrl = null;

        /** Whether an address is plain HTTP, as typed: one without a scheme is HTTPS. */
        const isPlainHttp = (serverUrl) => /^http:\/\//i.test(serverUrl);

        /** Ask the server, through main: what it allows, or why it couldn't be reached. */
        const checkServer = (serverUrl) => api.checkServer(serverUrl).catch(() => ({ ok: false }));

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
        // Files picked with Add More or Browse: by their paths, as a drop's are.
        fileInput.addEventListener('change', (e) => {
            const picked = Array.from(e.target.files ?? []);
            fileInput.value = '';
            const paths = picked.map((file) => kitApi.getPathForFile(file)).filter(Boolean);
            if (paths.length) addFromPaths(paths);
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
                const result = await checkServer(serverUrl);
                if (!result.ok) {
                    connectionStatus.textContent = connectionFailedText(serverUrl, result);
                    updateUploadabilityState(false);
                    connectionStatus.className = 'form-text reserved text-danger-emphasis';
                    return;
                }
                serverBaseUrl = result.baseUrl;

                if (serverBaseUrl.startsWith('https://')) {
                    connectionStatus.textContent = 'Connection successful (HTTPS).';
                    connectionStatus.className = 'form-text reserved text-success-emphasis';
                } else {
                    connectionStatus.textContent = 'Connection successful (HTTP), but the connection is insecure.';
                    connectionStatus.className = 'form-text reserved text-warning-emphasis';
                }

                // The address as the client reads it: https:// added if it had no scheme.
                serverUrlInput.value = serverBaseUrl;
                await saveServer(serverBaseUrl);

                await checkServerCompatibility();
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
                        const { id, status, paused, canPause, percent } = event.data;
                        currentUpload = id;
                        const text = progressLine(event.data);
                        if (text) setStatus(text);
                        uploading = true;
                        actions.update({ running: true, ...(percent !== undefined ? { percent } : {}) });
                        // Whether the server lets an upload pause: its pause length is 0 when the operator has turned pausing off.
                        const pausable = (serverCapabilities?.upload?.maxPauseMinutes ?? 0) > 0 && ['initializing', 'uploading', 'paused'].includes(status);
                        showPauseControls({ pausable, paused, canPause });
                        linkSection.classList.add('d-none');
                        break;
                    }
                case 'success':
                    {
                        const { link } = event.data;
                        downloadLinkInput.value = link;
                        linkSection.classList.remove('d-none');
                        uploading = false;
                        uploadEnded();
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
                        uploadEnded();
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
                        uploadEnded();
                        showPauseControls();
                        setStatus('Upload cancelled.');
                        actions.update({ running: false });
                        resetUI(false);
                        break;
                    }
            }
        });

        /**
         * The status line for an upload's progress: core's step, the file it's
         * on when it's one of several (main's name for it: core's snapshots
         * name none), or, paused, until when the server keeps it. Short, to fit
         * the status line beside its buttons (Will, 2026-10-09).
         */
        function progressLine({ step, fileName, paused, deadline }) {
            if (paused && step === 'Paused.' && deadline) return `Paused. Kept until ${formatDeadline(deadline)}.`;
            return fileName ? `${step} — ${fileName}` : step;
        }

        /** An upload this window shows has ended: the window's own is done with. */
        function uploadEnded() {
            currentUpload = null;
            if (ownUpload) {
                ownUpload = null;
                setUploadingState(false);
            }
        }

        // A file picked with the menu's Open File
        api.onFileOpened((file) => {
            if (file && file.handle) handleFiles([file]);
        });
        api.onFileOpenError((message) => kit.ui.toast(message, { type: 'danger' }));

        // Share with Dropgate, to a server with no end-to-end encryption: main
        // opened this window to ask. Upload Anyway starts it; anything else
        // declines it.
        api.onAskInsecure(async ({ id }) => {
            if (await askUploadAnyway()) api.startTransfers([id]).catch(() => {});
            else api.cancelTransfer(id).catch(() => {});
        });

        /** The Upload Security Warning, before an upload that won't be end-to-end encrypted. */
        function askUploadAnyway() {
            return kit.ui.confirm({
                title: 'Upload Security Warning',
                body: 'This server does not support end-to-end encryption. Your file will be uploaded without encryption.',
                detail: 'The server administrator may be able to access your file contents.',
                confirmLabel: 'Upload Anyway',
                variant: 'warning',
                icon: 'warning',
            });
        }

        /** Files by path, from a drop, a pick or the app's launch: main checks each, and hands over the files as handles. */
        async function addFromPaths(paths) {
            const { files, folders } = await api.addFiles(paths);
            if (folders > 0) kit.ui.toast(`Skipped ${kit.format.countOf(folders, 'folder')}: folders can't be uploaded.`, { type: 'warning' });
            handleFiles(files);
        }

        /** Files dropped on Upload. */
        async function addPaths(paths) {
            if (uploading || !uploadsAllowed) return;
            await addFromPaths(paths);
        }

        /** Files the app was opened with: added to Upload, as Open File's are, and shown there. */
        async function addOpenedPaths(paths) {
            if (uploading) {
                kit.ui.toast(`Couldn't add ${kit.format.countOf(paths.length, 'file')}: an upload is running.`, { type: 'warning' });
                return;
            }
            shell.showView('upload');
            await addFromPaths(paths);
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

            // A file already in the list isn't added twice: main hands a window the
            // same handle for the same file.
            const listed = new Set(selectedFiles.map((f) => f.handle));
            const fresh = valid.filter((f) => {
                if (listed.has(f.handle)) return false;
                listed.add(f.handle);
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

        /** Main forgets the files this window is done with. */
        function revoke(files) {
            for (const f of files) api.revokeFileAccess(f.handle).catch(() => {});
        }

        function clearFiles() {
            revoke(selectedFiles);
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
                    revoke(selectedFiles.splice(i, 1));
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
         * Start an upload of the files listed: checked here, and run by main in
         * the transfer window, which tells this window how it goes
         * (onUploadStatus). One stopped before it starts is told to main too.
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

            const isTargetSecure = serverBaseUrl?.startsWith('https://') ?? false;
            const hasE2EE = Boolean(serverCapabilities?.upload?.e2ee && isTargetSecure);

            // Check if E2EE is available - show warning if not
            if (!hasE2EE) {
                const confirmed = await askUploadAnyway();
                if (!confirmed) {
                    api.uploadFinished({
                        status: 'error',
                        error: 'Upload cancelled by user (insecure connection).'
                    });
                    return;
                }
            }

            // Auto-set encryption based on capability
            const encrypt = hasE2EE;
            saveSettings();

            try {
                const unit = fileLifetimeUnitSelect.value;
                const { id } = await api.addUpload({
                    files: selectedFiles.map((f) => f.handle),
                    options: {
                        lifetime: { value: unit === 'unlimited' ? 0 : parseFloat(fileLifetimeValueInput.value), unit },
                        maxDownloads: (() => {
                            const val = parseInt(maxDownloadsValue.value, 10);
                            return (Number.isInteger(val) && val >= 0) ? val : 1;
                        })(),
                        encrypt,
                    },
                });
                ownUpload = id;
                currentUpload = id;
                uploading = true;
                actions.update({ running: true });
                setUploadingState(true);
                await api.startTransfers([id]);
            } catch (error) {
                // Only an upload that never started gets here.
                ownUpload = null;
                currentUpload = null;
                uploading = false;
                actions.update({ running: false });
                setUploadingState(false);
                api.uploadFinished({
                    status: 'error',
                    error: error?.message || String(error)
                });
            }
        }

        // --- Utility Functions ---

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
            const isTargetSecure = serverBaseUrl?.startsWith('https://') ?? false;
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
            return lifetimeToMs(value, unit);
        }

        async function checkServerCompatibility() {
            const inputUrl = serverUrlInput.value.trim();
            if (!inputUrl) {
                const message = 'No server URL. Add one in Settings, under Server.';
                updateUploadabilityState(false, message);
                lastServerCheck = { compatible: false, message };
                return lastServerCheck;
            }

            const compat = await checkServer(inputUrl);
            if (!compat.ok) {
                const message = 'Could not connect to the server.';
                lastServerCheck = { compatible: false, message };
                updateUploadabilityState(false, message);
                return lastServerCheck;
            }
            serverBaseUrl = compat.baseUrl;
            // The address as the client reads it: https:// added if it had no scheme.
            serverUrlInput.value = serverBaseUrl;

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
            const message = `Server: v${compat.serverVersion}${serverInfo.name ? ` (${serverInfo.name})` : ''}, Client: v${appVersion}.`;
            setStatus(message);
            lastServerCheck = { compatible: true, message };
            updateUploadButtonState();

            return lastServerCheck;
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
                revoke(selectedFiles);
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
