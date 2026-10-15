// The page: Dropgate's Upload section and its Server and Privacy tabs, in the
// kit's frame (kit.ui.mountShell()): the nav rail, the header (with Add
// Files), and the Settings view, with Update and Credits after Dropgate's own
// tabs. The drop zone, the cards, their grid and bulk bar, the action bar, the
// prompts and the toasts are the kit's too. The settings are the kit's
// (window.kitAPI), saved as they change.
//
// Upload is a card for each upload in main's registry: waiting for Upload,
// queued, running, paused, and once ended, done (with its link), failed or
// cancelled, until it's removed. Files dropped, picked or opened together make
// one upload; files dropped onto one still waiting join it (a file already in
// it is skipped), and onto one that has started make a new one. A new upload
// takes the server's settings for new uploads (Settings > Server). Each card
// starts with its Upload, or all waiting with the action bar's Upload All.
//
// The page runs no core and makes no request: it holds each file as the
// handle main made for it only until it's handed to an upload, never its
// path, and main runs each server check and upload in the transfer window,
// and tells the page how they go: each transfer as it is (onTransferChanged),
// each one removed (onTransfersRemoved), and each upload's outcome
// (onUploadStatus). Share with Dropgate's uploads are cards too, and the page
// asks the Upload Security Warning for one to a server with no end-to-end
// encryption, when main opens it to (onAskInsecure).

const api = window.electronAPI;
const kitApi = window.kitAPI;

/** What Restart Now says while an upload runs, from this window or Share with Dropgate. */
const BUSY_REASON = 'An upload is in progress.';

/** How many uploads run at once: main's TRANSFERS.AT_ONCE (Settings > Transfers sets it from phase 7's piece 5). */
const AT_ONCE = 3;

/** A file lifetime in ms, to hold it to the server's limit here: core's lifetime.toMs(), which the upload itself uses. */
const LIFETIME_UNIT_MS = { minutes: 60_000, hours: 3_600_000, days: 86_400_000 };
const lifetimeToMs = (value, unit) => (Number.isFinite(value) && value > 0 && LIFETIME_UNIT_MS[unit] ? Math.round(value * LIFETIME_UNIT_MS[unit]) : 0);

