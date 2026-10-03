import { DropgateClient, lifetimeToMs } from './dropgate-core.js';

// The page: Dropgate's Upload section and its Server tab, in the kit's frame
// (kit.ui.mountShell()): the nav rail, the header, and the Settings view, with
// Update and Credits after Dropgate's own tab. The drop zone, the action bar,
// the prompts and the toasts are the kit's too. The settings are the kit's
// (window.kitAPI), saved as they change. The same page runs hidden for Share
// with Dropgate, which main hands its files (onBackgroundUploadStart).

const api = window.electronAPI;
const kitApi = window.kitAPI;

/**
 * A Blob-like object that reads a byte range from a file on disk via IPC,
 * only when the data is actually needed (i.e. when arrayBuffer() is called).
 */
class LazyBlob {
    constructor(filePath, start, end) {
        this.filePath = filePath;
        this.start = start;
        this.end = end;
        this.size = end - start;
    }

    async arrayBuffer() {
        const buffer = await api.readFileRange(this.filePath, this.start, this.end);
        // IPC returns a Node.js Buffer (Uint8Array); convert to ArrayBuffer
        if (buffer instanceof ArrayBuffer) return buffer;
        return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
    }

    slice(start, end) {
        const s = this.start + (start || 0);
        const e = this.start + (end !== undefined ? end : this.size);
        return new LazyBlob(this.filePath, s, e);
    }
}

/**
 * A File-like object backed by a file path on disk.
 * Implements the subset of the File/Blob API that dropgate-core needs:
 * .name, .size, .type, .slice(start, end)
 */
class LazyFile {
    constructor(filePath, name, size) {
        this.filePath = filePath;
        this.name = name;
        this.size = size;
        this.type = '';
    }

    slice(start, end) {
        return new LazyBlob(this.filePath, start || 0, end !== undefined ? end : this.size);
    }
}

/** What Restart Now says while an upload runs, in this window or another. */
const BUSY_REASON = 'An upload is in progress.';

