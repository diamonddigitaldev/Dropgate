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
// One waiting can have its own options (its Advanced Options, or Bulk Edit
// on the bulk bar for those selected): its file lifetime and download limit,
// bounded by what the server allows, and the files it keeps; its settings
// line says what differs from the server's settings for new uploads. One
// whose options get past that (an edited config.json, a server that lowered
// its limits since) is stopped at its start by a warning, which can go on
// with the server's limits. A finished one can be deleted from its server
// (Delete), with the manage token only the transfer window holds.
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
        const { countOf, formatBytes, plural } = kit.format;

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
                    // Advanced Options for those selected that are still waiting.
                    label: 'Bulk Edit',
                    variant: 'primary',
                    selection: true,
                    enabled: (picked) => picked.some((card) => editable(shown.get(idOf.get(card))?.view)),
                    onClick: (picked) => openAdvanced(picked.map((card) => shown.get(idOf.get(card))).filter((entry) => editable(entry?.view))),
                },
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
        /** Whether its options can be changed here: the same, as its options are sealed once it starts. */
        const editable = (view) => Boolean(view) && startable(view);

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
                case 'deleted': return { text: 'Deleted from the server. Its link no longer works.', tone: 'muted' };
                default: return { text: view.state, tone: 'muted' };
            }
        }

        /**
         * Its settings line: that it won't be end-to-end encrypted, or else
         * what it has that differs from the server's settings for new uploads
         * ("3 Days · 10 Downloads"), or nothing.
         */
        function settingsOf(view) {
            const plain = view.options?.encrypt === false || (view.state === 'waiting' && lastServerCheck.compatible && !serverEncrypts());
            if (plain) {
                return { text: serverUrlInput.value.trim().startsWith('http://') ? 'Not encrypted: This server is plain HTTP.' : "Not encrypted: This server doesn't support it.", tone: 'warning' };
            }
            if (!view.options) return undefined;
            const usual = newUploadOptions();
            const differs = [];
            if (!sameLifetime(view.options.lifetime, usual.lifetime)) differs.push(lifetimeTitle(view.options.lifetime));
            if (view.options.maxDownloads !== usual.maxDownloads) differs.push(downloadsTitle(view.options.maxDownloads));
            return differs.length > 0 ? differs.join(' · ') : undefined;
        }

        /** The server's settings for new uploads, as Settings > Server has them now: what main gives a new upload. */
        function newUploadOptions() {
            const unit = fileLifetimeUnitSelect.value;
            return {
                lifetime: { value: unit === 'unlimited' ? 0 : parseFloat(fileLifetimeValueInput.value), unit },
                maxDownloads: parseInt(maxDownloadsValue.value, 10),
            };
        }

        const sameLifetime = (a, b) => a.unit === b.unit && (a.unit === 'unlimited' || a.value === b.value);

        /** A count that may be part of one, in words: countOf() would round 0.5 hours to 0. */
        const amountOf = (n, one) => (Number.isInteger(n) ? countOf(n, one) : `${n} ${plural(2, one)}`);

        /** A lifetime's unit as one of it, in a sentence and as a bullet-separated item. */
        const UNIT_WORDS = { minutes: ['minute', 'Minute'], hours: ['hour', 'Hour'], days: ['day', 'Day'] };

        /** A lifetime and a download limit as bullet-separated items, in Title Case: "3 Days", "No Time Limit", "10 Downloads". */
        const lifetimeTitle = (lifetime) => (lifetime.unit === 'unlimited' ? 'No Time Limit' : amountOf(lifetime.value, UNIT_WORDS[lifetime.unit][1]));
        const downloadsTitle = (n) => (n === 0 ? 'Unlimited Downloads' : countOf(n, 'Download'));
        /** And in a sentence: "3 days", "no time limit", "10 downloads". */
        const lifetimeText = (lifetime) => (lifetime.unit === 'unlimited' ? 'no time limit' : amountOf(lifetime.value, UNIT_WORDS[lifetime.unit][0]));
        const downloadsText = (n) => (n === 0 ? 'unlimited downloads' : countOf(n, 'download'));

        /** Its buttons, for its state. A click on one that says "…ing…" shows it busy until the next state. */
        function actionsOf(view) {
            const { id } = view;
            switch (view.state) {
                case 'waiting':
                    return startable(view) ? [{ label: 'Upload', variant: 'primary', onClick: () => startUploads([id]) }] : [];
                case 'running': {
                    // Pause, while core says it can be now, on a server that lets uploads pause (its pause length is 0 when its operator turned pausing off).
                    const pausable = (serverCapabilities?.upload?.maxPauseMinutes ?? 0) > 0 && view.canPause && ['initializing', 'uploading'].includes(view.status);
                    // A pause or a resume asked from here keeps its busy button until it's seen through.
                    const asked = settling.get(id)?.kind;
                    const toggle = asked === 'resume' ? [{ label: 'Resume', onClick: () => {} }]
                        : pausable || asked === 'pause' ? [{ label: 'Pause', onClick: (button) => pauseOrResume(button, id, true) }] : [];
                    return [...toggle, { label: 'Cancel', variant: 'outline-danger', onClick: () => api.cancelTransfer(id).catch(() => {}) }];
                }
                case 'paused':
                    return [
                        ...(view.canPause || settling.get(id)?.kind === 'resume' ? [{ label: 'Resume', onClick: (button) => pauseOrResume(button, id, false) }] : []),
                        { label: 'Cancel', variant: 'outline-danger', onClick: () => api.cancelTransfer(id).catch(() => {}) },
                    ];
                case 'queued':
                    return [{ label: 'Cancel', variant: 'outline-danger', onClick: () => api.cancelTransfer(id).catch(() => {}) }];
                case 'done':
                    return [
                        { label: 'Copy Link', onClick: () => copyLink(view) },
                        // While the transfer window holds its manage token: from its end until it's removed.
                        ...(view.canDelete ? [{ label: 'Delete', variant: 'outline-danger', onClick: (button) => deleteUpload(button, view) }] : []),
                    ];
                case 'failed':
                case 'cancelled':
                    return [{ label: 'Retry', onClick: () => api.retryTransfer(id).catch(() => {}) }];
                default:
                    return [];
            }
        }

        /**
         * The pauses and resumes asked from here and not yet seen through, by
         * upload: { kind, answered }. While one settles, core says the upload
         * can't be paused, which would take its button away; the button stays
         * on the card, busy, until the upload has moved on, or the request was
         * answered and it hasn't (it was refused, or came too late).
         */
        const settling = new Map();

        /** Whether a pause or a resume asked from here has been seen through, as the upload is now. */
        function settled(view, { kind, answered }) {
            if (!['running', 'paused'].includes(view.state)) return true;
            if (kind === 'pause') return view.state === 'paused' || (answered && view.canPause);
            return (view.state === 'running' && view.status !== 'paused') || (answered && view.state === 'paused');
        }

        /**
         * Pause or Resume: busy until the upload's next state; the upload
         * moving on before it landed is silent, and any other refusal is
         * core's reason, as a warning.
         */
        async function pauseOrResume(button, id, pause) {
            const asked = { kind: pause ? 'pause' : 'resume', answered: false };
            settling.set(id, asked);
            const restore = kit.ui.busy(button, pause ? 'Pausing…' : 'Resuming…');
            const { message } = await (pause ? api.pauseTransfer(id) : api.resumeTransfer(id)).catch(() => ({}));
            asked.answered = true;
            if (message) {
                settling.delete(id);
                restore();
                kit.ui.toast(message, { type: 'warning' });
            }
            // As the upload is now: it may have moved on before this answer came.
            if (shown.has(id)) draw(shown.get(id).view);
        }

        /**
         * Delete, once the person has said so: the transfer window deletes it
         * from its server, with its manage token, and its card then says it's
         * gone. Busy until then; the reason, if it couldn't be.
         */
        async function deleteUpload(button, view) {
            const ok = await kit.ui.confirm({
                title: 'Delete This Upload?',
                body: `${serverName()} removes it at once, and its link stops working.`,
                confirmLabel: 'Delete',
                variant: 'danger',
                icon: 'delete',
            });
            if (!ok || !button.isConnected) return;
            const restore = kit.ui.busy(button, 'Deleting…');
            const { message } = await api.deleteTransfer(view.id).catch((error) => ({ message: error?.message || String(error) }));
            if (message) {
                restore();
                kit.ui.toast(`Couldn't delete ${nameOf(view)}: ${sentence(message)}`, { type: 'danger' });
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
                    onConfigure: () => openAdvanced([shown.get(view.id)]),
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
            if (settling.has(view.id) && settled(view, settling.get(view.id))) settling.delete(view.id);
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
                // Advanced Options and the server, until it starts (a share being asked about is the share's).
                locked: !editable(view),
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
        const keepLog = kit.ui.switchField({
            id: 'keep-log-on-disk',
            label: 'Keep log on disk for troubleshooting',
            checked: settings.keepLogOnDisk,
            help: {
                on: "The app's log is also kept in a file on this computer, with none of your file names, folders or links in it, so you can send it with a bug report. Turning it off deletes the file.",
                off: "The app's log is kept in memory only, and goes when the app closes.",
            },
            onChange: (checked) => kitApi.setSettings({ keepLogOnDisk: checked }),
        });
        $('privacy-settings').append(keepLog.element);

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
         * Start uploads waiting: the server checked first; any whose lifetime
         * or download limit is outside what it allows now stops them, with a
         * warning that can go on with the server's limits instead (or leave
         * them all waiting); and the Upload Security Warning is asked once
         * when they won't be end-to-end encrypted. Main runs them in the
         * transfer window, as places free. One stopped before it starts is
         * told to main, and stays waiting.
         */
        async function startUploads(ids) {
            if (ids.length === 0) return;
            const serverCheck = await checkServerCompatibility();
            if (!serverCheck.compatible) {
                api.uploadFinished({ status: 'error', error: serverCheck.message || 'Server is not compatible.' });
                return;
            }
            const outside = ids.map((id) => shown.get(id)?.view).filter((view) => view && startable(view) && outsideLimits(view.options));
            if (outside.length > 0) {
                if (!(await askServerLimits(outside))) return;
                try {
                    for (const view of outside) await api.setTransferOptions(view.id, withinLimits(view.options));
                } catch {
                    // One started or went meanwhile: what's left goes on as it is, and the server refuses anything outside its limits.
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

        /** The server's limits on a lifetime (in hours, 0 for none) and on downloads (0 for none), as it last said. */
        const limitsOf = (upload) => ({ hours: upload.maxLifetimeHours, downloads: upload.maxFileDownloads ?? 1 });

        /** Whether a lifetime is longer than the server allows: unlimited, or past its limit. */
        function lifetimeOutside(lifetime, limits) {
            if (limits.hours === 0) return false;
            const ms = lifetime.unit === 'unlimited' ? 0 : lifetimeToMs(lifetime.value, lifetime.unit);
            return ms === 0 || ms > limits.hours * 3_600_000;
        }

        /** Whether a download limit is more than the server allows: unlimited, or past its limit. */
        const downloadsOutside = (n, limits) => limits.downloads > 0 && (n === 0 || n > limits.downloads);

        /** Whether an upload's options are outside the server's limits, as it last said them. */
        function outsideLimits(options) {
            const upload = serverCapabilities?.upload;
            if (!options || !upload) return false;
            const limits = limitsOf(upload);
            return lifetimeOutside(options.lifetime, limits) || downloadsOutside(options.maxDownloads, limits);
        }

        /** An upload's options held to the server's limits: each one outside becomes its limit. */
        function withinLimits(options) {
            const limits = limitsOf(serverCapabilities.upload);
            return {
                lifetime: lifetimeOutside(options.lifetime, limits) ? { value: limits.hours, unit: 'hours' } : options.lifetime,
                maxDownloads: downloadsOutside(options.maxDownloads, limits) ? limits.downloads : options.maxDownloads,
            };
        }

        /** What the server allows, in a sentence: "keeps files up to 24 hours and allows up to 5 downloads". */
        function limitsSentence(upload) {
            const limits = limitsOf(upload);
            const keeps = limits.hours === 0 ? 'keeps files with no time limit' : `keeps files up to ${hours(limits.hours)}`;
            return `${keeps} and allows ${limits.downloads === 0 ? 'any number of downloads' : `up to ${countOf(limits.downloads, 'download')}`}`;
        }

        /**
         * The warning before uploads whose options are outside the server's
         * limits as it says them now: true to go on with its limits instead.
         * @param {any[]} views - Those outside them.
         */
        function askServerLimits(views) {
            const [one] = views;
            const asks = views.length === 1
                ? `This upload asks for ${lifetimeText(one.options.lifetime)} and ${downloadsText(one.options.maxDownloads)}.`
                : `${countOf(views.length, 'upload')} here ask for more than that.`;
            return kit.ui.confirm({
                title: "Outside This Server's Limits",
                body: `${serverName()} ${limitsSentence(serverCapabilities.upload)}. ${asks}`,
                detail: views.length === 1
                    ? 'The server may have lowered its limits since this upload was added.'
                    : 'The server may have lowered its limits since these uploads were added.',
                confirmLabel: "Use the Server's Limits",
                variant: 'warning',
                icon: 'warning',
            });
        }

        /**
         * Advanced Options, for one upload waiting (its card's) or several
         * (Bulk Edit, for those selected): its file lifetime and download
         * limit, offering only what the server allows (Apply is off, with the
         * help line saying why, for a value outside); how it will be sent,
         * shown, never switched off; and for one of several files, the files,
         * each with its own Remove. The server's Allow Fallback comes with
         * several servers (phase 14 of the plan, beyond this one server).
         * Apply sets them on main's upload; Cancel leaves it as it was.
         * @param {any[]} entries
         */
        async function openAdvanced(entries) {
            const views = entries.map((entry) => entry?.view).filter(editable);
            if (views.length === 0) return;
            if (!serverCapabilities?.upload) await checkServerCompatibility();
            const upload = serverCapabilities?.upload;
            if (!lastServerCheck.compatible || !upload) {
                kit.ui.toast(lastServerCheck.message || 'Could not connect to the server.', { type: 'warning' });
                return;
            }
            const [first] = views;
            const many = views.length > 1;
            const host = serverName();
            const limits = limitsOf(upload);

            // The kit has no form dialog yet: the page's own, drawn on the kit's dialog classes.
            // kit-gap: https://github.com/diamonddigitaldev/electron-kit/issues/65
            const dialog = element('dialog', 'kit-dialog options-dialog');
            dialog.setAttribute('aria-labelledby', 'options-title');
            const title = element('h2', 'kit-dialog-title');
            const titleText = element('span', '', 'Advanced Options');
            titleText.id = 'options-title';
            title.append(glyph('tune', 'kit-dialog-icon'), titleText);
            const close = element('button', 'btn-close');
            close.type = 'button';
            close.setAttribute('aria-label', 'Close');
            close.addEventListener('click', () => dialog.close());
            const body = element('div', 'kit-dialog-body options-body');
            const footer = element('div', 'kit-dialog-footer');
            const header = element('div', 'kit-dialog-header');
            header.append(title, close);
            dialog.append(header, body, footer);
            body.append(element('p', 'kit-dialog-text', many ? `For the ${countOf(views.length, 'upload')} selected.` : nameOf(first)));

            // The files of one upload of several: each can be taken out, but the last.
            let kept = first.files.map((file, index) => ({ ...file, index }));
            const fileList = element('div', 'options-files');
            fileList.setAttribute('role', 'list');
            fileList.setAttribute('aria-label', 'Files');
            const drawFiles = () => fileList.replaceChildren(...kept.map((file) => {
                const row = element('div', 'options-file');
                row.setAttribute('role', 'listitem');
                const remove = element('button', 'options-file-remove');
                remove.type = 'button';
                remove.title = 'Remove';
                remove.setAttribute('aria-label', `Remove ${file.name}`);
                remove.disabled = kept.length === 1;
                remove.append(glyph('close'));
                remove.addEventListener('click', () => {
                    kept = kept.filter((other) => other !== file);
                    drawFiles();
                });
                row.append(glyph('insert_drive_file', 'text-secondary'), element('span', 'options-file-name', file.name), element('span', 'options-file-size', formatBytes(file.size)), remove);
                return row;
            }));
            if (!many && first.files.length > 1) {
                drawFiles();
                body.append(element('div', 'form-label mb-0', 'Files'), fileList);
            }

            // File lifetime: no unit allows more than the server does, and Unlimited only where it has no limit.
            const lifetime = first.options.lifetime;
            const lifetimeValue = element('input', 'form-control');
            lifetimeValue.type = 'number';
            lifetimeValue.id = 'options-lifetime';
            lifetimeValue.min = '0';
            lifetimeValue.step = 'any';
            lifetimeValue.value = lifetime.unit === 'unlimited' ? '' : String(lifetime.value);
            const lifetimeUnit = element('select', 'form-select');
            lifetimeUnit.id = 'options-lifetime-unit';
            lifetimeUnit.setAttribute('aria-label', 'Unit');
            for (const [value, label, most] of [['minutes', 'Minutes', limits.hours * 60], ['hours', 'Hours', limits.hours], ['days', 'Days', limits.hours / 24],
                ['unlimited', limits.hours === 0 ? 'Unlimited' : 'Unlimited (not allowed by the server)', 0]]) {
                const option = element('option', '', label);
                option.value = value;
                option.dataset.most = String(most);
                option.disabled = (value === 'unlimited' && limits.hours !== 0) || (value === 'days' && limits.hours !== 0 && limits.hours < 24);
                lifetimeUnit.append(option);
            }
            lifetimeUnit.value = lifetime.unit;
            const lifetimeGroup = element('div', 'input-group input-group-sm');
            lifetimeGroup.append(lifetimeValue, lifetimeUnit);
            const lifetimeField = formField('File lifetime', lifetimeGroup, 'options-lifetime');

            // Max downloads: up to the server's limit, 0 (unlimited) only where it has none, and fixed where it allows one.
            const downloads = element('input', 'form-control form-control-sm');
            downloads.type = 'number';
            downloads.id = 'options-downloads';
            downloads.min = limits.downloads === 0 ? '0' : '1';
            if (limits.downloads > 0) downloads.max = String(limits.downloads);
            downloads.step = '1';
            // Where the server allows 1, it's the only value there is, whatever the upload had.
            downloads.value = String(limits.downloads === 1 ? 1 : first.options.maxDownloads);
            downloads.disabled = limits.downloads === 1;
            const downloadsField = formField('Max downloads', downloads, 'options-downloads');

            // How it will be sent: shown, and never switched off here.
            const encryption = element('div', 'options-encryption');
            const encrypts = serverEncrypts();
            encryption.append(glyph(encrypts ? 'verified' : 'gpp_bad', encrypts ? 'text-success-emphasis' : 'text-danger-emphasis'), element('span', '', encrypts
                ? `End-to-end encrypted. ${host} can't read your files or their names.`
                : isPlainHttp(serverBaseUrl ?? '')
                    ? `Not encrypted: ${host} is plain HTTP, so the server can read your files.`
                    : `Not encrypted: ${host} doesn't support end-to-end encryption, so the server can read your files.`));
            body.append(lifetimeField.wrap, downloadsField.wrap, encryption);

            const cancel = element('button', 'btn btn-secondary', 'Cancel');
            cancel.type = 'button';
            cancel.addEventListener('click', () => dialog.close());
            const apply = element('button', 'btn btn-primary', 'Apply');
            apply.type = 'button';
            footer.append(cancel, apply);

            /** The lifetime as the fields say it, or null when it isn't one. */
            const readLifetime = () => {
                if (lifetimeUnit.value === 'unlimited') return { value: 0, unit: 'unlimited' };
                const value = Number(lifetimeValue.value);
                return lifetimeValue.value.trim() !== '' && Number.isFinite(value) && value > 0 ? { value, unit: lifetimeUnit.value } : null;
            };
            /** The download limit as its field says it, or null when it isn't a whole number. */
            const readDownloads = () => {
                const n = Number(downloads.value);
                return downloads.value.trim() !== '' && Number.isSafeInteger(n) && n >= 0 ? n : null;
            };

            /** Each help line says what the server allows, or why a value is outside it; Apply is off while one is. */
            const check = () => {
                const unit = lifetimeUnit.value;
                const most = Number(lifetimeUnit.selectedOptions[0]?.dataset.most ?? 0);
                lifetimeValue.disabled = unit === 'unlimited';
                if (unit === 'unlimited') lifetimeValue.value = '';
                if (limits.hours !== 0) lifetimeValue.max = String(most);
                else lifetimeValue.removeAttribute('max');

                const allows = limits.hours === 0 ? `${host} has no time limit.` : `${host} keeps files up to ${hours(limits.hours)}.`;
                const life = readLifetime();
                let lifeWhy = null;
                if (!life) lifeWhy = 'Enter a lifetime of more than 0.';
                else if (lifetimeOutside(life, limits)) {
                    lifeWhy = life.unit === 'unlimited'
                        ? `${host} doesn't allow unlimited. It keeps files up to ${hours(limits.hours)}.`
                        : `Too long for ${host}, which keeps files up to ${hours(limits.hours)}.`;
                }
                setHelp(lifetimeField.help, lifeWhy ?? allows, lifeWhy ? 'danger' : undefined);

                const n = readDownloads();
                let downloadsWhy = null;
                if (n === null) downloadsWhy = limits.downloads === 0 ? 'Enter a whole number: 0 or more.' : `Enter a whole number from 1 to ${limits.downloads}.`;
                else if (downloadsOutside(n, limits)) {
                    downloadsWhy = n === 0
                        ? `${host} doesn't allow unlimited downloads. It allows up to ${countOf(limits.downloads, 'download')}.`
                        : `Too many for ${host}, which allows up to ${countOf(limits.downloads, 'download')}.`;
                }
                const downloadsAllow = limits.downloads === 0 ? '0 means unlimited downloads.'
                    : limits.downloads === 1 ? `${host} allows 1 download.` : `${host} allows up to ${countOf(limits.downloads, 'download')}.`;
                setHelp(downloadsField.help, downloadsWhy ?? downloadsAllow, downloadsWhy ? 'danger' : undefined);
                apply.disabled = Boolean(lifeWhy || downloadsWhy);
            };
            for (const control of [lifetimeValue, downloads]) control.addEventListener('input', check);
            lifetimeUnit.addEventListener('change', check);
            check();

            apply.addEventListener('click', async () => {
                const options = { lifetime: readLifetime(), maxDownloads: readDownloads() };
                if (!many && kept.length !== first.files.length) options.files = kept.map((file) => file.index);
                dialog.close();
                const refused = [];
                for (const view of views) {
                    await api.setTransferOptions(view.id, options).catch(() => refused.push(view));
                }
                if (refused.length > 0) {
                    kit.ui.toast(refused.length === 1 ? 'That upload has already started, so its options stay as they were.'
                        : `${countOf(refused.length, 'upload')} had already started, so their options stay as they were.`, { type: 'warning' });
                }
            });

            dialog.addEventListener('close', () => dialog.remove());
            document.body.append(dialog);
            dialog.showModal();
        }

        /** An element of the page's own, with its class and its text: never markup. */
        function element(tag, className, text) {
            const made = document.createElement(tag);
            if (className) made.className = className;
            if (text !== undefined) made.textContent = text;
            return made;
        }

        /** A Material Icons Round glyph, hidden from screen readers, in a tone if given. */
        function glyph(name, tone) {
            const icon = document.createElement('span');
            icon.className = 'material-icons-round';
            if (tone) icon.classList.add(tone);
            icon.setAttribute('aria-hidden', 'true');
            icon.textContent = name;
            return icon;
        }

        /** A form row: its label above, the control, and its help line with its height kept, which describes it. */
        function formField(label, control, id) {
            const wrap = element('div');
            const labelElement = element('label', 'form-label', label);
            labelElement.htmlFor = id;
            const help = element('div', 'form-text reserved');
            help.id = `${id}-help`;
            for (const input of control.matches('input, select') ? [control] : control.querySelectorAll('input, select')) {
                input.setAttribute('aria-describedby', help.id);
            }
            wrap.append(labelElement, control, help);
            return { wrap, help };
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
            // Each card's settings line says what differs from these.
            for (const entry of shown.values()) draw(entry.view);
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