/** The states an upload has once it has ended, and those going. */
const ENDED = ['done', 'failed', 'cancelled'];
const GOING = ['queued', 'running', 'paused'];

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
        const uploadArea = $('upload-area');
        const emptyState = $('empty-state');
        const gridElement = $('upload-grid');
        const fileInput = $('file-input');
        const addFilesBtn = $('add-files-btn');
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
        const keepLogSwitch = $('keep-log-on-disk');
        const { countOf, formatBytes } = kit.format;

        // Share with Dropgate is Windows' right-click entry: elsewhere, the Server tab doesn't mention it.
        if (!navigator.userAgent.includes('Windows')) $('server-help').textContent = 'Uploads go to this server.';

        let serverCapabilities = null;
        /** @type {{compatible:boolean, message?:string}} */
        let lastServerCheck = { compatible: false, message: '' };

        // --- The frame ---
        const shell = kit.ui.mountShell({
            title: 'Dropgate Client',
            sections: [{ view: 'upload', label: 'Upload', icon: 'upload_file', element: uploadView }],
            toolbar: $('toolbar'),
            settingsTabs: [
                { id: 'server', label: 'Server', render: (pane) => pane.append($('server-settings')) },
                { id: 'privacy', label: 'Privacy', render: (pane) => pane.append($('privacy-settings')) },
            ],
            credits: { logo: 'img/dropgate.png' },
            // Restart Now asks first while main has an upload running, paused, or waiting to (Share with Dropgate's too).
            busy: async () => (await api.isBusy() ? BUSY_REASON : null),
        });

        // --- The cards ---

        /**
         * Each upload drawn, by the ID main made: what main last said of it
         * (view), its card, its "To" select, and its link's row once it has one.
         * @type {Map<string, { view: any, card: any, select: HTMLSelectElement, linkRow: HTMLInputElement | null }>}
         */
        const shown = new Map();
        /** The kit's cards back to their uploads' IDs, for the grid's selection. */
        const idOf = new Map();
        /** Share with Dropgate's uploads this window is asking the Upload Security Warning about now: they aren't started from here. */
        const asking = new Set();

        const grid = kit.ui.cardGrid(gridElement, { view: 'upload', onSelect: () => drawBars() });
        /** The uploads a bar acts on: those selected, or every one when none is. */
        const scope = () => (grid.selection.length > 0 ? grid.selection : grid.cards).map((card) => shown.get(idOf.get(card))).filter(Boolean);

        // The server a new upload goes to: the one in Settings > Server, until there are several (phase 14).
        const bulkTarget = document.createElement('select');
        bulkTarget.className = 'form-select form-select-sm';
        const bulk = kit.ui.bulkBar(grid, {
            noun: 'upload',
            target: { verb: 'Upload', control: bulkTarget, note: () => '' },
            actions: [
                {
                    label: 'Remove',
                    variant: 'outline-danger',
                    selection: true,
                    enabled: (picked) => picked.some((card) => removable(shown.get(idOf.get(card))?.view)),
                    onClick: (picked) => removeUploads(picked.map((card) => shown.get(idOf.get(card))).filter(Boolean)),
                },
            ],
        });
        $('upload-bulk').append(bulk.element);

        const actions = kit.ui.actionBar({
            run: { label: 'Upload All', onClick: () => startUploads(scope().filter(({ view }) => startable(view)).map(({ view }) => view.id)) },
            // Each upload has its own Cancel, so the bar never swaps to its abort.
            abort: { onClick: () => {} },
            clear: { label: 'Clear Finished', onClick: () => removeUploads([...shown.values()].filter(({ view }) => ENDED.includes(view.state))) },
            progressLabel: 'Uploads in progress',
        });
        $('action-bar').append(actions.element);

        /** Whether a card can go: waiting, or ended. One going is cancelled first. */
        const removable = (view) => Boolean(view) && (view.state === 'waiting' || ENDED.includes(view.state));
        /** Whether Upload starts it from here: waiting, and not a share being asked about. */
        const startable = (view) => view.state === 'waiting' && !asking.has(view.id);

        // Files dropped on Upload: onto a waiting upload's card they join it;
        // anywhere else they're a new upload. The drop zone reads the files'
        // paths; which card they fell on is seen first, as the drop passes it.
        let droppedOn = null;
        uploadArea.addEventListener('drop', (event) => {
            droppedOn = event.target instanceof Element ? event.target.closest('.upload-card') : null;
            for (const lit of uploadArea.querySelectorAll('.upload-card.drop-target')) lit.classList.remove('drop-target');
        }, true);
        uploadArea.addEventListener('dragover', (event) => {
            const over = event.target instanceof Element ? event.target.closest('.upload-card') : null;
            for (const lit of uploadArea.querySelectorAll('.upload-card.drop-target')) if (lit !== over) lit.classList.remove('drop-target');
            const entry = over && shown.get(idOf.get(grid.cards.find((card) => card.element === over)));
            if (entry && entry.view.state === 'waiting') over.classList.add('drop-target');
        });
        uploadArea.addEventListener('dragleave', (event) => {
            if (!uploadArea.contains(event.relatedTarget)) {
                for (const lit of uploadArea.querySelectorAll('.upload-card.drop-target')) lit.classList.remove('drop-target');
            }
        });
        const { zone } = kit.ui.dropZone(uploadArea, {
            onPaths: (paths) => {
                const onto = droppedOn ? grid.cards.find((card) => card.element === droppedOn) : null;
                droppedOn = null;
                addPaths(paths, onto ? idOf.get(onto) : null);
            },
            icon: 'upload_file',
            label: 'Drag & Drop Files Here',
            onBrowse: () => fileInput.click(),
        });
        emptyState.append(zone);

        // Delete removes the uploads selected that can go.
        kit.keys.onKey((event) => {
            if (event.key !== 'Delete' || grid.selection.length === 0) return;
            event.preventDefault();
            removeUploads(scope());
        }, { view: 'upload' });

        /** The server's name for a card's "To": its host, as typed or as the client reads it. */
        function serverName() {
            const address = serverUrlInput.value.trim();
            if (!address) return 'No server';
            try {
                return new URL(/^[a-z]+:\/\//i.test(address) ? address : `https://${address}`).host;
            } catch {
                return address;
            }
        }

        /** Fill a server select: the one server, the default (phase 14 lists them all). */
        function fillServers(select) {
            const option = document.createElement('option');
            option.value = 'default';
            option.textContent = serverUrlInput.value.trim() ? `${serverName()} (default)` : serverName();
            select.replaceChildren(option);
        }
        fillServers(bulkTarget);

        /** An upload's name on its card: its file's, or how many files. A file's name is never recased. */
        const nameOf = (view) => (view.files.length === 1 ? view.files[0].name : countOf(view.files.length, 'file'));

        /** Its meta line: the size, and with several files the first's name and how many more. */
        function metaOf(view) {
            const total = view.files.reduce((sum, file) => sum + file.size, 0);
            const more = view.files.length > 1 ? ` · ${view.files[0].name} and ${view.files.length - 1} More` : '';
            return `${formatBytes(total)}${more}`;
        }

        /** The text core gives with the one-character ellipsis, as the house writes it. */
        const tidy = (text) => String(text ?? '').replace(/\.\.\.$/, '…');
        /** A reason after a colon starts with a capital. */
        const sentence = (text) => (text ? text[0].toUpperCase() + text.slice(1) : text);

        /** Its status line: what it's doing, in the tone of its dot. */
        function statusOf(view) {
            switch (view.state) {
                case 'waiting': return { text: 'Ready', tone: 'ready' };
                case 'queued': return { text: `Queued: Starts when one of the ${AT_ONCE} running finishes.`, tone: 'muted' };
                case 'paused':
                    return { text: view.deadline ? `Paused. Kept until ${formatDeadline(view.deadline)}.` : 'Paused.', tone: 'warning' };
                case 'running': {
                    if (view.phase === 'chunk' && typeof view.percent === 'number') {
                        const of = view.files.length > 1 && Number.isInteger(view.fileIndex) ? ` · File ${view.fileIndex + 1} of ${view.files.length}` : '';
                        return { text: `Uploading ${Math.floor(view.percent)}%${of}`, tone: 'running' };
                    }
                    return { text: tidy(view.step) || 'Starting…', tone: 'running' };
                }
                case 'done': return { text: view.options?.encrypt ? 'Uploaded · End-to-End Encrypted' : 'Uploaded · Not Encrypted', tone: 'success' };
                case 'failed': return { text: `Failed: ${sentence(view.message ?? 'The upload stopped.')}`, tone: 'danger' };
                case 'cancelled': return { text: 'Cancelled', tone: 'muted' };
                default: return { text: view.state, tone: 'muted' };
            }
        }

        /** Its settings line: only when it won't be end-to-end encrypted. */
        function settingsOf(view) {
            const plain = view.options?.encrypt === false || (view.state === 'waiting' && lastServerCheck.compatible && !serverEncrypts());
            if (!plain) return undefined;
            return { text: serverUrlInput.value.trim().startsWith('http://') ? 'Not encrypted: This server is plain HTTP.' : "Not encrypted: This server doesn't support it.", tone: 'warning' };
        }

        /** Its buttons, for its state. A click on one that says "…ing…" shows it busy until the next state. */
        function actionsOf(view) {
            const { id } = view;
            switch (view.state) {
                case 'waiting':
                    return startable(view) ? [{ label: 'Upload', variant: 'primary', onClick: () => startUploads([id]) }] : [];
                case 'running': {
                    // Pause, while core says it can be now, on a server that lets uploads pause (its pause length is 0 when its operator turned pausing off).
                    const pausable = (serverCapabilities?.upload?.maxPauseMinutes ?? 0) > 0 && view.canPause && ['initializing', 'uploading'].includes(view.status);
                    return [
                        ...(pausable ? [{ label: 'Pause', onClick: (button) => pauseOrResume(button, id, true) }] : []),
                        { label: 'Cancel', variant: 'outline-danger', onClick: () => api.cancelTransfer(id).catch(() => {}) },
                    ];
                }
                case 'paused':
                    return [
                        ...(view.canPause ? [{ label: 'Resume', onClick: (button) => pauseOrResume(button, id, false) }] : []),
                        { label: 'Cancel', variant: 'outline-danger', onClick: () => api.cancelTransfer(id).catch(() => {}) },
                    ];
                case 'queued':
                    return [{ label: 'Cancel', variant: 'outline-danger', onClick: () => api.cancelTransfer(id).catch(() => {}) }];
                case 'done':
                    return [{ label: 'Copy Link', onClick: () => copyLink(view) }];
                case 'failed':
                case 'cancelled':
                    return [{ label: 'Retry', onClick: () => api.retryTransfer(id).catch(() => {}) }];
                default:
                    return [];
            }
        }

        /**
         * Pause or Resume: busy until the upload's next state; the upload
         * moving on before it landed is silent, and any other refusal is
         * core's reason, as a warning.
         */
        async function pauseOrResume(button, id, pause) {
            const restore = kit.ui.busy(button, pause ? 'Pausing…' : 'Resuming…');
            const { message } = await (pause ? api.pauseTransfer(id) : api.resumeTransfer(id)).catch(() => ({}));
            if (message) {
                restore();
                kit.ui.toast(message, { type: 'warning' });
            }
        }

        /** Copied by main, kept out of the clipboard's history and sync: the link holds the key. */
        async function copyLink(view) {
            try {
                await api.copyLink(view.link);
                kit.ui.toast('Link copied.', { type: 'success' });
            } catch {
                kit.ui.toast("Couldn't copy the link.", { type: 'danger' });
            }
        }

        /** Draw an upload as main says it is now: a new card, or the one it has. */
        function draw(view) {
            if (view.kind !== 'upload') return;
            let entry = shown.get(view.id);
            if (!entry) {
                const select = document.createElement('select');
                select.className = 'form-select form-select-sm';
                select.setAttribute('aria-label', 'Upload to');
                fillServers(select);
                const card = kit.ui.card({
                    icon: view.files.length > 1 ? 'file_copy' : 'upload_file',
                    name: nameOf(view),
                    onRemove: () => removeUploads([shown.get(view.id)]),
                    route: { label: 'To', control: select },
                });
                // The app's own class, for lighting a waiting one as files are dragged over it.
                card.element.classList.add('upload-card');
                entry = { view, card, select, linkRow: null };
                shown.set(view.id, entry);
                idOf.set(card, view.id);
                grid.add(card);
            }
            entry.view = view;
            if (view.link && !entry.linkRow) {
                entry.linkRow = document.createElement('input');
                entry.linkRow.className = 'form-control form-control-sm selectable card-link';
                entry.linkRow.readOnly = true;
                entry.linkRow.setAttribute('aria-label', 'Link');
            }
            if (entry.linkRow) entry.linkRow.value = view.link ?? '';
            const bar = ['running', 'paused'].includes(view.state);
            entry.card.update({
                name: nameOf(view),
                meta: metaOf(view),
                settings: settingsOf(view),
                status: statusOf(view),
                ...(bar ? { percent: view.phase === 'chunk' || view.state === 'paused' ? view.percent ?? null : null, paused: view.state === 'paused' } : {}),
                actions: actionsOf(view),
                rows: view.state === 'done' && entry.linkRow ? [entry.linkRow] : [],
                locked: view.state !== 'waiting',
                canRemove: removable(view),
            });
            drawBars();
        }

        /** Uploads gone from main's registry. */
        function forget(ids) {
            for (const id of ids) {
                const entry = shown.get(id);
                if (!entry) continue;
                shown.delete(id);
                idOf.delete(entry.card);
                asking.delete(id);
                grid.remove(entry.card);
            }
            drawBars();
        }

        /** Remove uploads that can go: waiting or ended. */
        function removeUploads(entries) {
            const ids = entries.filter((entry) => removable(entry?.view)).map((entry) => entry.view.id);
            if (ids.length > 0) api.removeTransfers(ids).catch(() => {});
        }

        /** The drop zone while there are no uploads; the bars' counts, progress and buttons. */
        function drawBars() {
            const views = [...shown.values()].map(({ view }) => view);
            emptyState.hidden = views.length > 0;
            gridElement.hidden = views.length === 0;
            const count = (state) => views.filter((view) => view.state === state).length;
            const running = views.filter((view) => view.state === 'running');
            const parts = [[running.length, 'Running'], [count('paused'), 'Paused'], [count('queued'), 'Queued'], [count('waiting'), 'Ready']]
                .filter(([n]) => n > 0).map(([n, word]) => `${n} ${word}`);
            const percents = running.map((view) => view.percent).filter((percent) => typeof percent === 'number');
            actions.update({
                // With nothing to upload yet, the line says why uploads can't start, if they can't.
                summary: views.length > 0 ? countOf(views.length, 'upload') : lastServerCheck.compatible ? '' : lastServerCheck.message,
                detail: parts.join(' · '),
                percent: percents.length ? percents.reduce((sum, percent) => sum + percent, 0) / percents.length : 0,
                running: false,
                canRun: views.some(startable),
                canClear: views.some((view) => ENDED.includes(view.state)),
            });
            bulk.refresh();
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

        /** Whether uploads to the server are end-to-end encrypted: it has it, and it's reached over HTTPS. */
        const serverEncrypts = () => Boolean(serverCapabilities?.upload?.e2ee && serverBaseUrl?.startsWith('https://'));

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
            validateLifetimeInput();
            saveSettings();
        };

        const updateMaxDownloadsSettings = () => {
            if (maxDownloadsValue.value === '') {
                maxDownloadsValue.value = 1;
            }
            validateMaxDownloadsInput();
            saveSettings();
        };

        fileLifetimeValueInput.addEventListener('blur', () => updateLifetimeSettings());
        fileLifetimeValueInput.addEventListener('input', () => updateLifetimeSettings());
        fileLifetimeUnitSelect.addEventListener('change', () => updateLifetimeSettings());
        maxDownloadsValue.addEventListener('input', () => updateMaxDownloadsSettings());
        maxDownloadsValue.addEventListener('blur', () => updateMaxDownloadsSettings());

        addFilesBtn.addEventListener('click', () => fileInput.click());
        // Files picked with Add Files or the drop zone: by their paths, as a drop's are, together one upload.
        fileInput.addEventListener('change', (e) => {
            const picked = Array.from(e.target.files ?? []);
            fileInput.value = '';
            const paths = picked.map((file) => kitApi.getPathForFile(file)).filter(Boolean);
            if (paths.length) addPaths(paths, null);
        });

        // The server is kept as it's changed, and as Test finds it.
        serverUrlInput.addEventListener('change', () => {
            saveServer(serverUrlInput.value.trim());
            refreshServer();
        });

        testConnectionBtn.addEventListener('click', async () => {
            const serverUrl = serverUrlInput.value.trim();
            if (!serverUrl) {
                updateUploadabilityState(false);
                connectionStatus.textContent = 'Enter a server URL.';
                connectionStatus.className = 'form-text reserved text-warning-emphasis';
                return;
            }

            const restore = kit.ui.busy(testConnectionBtn, 'Testing…');
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
                restore();
            }
        });

        // --- IPC Listeners (Communication from Main Process) ---

        // Each upload as it is now, and those removed, from main's registry.
        api.onTransferChanged((view) => draw(view));
        api.onTransfersRemoved((ids) => forget(ids));

        // An upload's outcome: its card says it, and this says what needs saying now.
        api.onUploadStatus((event) => {
            const { id } = event.data ?? {};
            if (event.type === 'success') {
                // Main has copied it, kept out of the clipboard's history.
                const entry = id ? shown.get(id) : null;
                kit.ui.toast(entry ? `Link to ${nameOf(entry.view)} copied.` : 'Link copied.', { type: 'success' });
            } else if (event.type === 'error') {
                kit.ui.toast(`Upload failed: ${event.data.error}`, { type: 'danger' });
            }
        });

        // A file picked with the menu's Open File: an upload of its own.
        api.onFileOpened((file) => {
            if (file && file.handle) newUpload([file]);
        });
        api.onFileOpenError((message) => kit.ui.toast(message, { type: 'danger' }));

        // Share with Dropgate, to a server with no end-to-end encryption: main
        // opened this window to ask. Upload Anyway starts it; anything else
        // declines it.
        api.onAskInsecure(async ({ id }) => {
            asking.add(id);
            if (shown.has(id)) draw(shown.get(id).view);
            const go = await askUploadAnyway();
            asking.delete(id);
            if (go) api.startTransfers([id]).catch(() => {});
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

        /**
         * Files by path, from a drop, a pick or the app's launch: main checks
         * each, and hands them over as handles, which make a new upload, or
         * join `onto` (an upload's ID) while it's waiting.
         */
        async function addPaths(paths, onto) {
            const { files, folders } = await api.addFiles(paths);
            if (folders > 0) kit.ui.toast(`Skipped ${countOf(folders, 'folder')}: Folders can't be uploaded.`, { type: 'warning' });
            const valid = files.filter((file) => file.size > 0);
            const empty = files.length - valid.length;
            if (empty > 0) kit.ui.toast(`Skipped ${countOf(empty, 'empty file')}.`, { type: 'warning' });
            if (valid.length === 0) {
                revoke(files);
                return;
            }
            const target = onto ? shown.get(onto)?.view : null;
            if (target?.state === 'waiting' && !asking.has(target.id)) {
                const added = await api.addToUpload(target.id, valid.map((file) => file.handle)).catch(() => ({ started: true }));
                if (!added.started) {
                    revoke(files);
                    if (added.skipped > 0) kit.ui.toast(`Skipped ${countOf(added.skipped, 'file')} already in that upload.`, { type: 'warning' });
                    return;
                }
            }
            if (target) {
                kit.ui.toast(valid.length === 1 ? 'That upload has already started, so this file is a new upload.' : 'That upload has already started, so these files are a new upload.', { type: 'info' });
            }
            await newUpload(valid);
            revoke(files);
        }

        /** Files the app was opened with: one upload, shown on Upload. */
        async function addOpenedPaths(paths) {
            shell.showView('upload');
            await addPaths(paths, null);
        }

        /** A new upload of files handed to this window: it waits, with the server's settings for new uploads. */
        async function newUpload(files) {
            try {
                await api.addUpload({ files: files.map((file) => file.handle) });
            } catch (error) {
                kit.ui.toast(`Couldn't add the files: ${error?.message || error}`, { type: 'danger' });
            }
        }

        /** Main forgets the files this window has handed to an upload, or no longer needs: the upload keeps them. */
        function revoke(files) {
            for (const f of files) api.revokeFileAccess(f.handle).catch(() => {});
        }

        /**
         * Start uploads waiting: the server checked first, each one's lifetime
         * and download limit held to its limits, and the Upload Security
         * Warning asked once when they won't be end-to-end encrypted. Main runs
         * them in the transfer window, as places free. One stopped before it
         * starts is told to main, and stays waiting.
         */
        async function startUploads(ids) {
            if (ids.length === 0) return;
            const serverCheck = await checkServerCompatibility();
            if (!serverCheck.compatible) {
                api.uploadFinished({ status: 'error', error: serverCheck.message || 'Server is not compatible.' });
                return;
            }
            for (const id of ids) {
                const problem = outsideLimits(shown.get(id)?.view.options);
                if (problem) {
                    api.uploadFinished({ status: 'error', error: problem });
                    return;
                }
            }
            const encrypt = serverEncrypts();
            if (!encrypt && !(await askUploadAnyway())) {
                api.uploadFinished({ status: 'error', error: 'Upload cancelled by user (insecure connection).' });
                return;
            }
            const waiting = ids.filter((id) => shown.get(id) && startable(shown.get(id).view));
            if (waiting.length === 0) return;
            try {
                await api.startTransfers(waiting, encrypt);
            } catch (error) {
                api.uploadFinished({ status: 'error', error: error?.message || String(error) });
            }
        }

        /** Why an upload's options are outside the server's limits, or null when they're inside. */
        function outsideLimits(options) {
            const upload = serverCapabilities?.upload;
            if (!options || !upload) return null;
            const limitHours = upload.maxLifetimeHours;
            const ms = options.lifetime.unit === 'unlimited' ? 0 : lifetimeToMs(options.lifetime.value, options.lifetime.unit);
            if (limitHours > 0 && (ms === 0 || ms > limitHours * 3_600_000)) return `File lifetime too long. Server limit: ${hours(limitHours)}.`;
            const maxFileDownloads = upload.maxFileDownloads ?? 1;
            if (maxFileDownloads > 0 && (options.maxDownloads === 0 || options.maxDownloads > maxFileDownloads)) {
                return `Exceeds the server's limit of ${countOf(maxFileDownloads, 'download')}.`;
            }
            return null;
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

            if (serverEncrypts()) {
                // Green: Full E2EE
                securityIcon.textContent = 'verified';
                securityIcon.className = 'material-icons-round text-success-emphasis';
                securityText.textContent = 'Your upload will be end-to-end encrypted.';
                securityStatus.className = 'security-status-card security-green';
            } else if (isTargetSecure) {
                // Yellow: HTTPS but no E2EE
                securityIcon.textContent = 'warning';
                securityIcon.className = 'material-icons-round text-warning-emphasis';
                securityText.textContent = "This server doesn't support encryption. Your upload is protected in transit by HTTPS.";
                securityStatus.className = 'security-status-card security-yellow';
            } else {
                // Red: HTTP, no encryption at all
                securityIcon.textContent = 'gpp_bad';
                securityIcon.className = 'material-icons-round text-danger-emphasis';
                securityText.textContent = 'This connection is not secure. Your upload will not be encrypted.';
                securityStatus.className = 'security-status-card security-red';
            }
        }

        /** Keep the settings for new uploads, as they change. A value that isn't a number yet is left as it was. */
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

        /** The server's name on every card and the bulk bar, and whether a waiting upload says it won't be encrypted. */
        function refreshServer() {
            fillServers(bulkTarget);
            for (const entry of shown.values()) {
                fillServers(entry.select);
                draw(entry.view);
            }
            drawBars();
        }

        function getLifetimeInMs() {
            const unit = fileLifetimeUnitSelect.value;
            if (unit === 'unlimited') return 0;
            const value = parseFloat(fileLifetimeValueInput.value);
            return lifetimeToMs(value, unit);
        }

        async function checkServerCompatibility() {
            lastServerCheck = await findServer();
            refreshServer();
            return lastServerCheck;
        }

        async function findServer() {
            const inputUrl = serverUrlInput.value.trim();
            if (!inputUrl) {
                const message = 'No server URL. Add one in Settings, under Server.';
                updateUploadabilityState(false);
                return { compatible: false, message };
            }

            const compat = await checkServer(inputUrl);
            if (!compat.ok) {
                updateUploadabilityState(false);
                return { compatible: false, message: 'Could not connect to the server.' };
            }
            serverBaseUrl = compat.baseUrl;
            // The address as the client reads it: https:// added if it had no scheme.
            serverUrlInput.value = serverBaseUrl;

            const { serverInfo } = compat;

            if (!serverInfo || !serverInfo?.version || !serverInfo?.capabilities) {
                updateUploadabilityState(false);
                return { compatible: false, message: 'Cannot determine the server\'s version or capabilities.' };
            }

            serverCapabilities = serverInfo.capabilities;

            // Check if uploads are explicitly disabled by the server
            if (serverCapabilities.upload && serverCapabilities.upload.enabled === false) {
                updateUploadabilityState(false);
                return { compatible: false, message: 'File uploads are disabled on this server.' };
            }
            updateUploadabilityState(true);

            applyServerLimits();

            // Uploads need the server's hosted transfer protocol to work with this app's.
            if (!compat.dgup.compatible) {
                updateUploadabilityState(false);
                return { compatible: false, message: compat.dgup.message };
            }

            return { compatible: true, message: `Server: v${compat.serverVersion}${serverInfo.name ? ` (${serverInfo.name})` : ''}, Client: v${appVersion}.` };
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
                setHelp(maxDownloadsHelp, `0 (unlimited) not allowed. Server limit: ${countOf(maxFileDownloads, 'download')}.`, 'danger');
                return false;
            }

            if (value > maxFileDownloads) {
                setHelp(maxDownloadsHelp, `Exceeds the server's limit of ${countOf(maxFileDownloads, 'download')}.`, 'danger');
                return false;
            }

            setHelp(maxDownloadsHelp, `Max: ${countOf(maxFileDownloads, 'download')}`);
            return true;
        }

        /** A number of hours: a server's limit can be part of one, which countOf() would round. */
        function hours(n) {
            return Number.isInteger(n) ? countOf(n, 'hour') : `${n} hours`;
        }

        /** A field's help line, plain, or in a tone. */
        function setHelp(element, text, tone) {
            element.textContent = text;
            element.className = `form-text reserved${tone ? ` text-${tone}-emphasis` : ''}`;
        }

        // The settings for new uploads, as the server allows them: off while there's no server to hold them to.
        function updateUploadabilityState(enabled) {
            if (!enabled) {
                // Clear loading text and hide security badge
                setHelp(fileLifetimeHelp, '');
                setHelp(maxDownloadsHelp, '');
                maxUploadHint.textContent = '';
                securityStatus.classList.add('d-none');

                fileLifetimeValueInput.disabled = true;
                fileLifetimeUnitSelect.disabled = true;
                maxDownloadsValue.disabled = true;
            } else {
                securityStatus.classList.remove('d-none');

                // Inputs will be further refined by applyServerLimits, but enable them generally here
                fileLifetimeValueInput.disabled = fileLifetimeUnitSelect.value === 'unlimited';
                fileLifetimeUnitSelect.disabled = false;
                maxDownloadsValue.disabled = false;
            }
        }

        // Apply server-enforced limits to the settings for new uploads
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
                setHelp(maxDownloadsHelp, `Max: ${countOf(maxFileDownloads, 'download')}`);

                // Auto-clamp if needed (if current is 0/unlimited or exceeds limit)
                if (currentValue === 0 || currentValue > maxFileDownloads) {
                    maxDownloadsValue.value = String(maxFileDownloads);
                }
            }

            // Re-validate current inputs, and keep what was held to the server's limits: new uploads take these.
            validateLifetimeInput();
            saveSettings();
        }

        // From now on the files the app is opened with go straight in; any that came early, now.
        addOpened = (paths) => addOpenedPaths(paths);
        if (opened.length > 0) addOpened(opened.splice(0));

        // Every upload main has: those going on with no window until now (Share with Dropgate's), and any this window left.
        for (const view of await api.listTransfers().catch(() => [])) draw(view);
        drawBars();

        await shell.ready;
        await api.rendererReady();
    } catch (error) {
        console.error('The page could not set itself up:', error);
        window.kit?.ui.toast(`Dropgate Client could not start: ${error.message}`, { type: 'danger', timeout: 0 });
    }
});