document.addEventListener('DOMContentLoaded', async () => {
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

        let serverCapabilities = null;
        let selectedFiles = [];
        /** @type {{compatible:boolean, message?:string}} */
        let lastServerCheck = { compatible: false, message: '' };
        let activeUploadSession = null;
        // Whether this window shows an upload running: its own, or one main tells it about.
        let uploading = false;
        let uploadsAllowed = false;

        // --- The frame ---
        const shell = kit.ui.mountShell({
            title: 'Dropgate Client',
            sections: [{ view: 'upload', label: 'Upload', icon: 'upload_file', element: uploadView }],
            settingsTabs: [{ id: 'server', label: 'Server', render: (pane) => pane.append($('server-settings')) }],
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

        /** Say what's happening, on the action bar's status line. */
        function setStatus(text) {
            actions.update({ summary: text });
        }

        // --- Core client (shared logic for Electron + Web UI) ---
        const clientVersion = await kitApi.getVersion();
        /** @type {DropgateClient|null} */
        let coreClient = null;

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
                clientVersion,
                server: serverUrl,
                fallbackToHttp: true,
            });
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
                // Recreate client with current URL (includes HTTP fallback)
                createClient(serverUrl);
                await coreClient.connect({ timeoutMs: 5000 });

                const { secure } = coreClient.serverTarget;
                if (secure) {
                    connectionStatus.textContent = 'Connection successful (HTTPS).';
                    connectionStatus.className = 'form-text reserved text-success-emphasis';
                } else {
                    connectionStatus.textContent = 'Connection successful (HTTP), but the connection is insecure.';
                    connectionStatus.className = 'form-text reserved text-warning-emphasis';
                }

                // Update input to reflect resolved URL (may have changed due to HTTP fallback)
                serverUrlInput.value = coreClient.baseUrl;
                await saveServer(coreClient.baseUrl);

                await checkServerCompatibility();
            } catch (error) {
                connectionStatus.textContent = 'Connection failed. Check the URL, and that the server is running.';
                updateUploadabilityState(false);
                connectionStatus.className = 'form-text reserved text-danger-emphasis';
            } finally {
                testConnectionBtn.disabled = uploading;
                testConnectionBtn.textContent = 'Test';
            }
        });

        copyBtn.addEventListener('click', () => {
            downloadLinkInput.select();
            document.execCommand('copy');
            kit.ui.toast('Link copied.', { type: 'success' });
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
                        linkSection.classList.add('d-none');
                        break;
                    }
                case 'success':
                    {
                        const { link } = event.data;
                        downloadLinkInput.value = link;
                        linkSection.classList.remove('d-none');
                        uploading = false;
                        setStatus('Upload successful.');
                        actions.update({ running: false, percent: 100 });
                        resetUI();
                        break;
                    }
                case 'error':
                    {
                        const { error } = event.data;
                        uploading = false;
                        setStatus(`Upload failed: ${error}`);
                        actions.update({ running: false });
                        kit.ui.toast(`Upload failed: ${error}`, { type: 'danger' });
                        resetUI(false);
                        break;
                    }
            }
        });

        // Cancel the upload this window runs (main passes on a Cancel from any window).
        api.onCancelUpload(() => {
            if (activeUploadSession) {
                activeUploadSession.cancel('Upload cancelled.');
                activeUploadSession = null;
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

            if (valid.length === 0) return;

            // Append to existing selection
            selectedFiles = [...selectedFiles, ...valid];
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

            const isTargetSecure = coreClient?.baseUrl?.startsWith('https://') ?? false;
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
                const session = await coreClient.uploadFiles({
                    files: selectedFiles.length === 1 ? selectedFiles[0] : selectedFiles,
                    lifetimeMs,
                    maxDownloads: (() => {
                        const val = parseInt(maxDownloadsValue.value, 10);
                        return (Number.isInteger(val) && val >= 0) ? val : 1;
                    })(),
                    encrypt: encrypt,
                    onProgress: (evt) => {
                        const payload = {};
                        if (evt?.text) {
                            payload.text = evt.currentFileName
                                ? `${evt.text} — ${evt.currentFileName}`
                                : evt.text;
                        }
                        if (evt?.percent !== undefined) payload.percent = evt.percent;
                        if (Object.keys(payload).length) api.uploadProgress(payload);
                    },
                    onCancel: () => {
                        setStatus('Upload cancelled.');
                        activeUploadSession = null;
                        uploading = false;
                        actions.update({ running: false });
                        setUploadingState(false);
                        resetUI(false);
                    }
                });

                activeUploadSession = session;
                uploading = true;
                actions.update({ running: true });
                setUploadingState(true);

                const result = await session.result;

                activeUploadSession = null;
                setUploadingState(false);

                revokeAllLazyFiles();
                api.uploadFinished({ status: 'success', link: result.downloadUrl });
            } catch (error) {
                activeUploadSession = null;
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

        /**
         * Update the security status card based on E2EE and HTTPS availability.
         */
        function updateSecurityStatus() {
            // What counts is the server's address: its capability, and whether it's reached over HTTPS.
            const isTargetSecure = coreClient?.baseUrl?.startsWith('https://') ?? false;
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

            try {
                // Recreate client if URL changed (client handles HTTP fallback internally)
                createClient(inputUrl);
                const compat = await coreClient.connect({ timeoutMs: 5000 });

                // Update input to reflect resolved URL (may have changed due to HTTP fallback or protocol auto-detect)
                serverUrlInput.value = coreClient.baseUrl;

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

                if (!compat.compatible) {
                    lastServerCheck = { compatible: false, message: compat.message };
                    updateUploadabilityState(false, compat.message);
                    return lastServerCheck;
                }

                // compatible
                setStatus(compat.message);
                lastServerCheck = { compatible: true, message: compat.message };
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
            const sizeMode = serverCapabilities.upload.bundleSizeMode || 'total';
            const sizeLabel = sizeMode === 'per-file' ? 'Max single file size' : 'Max upload size';
            maxUploadHint.textContent = maxSizeMB === 0 ? 'You can upload files of any size.' : `${sizeLabel}: ${maxSizeMB} MB.`;

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

        await shell.ready;
        await api.rendererReady();
    } catch (error) {
        console.error('The page could not set itself up:', error);
        window.kit?.ui.toast(`Dropgate Client could not start: ${error.message}`, { type: 'danger', timeout: 0 });
    }
});
