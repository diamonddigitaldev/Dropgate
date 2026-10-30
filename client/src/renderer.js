// The page: Dropgate's Upload and Download sections and its Servers, Transfers and Privacy tabs, in the
// kit's frame (kit.ui.mountShell()): the nav rail, the header (with Add
// Files), and the Settings view, with Update and Credits after Dropgate's own
// tabs. The drop zone, the cards, their grid and bulk bar, the action bar, the
// prompts and the toasts are the kit's too. The settings are the kit's
// (window.kitAPI), saved as they change.
//
// Download (below, "--- Download ---") is a card for each download, made from
// a link pasted into its box; Settings > Transfers says where downloads are
// saved and how many transfers run at once.
//
// Upload is a card for each upload in main's registry: waiting for Upload,
// queued, running, paused, and once ended, done (with its link), failed or
// cancelled, until it's removed. Files dropped, picked or opened together make
// one upload; files dropped onto one still waiting join it (a file already in
// it is skipped), and onto one that has started make a new one. A new upload
// starts on the default server, with its settings for new uploads (Settings >
// Servers); its "To" (or the bulk bar's "Upload all to", for several) moves it
// to another saved server while it waits, and it takes that server's
// settings. A server is checked as an upload picks it, unless this run found
// it already, and again as uploads start on it. Each card starts with its
// Upload, or all waiting with the action bar's Upload All. One waiting can
// have its own options (its Advanced Options, or Bulk Edit on the bulk bar for
// those selected): its file lifetime and download limit, bounded by what its
// server allows, its Allow Fallback, and the files it keeps; its settings line
// says what differs from its server's settings for new uploads. One that
// allows fallback and that its server can't take before it starts moves down
// the saved order, in main, which asks here first before a step down (a less
// private server, or smaller limits); its To then names the server that took
// it, its settings line the one it moved from. One whose options get past that
// (an edited config.json, a server that lowered its limits since) is stopped
// at its start by a warning, which can go on with the server's limits. Its
// encryption, the Upload Security Warning and Pause go by its own server's
// last check. A finished one can be deleted from its server (Delete), with
// the manage token only the transfer window holds.
//
// The page runs no core and makes no request: it holds each file as the
// handle main made for it only until it's handed to an upload, never its
// path, and main runs each server check and upload in the transfer window,
// and tells the page how they go: each transfer as it is (onTransferChanged),
// each one removed (onTransfersRemoved), and each upload's outcome
// (onUploadStatus). Share with Dropgate's uploads are cards too, and the page
// asks the Upload Security Warning for one to a server with no end-to-end
// encryption, when main opens it to (onAskInsecure).
//
// Settings > Servers (below, "--- Settings > Servers ---") is a row for each
// saved server, in order, as main keeps them: its name, its address, its
// status (what its last check this run found, which main holds in memory, or
// "Not checked yet"), its limits once checked, its settings for new uploads
// (bounded by its limits), Test, Set as Default, Move Up, Move Down and
// Remove; Add Server checks an address before it's added. The page changes
// none of it itself: main does, as it asks.

const api = window.electronAPI;
const kitApi = window.kitAPI;

/** What Restart Now says while an upload runs, from this window or Share with Dropgate. */
const BUSY_REASON = 'An upload is in progress.';


/** A file lifetime in ms, to hold it to the server's limit here: core's lifetime.toMs(), which the upload itself uses. */
const LIFETIME_UNIT_MS = { minutes: 60_000, hours: 3_600_000, days: 86_400_000 };
const lifetimeToMs = (value, unit) => (Number.isFinite(value) && value > 0 && LIFETIME_UNIT_MS[unit] ? Math.round(value * LIFETIME_UNIT_MS[unit]) : 0);

/** The states a transfer has once it has ended, and those going. */
const ENDED = ['done', 'failed', 'cancelled', 'deleted'];
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
        const { countOf, formatBytes, plural } = kit.format;

        // Share with Dropgate is Windows' right-click entry: elsewhere, the Servers tab doesn't mention it.
        if (!navigator.userAgent.includes('Windows')) {
            $('servers-help').textContent = "A new upload starts on the default server, with that server's settings. Servers are tried in this order when an upload allows fallback. Each server is checked only when it's used.";
        }

        /** How many transfers run at once: Settings > Transfers' transfersAtOnce, read with the settings. */
        let atOnce = 3;

        /**
         * The saved servers, the default's ID, and what each one's last
         * check this run found, by its ID, as main last answered (main alone
         * changes them, and holds the checks in memory). Settings > Servers
         * shows them.
         * @type {{ servers: any[], defaultServer: string | null, checks: Record<string, any> }}
         */
        let saved = { servers: [], defaultServer: null, checks: {} };
        /** The default server, as main reads it (the first, if the one named is gone): new uploads and Share with Dropgate start on it. */
        const defaultSaved = () => saved.servers.find((server) => server.id === saved.defaultServer) ?? saved.servers[0] ?? null;
        /** A saved server, by its ID, or null when it isn't saved (removed, or none given). */
        const savedById = (id) => saved.servers.find((server) => server.id === id) ?? null;

        /**
         * Each server's last check this run, by ID, as main answered it: what
         * its uploads are held to, whether they're encrypted, and whether they
         * can pause. Kept here too for a server removed since, whose uploads
         * under way carry on (main forgets a removed server's).
         */
        const seenChecks = new Map();
        const checkOf = (id) => (id ? seenChecks.get(id) ?? null : null);

        // --- The frame ---
        const shell = kit.ui.mountShell({
            title: 'Dropgate Client',
            sections: [
                { view: 'upload', label: 'Upload', icon: 'upload_file', element: uploadView },
                { view: 'download', label: 'Download', icon: 'download', element: $('download-view') },
            ],
            toolbar: $('toolbar'),
            settingsTabs: [
                { id: 'servers', label: 'Servers', render: (pane) => pane.append($('servers-settings')) },
                { id: 'transfers', label: 'Transfers', render: (pane) => pane.append($('transfers-settings')) },
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

        // "Upload all to" (or "Upload selected to"): the saved server for every upload waiting, or those selected.
        const bulkTarget = document.createElement('select');
        bulkTarget.className = 'form-select form-select-sm';
        bulkTarget.addEventListener('change', () => pickServer(scope().map(({ view }) => view), bulkTarget.value));
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
        /** Whether Upload starts it from here: waiting, and not one being asked about (a share's warning, or a fallback's step down). */
        const startable = (view) => view.state === 'waiting' && !asking.has(view.id) && !view.asking;
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

        /**
         * A saved server's name in a "To" select: its name, with its host
         * where another saved server has the same name (many keep "Dropgate
         * Server"), and "(default)" on the default.
         */
        function serverLabel(server) {
            const twin = saved.servers.some((other) => other.id !== server.id && other.name === server.name);
            const name = twin ? `${server.name} (${hostName(server.url)})` : server.name;
            return server.id === defaultSaved()?.id ? `${name} (default)` : name;
        }

        /**
         * Fill a "To" select: every saved server, in order, by name, with
         * `chosen` (a server's ID) chosen, or the default. An upload's server
         * removed since it started (`gone`, as its card names it) is shown
         * for it too; with none saved, "No server".
         * @param {HTMLSelectElement} select
         * @param {string | null} chosen
         * @param {{ id: string, name: string } | null} [gone]
         */
        function fillServers(select, chosen, gone = null) {
            const option = (value, label) => {
                const made = element('option', '', label);
                made.value = value;
                return made;
            };
            const options = saved.servers.map((server) => option(server.id, serverLabel(server)));
            if (gone && !savedById(gone.id)) options.push(option(gone.id, gone.name));
            if (options.length === 0) options.push(option('', 'No server'));
            select.replaceChildren(...options);
            select.value = [...select.options].some((o) => o.value === chosen) ? chosen : defaultSaved()?.id ?? select.options[0].value;
        }

        /**
         * An upload's "To", or "Upload all to" for several, changed: each
         * waiting goes to that saved server, with its settings for new
         * uploads, as main gives them. The server is checked now unless this
         * run found it already: its row says so meanwhile.
         * @param {any[]} views
         * @param {string} id - The saved server's ID.
         */
        async function pickServer(views, id) {
            const moving = views.filter((view) => editable(view) && view.server?.id !== id);
            if (!savedById(id) || moving.length === 0) return;
            let refused = 0;
            for (const view of moving) await api.setTransferOptions(view.id, { server: id }).catch(() => { refused++; });
            if (refused > 0) {
                kit.ui.toast(refused === 1 ? 'That upload has already started, so its server stays as it was.'
                    : `${countOf(refused, 'upload')} had already started, so their servers stay as they were.`, { type: 'warning' });
            }
            if (!checkOf(id)?.ok && !checking.has(id)) await testServer(id);
        }

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
                case 'queued': return { text: `Queued: Starts when one of the ${atOnce} running finishes.`, tone: 'muted' };
                case 'paused':
                    return { text: view.deadline ? `Paused. Kept until ${formatDeadline(view.deadline)}.` : 'Paused.', tone: 'warning' };
                case 'running': {
                    if (view.phase === 'chunk' && typeof view.percent === 'number') {
                        const of = view.files.length > 1 && Number.isInteger(view.fileIndex) ? ` · File ${view.fileIndex + 1} of ${view.files.length}` : '';
                        return { text: `Uploading ${Math.floor(view.percent)}%${of}`, tone: 'running' };
                    }
                    return { text: tidy(view.step) || 'Starting…', tone: 'running' };
                }
                case 'done':
                    // One that fell back says which server took it.
                    if (view.movedFrom && view.server) {
                        return { text: `Uploaded to ${view.server.name} · ${view.options?.encrypt ? 'End-to-End Encrypted' : 'Not Encrypted'}`, tone: 'success' };
                    }
                    return { text: view.options?.encrypt ? 'Uploaded · End-to-End Encrypted' : 'Uploaded · Not Encrypted', tone: 'success' };
                case 'failed': return { text: `Failed: ${sentence(view.message ?? 'The upload stopped.')}`, tone: 'danger' };
                case 'cancelled': return { text: 'Cancelled', tone: 'muted' };
                case 'deleted': return { text: 'Deleted from the server. Its link no longer works.', tone: 'muted' };
                default: return { text: view.state, tone: 'muted' };
            }
        }

        /**
         * Its settings line, by its own server: that it won't be end-to-end
         * encrypted, or else, once it has fallen back, the server it moved
         * from, then what it has that differs from its server's settings for
         * new uploads ("Moved From Share Space · 3 Days · 10 Downloads · Allow
         * Fallback"), or nothing.
         */
        function settingsOf(view) {
            const server = savedById(view.server?.id);
            const check = checkOf(view.server?.id);
            const plain = view.options?.encrypt === false || (view.state === 'waiting' && compatibilityOf(server, check).compatible && !encryptsBy(check));
            if (plain) {
                return { text: isPlainHttp(server?.url ?? check?.baseUrl ?? '') ? 'Not encrypted: This server is plain HTTP.' : "Not encrypted: This server doesn't support it.", tone: 'warning' };
            }
            const differs = view.movedFrom ? [`Moved From ${view.movedFrom.name}`] : [];
            const usual = newUploadOptions(view);
            if (view.options && usual) {
                if (!sameLifetime(view.options.lifetime, usual.lifetime)) differs.push(lifetimeTitle(view.options.lifetime));
                if (view.options.maxDownloads !== usual.maxDownloads) differs.push(downloadsTitle(view.options.maxDownloads));
                if (view.options.allowFallback !== usual.allowFallback) differs.push(view.options.allowFallback ? 'Allow Fallback' : 'No Fallback');
            }
            return differs.length > 0 ? differs.join(' · ') : undefined;
        }

        /**
         * An upload's server's settings for new uploads, as saved: what main
         * gave it (a new server's, with none saved when it was made); null for
         * a server removed since.
         */
        function newUploadOptions(view) {
            if (!view.server) return { lifetime: { value: 24, unit: 'hours' }, maxDownloads: 1, allowFallback: false };
            const server = savedById(view.server.id);
            return server ? { lifetime: server.lifetime, maxDownloads: server.maxDownloads, allowFallback: server.allowFallback === true } : null;
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
                    const pausable = (uploadsOf(checkOf(view.server?.id))?.maxPauseMinutes ?? 0) > 0 && view.canPause && ['initializing', 'uploading'].includes(view.status);
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
            // As it is now: it may have moved on before this answer came.
            const entry = shown.get(id) ?? downloadsShown.get(id);
            if (entry) draw(entry.view);
        }

        /**
         * Delete, once the person has said so: the transfer window deletes it
         * from its server, with its manage token, and its card then says it's
         * gone. Busy until then; the reason, if it couldn't be.
         */
        async function deleteUpload(button, view) {
            const ok = await kit.ui.confirm({
                title: 'Delete This Upload?',
                body: `${view.server?.host ?? 'The server'} removes it at once, and its link stops working.`,
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

        /** Draw a transfer as main says it is now, on Upload or on Download. */
        function draw(view) {
            if (view.kind === 'download') drawDownload(view);
            else if (view.kind === 'upload') drawUpload(view);
        }

        /** Draw an upload as main says it is now: a new card, or the one it has. */
        function drawUpload(view) {
            let entry = shown.get(view.id);
            if (!entry) {
                const select = document.createElement('select');
                select.className = 'form-select form-select-sm';
                select.setAttribute('aria-label', 'Upload to');
                select.addEventListener('change', () => pickServer([shown.get(view.id)?.view].filter(Boolean), select.value));
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
            // Its server, as main says, unless the select is in use.
            if (document.activeElement !== entry.select) fillServers(entry.select, view.server?.id ?? null, view.server);
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

        /** Transfers gone from main's registry. */
        function forget(ids) {
            for (const id of ids) {
                settling.delete(id);
                const entry = shown.get(id);
                if (entry) {
                    shown.delete(id);
                    idOf.delete(entry.card);
                    asking.delete(id);
                    grid.remove(entry.card);
                }
                const download = downloadsShown.get(id);
                if (download) {
                    downloadsShown.delete(id);
                    downloadIdOf.delete(download.card);
                    downloadGrid.remove(download.card);
                }
            }
            drawBars();
            drawDownloadBars();
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
                // With nothing to upload yet, the line says why uploads can't start on the default, if they can't.
                summary: views.length > 0 ? countOf(views.length, 'upload') : defaultCompatibility().compatible ? '' : defaultCompatibility().message,
                detail: parts.join(' · '),
                percent: percents.length ? percents.reduce((sum, percent) => sum + percent, 0) / percents.length : 0,
                running: false,
                canRun: views.some(startable),
                canClear: views.some((view) => ENDED.includes(view.state)),
            });
            bulk.refresh();
        }

        // --- Download ---
        // A link pasted (Add, or Enter) makes a download: main passes the link
        // to the transfer window, which reads its list of files with no lease
        // (nothing is counted), and the page holds the link no longer than it
        // takes to hand it over. The download waits, Ready, with its Save to:
        // the folder new downloads are saved in (Settings > Transfers), or one
        // chosen with the system's picker (Choose Folder…), which the page knows
        // by an ID and its name only. A link to several files (a bundle) is
        // saved as files in a new folder of its own there, or as one ZIP, all
        // its files or those chosen (Advanced Options; Bulk Edit for several).
        // Download starts it; once it's saved, Show in Folder shows it in its
        // folder (Open Folder opens a bundle's own), and nothing received is
        // ever opened.

        /**
         * Each download drawn, by the ID main made: what main last said of it, its card and its Save to select.
         * @type {Map<string, { view: any, card: any, select: HTMLSelectElement }>}
         */
        const downloadsShown = new Map();
        const downloadIdOf = new Map();
        const linkInput = $('link-input');
        const downloadGrid = kit.ui.cardGrid($('download-grid'), { view: 'download', onSelect: () => drawDownloadBars() });
        const downloadScope = () => (downloadGrid.selection.length > 0 ? downloadGrid.selection : downloadGrid.cards)
            .map((card) => downloadsShown.get(downloadIdOf.get(card))).filter(Boolean);

        /** Where new downloads are saved, as main says (Settings > Transfers): its path, shown there, and its name, shown on each download. */
        let defaultFolder = { path: '', label: 'Downloads', chosen: false };
        /** The folders this window chose with the system's picker, by the ID main made: each one's name. */
        const chosenFolders = [];

        /** Fill a Save to select: the default folder, those chosen, then Choose Folder…. */
        function fillFolders(select, current = 'default') {
            const option = (value, label) => {
                const made = element('option', '', label);
                made.value = value;
                return made;
            };
            select.replaceChildren(option('default', defaultFolder.label), ...chosenFolders.map(({ folder, label }) => option(folder, label)), option('choose', 'Choose Folder…'));
            select.value = current;
        }

        /**
         * Save to changed, on one download or (the bulk bar's "Save all to")
         * several: a folder known already, or one chosen now with the
         * system's picker; picking none leaves them as they were.
         * @param {HTMLSelectElement} select
         * @param {() => any[]} views - The downloads it's for.
         * @param {string} was - What the select said before.
         */
        async function changeSaveTo(select, views, was) {
            let folder = select.value;
            if (folder === 'choose') {
                const picked = await api.chooseFolder().catch(() => null);
                if (!picked) {
                    select.value = was;
                    return;
                }
                chosenFolders.push(picked);
                folder = picked.folder;
                refreshFolders();
            }
            const ids = views().filter(saveable).map((view) => view.id);
            if (ids.length > 0) await api.saveDownloadsTo(ids, folder).catch(() => kit.ui.toast('Those downloads have started, so where they are saved stays as it was.', { type: 'warning' }));
        }

        /** Every Save to select, and the bulk bar's, with the folders as they are now. */
        function refreshFolders() {
            fillFolders(saveAllTo, saveAllTo.value === 'choose' ? 'default' : saveAllTo.value);
            for (const entry of downloadsShown.values()) fillFolders(entry.select, entry.view.saveTo?.folder ?? 'default');
        }

        /** Whether a download's Save to can change: it hasn't started. */
        const saveable = (view) => Boolean(view) && ['reading', 'waiting'].includes(view.state);
        /** Whether its files and Save as one ZIP can be chosen: a bundle's, waiting. */
        const choosable = (view) => Boolean(view) && view.state === 'waiting' && view.files.length > 1;
        /** Whether it can go: reading, waiting, or ended. One going is cancelled first. */
        const downloadRemovable = (view) => Boolean(view) && (saveable(view) || ENDED.includes(view.state));

        const saveAllTo = element('select', 'form-select form-select-sm');
        let saveAllWas = 'default';
        saveAllTo.addEventListener('focus', () => { saveAllWas = saveAllTo.value; });
        saveAllTo.addEventListener('change', () => changeSaveTo(saveAllTo, () => downloadScope().map(({ view }) => view), saveAllWas));
        fillFolders(saveAllTo);
        const downloadBulk = kit.ui.bulkBar(downloadGrid, {
            noun: 'download',
            target: { verb: 'Save', control: saveAllTo, note: () => '' },
            actions: [{
                // Advanced Options for those selected that are still waiting: Save as one ZIP, for a bundle's.
                label: 'Bulk Edit',
                variant: 'primary',
                selection: true,
                enabled: (picked) => picked.some((card) => choosable(downloadsShown.get(downloadIdOf.get(card))?.view)),
                onClick: (picked) => openDownloadOptions(picked.map((card) => downloadsShown.get(downloadIdOf.get(card))?.view)),
            }, {
                label: 'Remove',
                variant: 'outline-danger',
                selection: true,
                enabled: (picked) => picked.some((card) => downloadRemovable(downloadsShown.get(downloadIdOf.get(card))?.view)),
                onClick: (picked) => removeDownloads(picked.map((card) => downloadsShown.get(downloadIdOf.get(card))).filter(Boolean)),
            }],
        });
        $('download-bulk').append(downloadBulk.element);

        const downloadActions = kit.ui.actionBar({
            run: { label: 'Download All', onClick: () => startDownloads(downloadScope().filter(({ view }) => view.state === 'waiting').map(({ view }) => view)) },
            // Each download has its own Cancel, so the bar never swaps to its abort.
            abort: { onClick: () => {} },
            clear: { label: 'Clear Finished', onClick: () => removeDownloads([...downloadsShown.values()].filter(({ view }) => ENDED.includes(view.state))) },
            progressLabel: 'Downloads in progress',
        });
        $('download-action-bar').append(downloadActions.element);

        // Delete removes the downloads selected that can go.
        kit.keys.onKey((event) => {
            if (event.key !== 'Delete' || downloadGrid.selection.length === 0) return;
            event.preventDefault();
            removeDownloads(downloadScope());
        }, { view: 'download' });

        /** A link's shape, as the page can tell it: an upload's, a direct transfer's or a code, one an older Dropgate made, or none. */
        function linkKind(value) {
            if (/^[a-z]{4}-?\d{4}$/i.test(value) || /^https?:\/\/[^/\s]+\/p2p(?:[/#?]|$)/i.test(value)) return 'direct';
            const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
            if (new RegExp(`^https?://[^/\\s?#@]+/${uuid}(?:#[A-Za-z0-9_-]{43})?$`, 'i').test(value)) return 'hosted';
            // Dropgate 3's: a bundle's page (/b/), or a file's key in standard base64 (44 characters).
            if (new RegExp(`^https?://[^/\\s?#@]+/(?:b/${uuid}(?:#.*)?|${uuid}#[A-Za-z0-9+/]{43}=)$`, 'i').test(value)) return 'older';
            return null;
        }

        /** Add the link in the box: a download, or a toast saying why not. The box is emptied once it's handed over. */
        async function addLink() {
            const value = linkInput.value.trim();
            if (!value) return;
            const kind = linkKind(value);
            if (kind === 'direct') {
                kit.ui.toast('Direct transfers come to the desktop app later. For now, this box takes links to uploads.', { type: 'info' });
                return;
            }
            if (kind === 'older') {
                kit.ui.toast("That link was made with an older version of Dropgate, which this app can't download.", { type: 'warning' });
                return;
            }
            if (kind !== 'hosted') {
                kit.ui.toast("That isn't a Dropgate link.", { type: 'danger' });
                return;
            }
            try {
                await api.addDownload(value);
                linkInput.value = '';
            } catch {
                kit.ui.toast("That isn't a Dropgate link.", { type: 'danger' });
            }
        }
        $('add-link-btn').addEventListener('click', () => addLink());
        linkInput.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') addLink();
        });

        /** A download's name on its card: its file's, or how many files; while its list is read, that. */
        function downloadName(view) {
            if (view.state === 'reading') return 'Reading the link…';
            if (view.files.length === 0) return `Link from ${view.host}`;
            return view.files.length === 1 ? view.files[0].name : countOf(view.files.length, 'file');
        }

        /** Its meta line: the size, and with several files the first's name and how many more; its server; whether it's encrypted. */
        function downloadMeta(view) {
            if (view.files.length === 0) return view.host;
            const total = view.files.reduce((sum, file) => sum + file.size, 0);
            const more = view.files.length > 1 ? ` · ${view.files[0].name} and ${view.files.length - 1} More` : '';
            return `${formatBytes(total)}${more} · ${view.host}${view.encrypted ? ' · Encrypted' : ''}`;
        }

        /**
         * Its settings line, for a bundle: how many of its files it saves, if
         * not all, and whether as one ZIP ("3 of 8 Files · As One ZIP"), or nothing.
         */
        function downloadSettings(view) {
            if (view.files.length < 2) return undefined;
            const parts = [];
            if (view.chosen) parts.push(`${view.chosen.length} of ${view.files.length} Files`);
            if (view.asZip) parts.push('As One ZIP');
            return parts.length > 0 ? parts.join(' · ') : undefined;
        }

        /** Which file of those it saves is coming now, and of how many (" · File 2 of 8"), for a bundle's; or nothing. */
        function fileOf(view) {
            const saving = view.chosen ?? view.files.map((_, index) => index);
            const at = saving.indexOf(view.fileIndex);
            return saving.length > 1 && at >= 0 ? ` · File ${at + 1} of ${saving.length}` : '';
        }

        /** Its status line. */
        function downloadStatus(view) {
            switch (view.state) {
                case 'reading': return { text: 'Reading the file list…', tone: 'running' };
                case 'waiting': return { text: 'Ready', tone: 'ready' };
                case 'queued': return { text: `Queued: Starts when one of the ${atOnce} running finishes.`, tone: 'muted' };
                case 'paused':
                    return { text: view.deadline ? `Paused. Kept until ${formatDeadline(view.deadline)}.` : 'Paused.', tone: 'warning' };
                case 'running':
                    // Finishing is moving it into its folder, which on another drive is a copy.
                    if (view.status === 'completing') return { text: 'Saving…', tone: 'running' };
                    if (view.phase === 'downloading' && typeof view.percent === 'number' && view.status === 'downloading') {
                        return { text: `Downloading ${Math.floor(view.percent)}%${fileOf(view)}`, tone: 'running' };
                    }
                    return { text: tidy(view.step) || 'Starting…', tone: 'running' };
                case 'done': {
                    const where = `Saved to ${view.saveTo?.label ?? defaultFolder.label}`;
                    return { text: view.inFolder ? `${where} · In a Folder of Its Own` : where, tone: 'success' };
                }
                case 'failed': return { text: `Failed: ${sentence(tidy(view.message) || 'The download stopped.')}`, tone: 'danger' };
                case 'cancelled': return { text: 'Cancelled', tone: 'muted' };
                default: return { text: view.state, tone: 'muted' };
            }
        }

        /** Its buttons, for its state. */
        function downloadButtons(view) {
            const { id } = view;
            const cancel = { label: 'Cancel', variant: 'outline-danger', onClick: () => api.cancelTransfer(id).catch(() => {}) };
            switch (view.state) {
                case 'waiting': return [{ label: 'Download', variant: 'primary', onClick: () => startDownloads([view]) }];
                case 'running': {
                    // Saving, it's finishing: nothing to pause, and too late to cancel.
                    if (view.status === 'completing') return [];
                    const asked = settling.get(id)?.kind;
                    const pausable = view.canPause && ['initializing', 'downloading'].includes(view.status);
                    const toggle = asked === 'resume' ? [{ label: 'Resume', onClick: () => {} }]
                        : pausable || asked === 'pause' ? [{ label: 'Pause', onClick: (button) => pauseOrResume(button, id, true) }] : [];
                    return [...toggle, cancel];
                }
                case 'paused':
                    return [...(view.canPause || settling.get(id)?.kind === 'resume' ? [{ label: 'Resume', onClick: (button) => pauseOrResume(button, id, false) }] : []), cancel];
                case 'queued': return [cancel];
                // A bundle saved as files opens its own folder; anything else shows its folder, with it selected.
                case 'done': return view.canShow ? [{
                    label: view.inFolder ? 'Open Folder' : 'Show in Folder',
                    onClick: () => api.showInFolder(id).catch(() => kit.ui.toast(view.inFolder ? "Couldn't open the folder: It was moved or deleted." : "Couldn't show the folder.", { type: 'danger' })),
                }] : [];
                case 'failed':
                case 'cancelled':
                    return view.files.length > 0 ? [{ label: 'Retry', onClick: () => api.retryTransfer(id).catch(() => {}) }] : [];
                default: return [];
            }
        }

        /** Draw a download as main says it is now: a new card, or the one it has. */
        function drawDownload(view) {
            let entry = downloadsShown.get(view.id);
            if (!entry) {
                const select = element('select', 'form-select form-select-sm');
                select.setAttribute('aria-label', 'Save to');
                let was = 'default';
                select.addEventListener('focus', () => { was = select.value; });
                select.addEventListener('change', () => changeSaveTo(select, () => [downloadsShown.get(view.id)?.view], was));
                const card = kit.ui.card({
                    icon: 'download',
                    name: downloadName(view),
                    onConfigure: () => openDownloadOptions([downloadsShown.get(view.id)?.view]),
                    onRemove: () => removeDownloads([downloadsShown.get(view.id)]),
                    route: { label: 'Save to', control: select },
                });
                entry = { view, card, select };
                downloadsShown.set(view.id, entry);
                downloadIdOf.set(card, view.id);
                downloadGrid.add(card);
            }
            entry.view = view;
            if (settling.has(view.id) && settled(view, settling.get(view.id))) settling.delete(view.id);
            if (document.activeElement !== entry.select) fillFolders(entry.select, view.saveTo?.folder ?? 'default');
            const bar = ['running', 'paused'].includes(view.state);
            entry.card.update({
                name: downloadName(view),
                meta: downloadMeta(view),
                settings: downloadSettings(view),
                status: downloadStatus(view),
                ...(bar ? { percent: view.status === 'completing' ? null : view.percent ?? null, paused: view.state === 'paused' } : {}),
                actions: downloadButtons(view),
                // Save to, while its list is read and it waits; hidden until there's a file to save.
                ...(view.files.length === 0 ? { route: false } : {}),
                locked: !saveable(view),
                canRemove: downloadRemovable(view),
            });
            drawDownloadBars();
        }

        /** Remove downloads that can go: reading, waiting, or ended. Their links go from the transfer window with them. */
        function removeDownloads(entries) {
            const ids = entries.filter((entry) => downloadRemovable(entry?.view)).map((entry) => entry.view.id);
            if (ids.length > 0) api.removeTransfers(ids).catch(() => {});
        }

        /** Start downloads waiting: each is queued, and runs as soon as it has a place. */
        async function startDownloads(views) {
            if (views.length === 0) return;
            try {
                await api.startTransfers(views.map((view) => view.id));
            } catch (error) {
                kit.ui.toast(`Couldn't start the download: ${sentence(error?.message || String(error))}`, { type: 'danger' });
            }
        }

        /** The bars under and over the downloads: the counts, progress and buttons; the line while there are none. */
        function drawDownloadBars() {
            const views = [...downloadsShown.values()].map(({ view }) => view);
            $('download-empty').hidden = views.length > 0;
            $('download-grid').hidden = views.length === 0;
            const count = (state) => views.filter((view) => view.state === state).length;
            const running = views.filter((view) => view.state === 'running');
            const parts = [[running.length, 'Running'], [count('paused'), 'Paused'], [count('queued'), 'Queued'], [count('waiting'), 'Ready']]
                .filter(([n]) => n > 0).map(([n, word]) => `${n} ${word}`);
            const percents = running.map((view) => view.percent).filter((percent) => typeof percent === 'number');
            downloadActions.update({
                summary: views.length > 0 ? countOf(views.length, 'download') : '',
                detail: parts.join(' · '),
                percent: percents.length ? percents.reduce((sum, percent) => sum + percent, 0) / percents.length : 0,
                running: false,
                canRun: views.some((view) => view.state === 'waiting'),
                canClear: views.some((view) => ENDED.includes(view.state)),
            });
            downloadBulk.refresh();
        }

        /**
         * Advanced Options on downloads waiting. For a bundle (its card's): its
         * files, each ticked to download or not (at least one), and Save as
         * one ZIP. For several (Bulk Edit, those selected): Save as one ZIP,
         * for each bundle among them. A single file has nothing more to
         * choose: where it's saved is its Save to. Apply sets them on main's
         * download; Cancel leaves it as it was.
         * @param {any[]} views
         */
        function openDownloadOptions(views) {
            const waiting = views.filter((view) => view?.state === 'waiting');
            if (waiting.length === 0) return;
            const bundles = waiting.filter(choosable);
            const many = waiting.length > 1;
            const body = [element('p', 'kit-dialog-text', many ? `For the ${countOf(waiting.length, 'download')} selected.` : downloadName(waiting[0]))];

            if (bundles.length === 0) {
                body.push(element('p', 'kit-dialog-detail', many
                    ? 'None of these is a link to several files, so there is nothing more to choose: Where each is saved is chosen beside Save to.'
                    : "A single file has nothing more to choose: Where it's saved is chosen beside Save to."));
                kit.ui.dialog({ title: 'Advanced Options', icon: 'tune', body, actions: [{ label: 'Close', value: false, cancel: true }] });
                return;
            }

            // The files of one bundle: each ticked to download, or not.
            const [first] = bundles;
            const chosen = new Set(first.chosen ?? first.files.map((_, index) => index));
            const filesHelp = element('div', 'form-text reserved');
            filesHelp.id = 'options-download-files-help';
            let apply = null;
            const check = () => {
                filesHelp.textContent = !many && chosen.size === 0 ? 'Choose at least one file to download.' : '';
                if (apply) apply.disabled = !many && chosen.size === 0;
            };
            if (!many) {
                const list = element('div', 'options-files');
                list.setAttribute('role', 'group');
                list.setAttribute('aria-label', 'Files to download');
                list.setAttribute('aria-describedby', filesHelp.id);
                first.files.forEach((file, index) => {
                    const row = element('label', 'options-file options-file-pick');
                    const box = element('input', 'form-check-input m-0');
                    box.type = 'checkbox';
                    box.checked = chosen.has(index);
                    box.addEventListener('change', () => {
                        if (box.checked) chosen.add(index);
                        else chosen.delete(index);
                        check();
                    });
                    row.append(box, element('span', 'options-file-name', file.name), element('span', 'options-file-size', formatBytes(file.size)));
                    list.append(row);
                });
                body.push(element('div', 'form-label mb-0', 'Files to download'), list, filesHelp);
            }
            const zip = kit.ui.switchField({
                id: 'options-zip',
                label: 'Save as one ZIP',
                checked: bundles.every((view) => view.asZip),
                help: {
                    on: 'The files are saved together, as one ZIP file.',
                    off: 'Each file is saved on its own, together in a new folder.',
                },
            });
            body.push(zip.element);

            // Apply closes it once main has the options, so a card never shows the old ones after it's gone.
            const dialog = kit.ui.dialog({
                title: 'Advanced Options',
                icon: 'tune',
                body,
                actions: [{ label: 'Cancel', value: false, cancel: true }, { label: 'Apply', value: true, variant: 'primary', close: false }],
            });
            apply = dialog.action(true);
            apply.addEventListener('click', async () => {
                const asZip = zip.input.checked;
                const files = [...chosen].sort((a, b) => a - b);
                let refused = 0;
                for (const view of bundles) {
                    await api.setTransferOptions(view.id, many ? { asZip } : { files, asZip }).catch(() => { refused++; });
                }
                if (refused > 0) {
                    kit.ui.toast(many ? 'Some of those downloads have started, so their options stay as they were.' : 'That download has started, so its options stay as they were.', { type: 'warning' });
                }
                dialog.close(true);
            });
            check();
        }

        // --- The server ---
        // The app's own version, for display only.
        const appVersion = await kitApi.getVersion();
        // Checks are asked of a server by the transfer window, through main,
        // which keeps what each saved server's found in memory.

        /** Whether an address is plain HTTP, as typed: one without a scheme is HTTPS. */
        const isPlainHttp = (serverUrl) => /^http:\/\//i.test(serverUrl);

        /** Whether uploads go end-to-end encrypted to a server, as a check found it: it has it, and was reached over HTTPS (as main reads it too). */
        const encryptsBy = (check) => Boolean(check?.ok && check.serverInfo?.capabilities?.upload?.e2ee && check.baseUrl?.startsWith('https://'));

        /** Why a check couldn't connect, and what to try. */
        function connectionFailedText(serverUrl, error) {
            if (error?.code === 'REDIRECT_NOT_FOLLOWED') return error.message;
            const text = 'Connection failed. Check the URL, and that the server is running.';
            return isPlainHttp(serverUrl) ? text : `${text} If the server only serves plain HTTP, enter its address starting with http://.`;
        }

        // --- Settings > Servers ---
        // A row for each saved server, in main's order: its name (its own, or
        // its address's host) with Default on the default's, its address under
        // it (many servers keep the name "Dropgate Server"), its status line in
        // its tone, and once checked, its limits. Shown, its settings for new
        // uploads: File lifetime and Max downloads, offering only what its
        // last check said it allows (off until it's checked), saved through
        // main as each becomes a value it allows; its Allow Fallback, saved as
        // it's flipped; and the account's place, which accounts fill in
        // later. Then Test, Set as Default, Move Up, Move Down (the order a
        // fallback tries them in) and Remove (which asks first). A row is built once and
        // drawn again as the list or a check changes, so a field being typed
        // in keeps its focus and what's in it.

        const serverList = $('server-list');
        /** Each saved server's row, by its ID. */
        const rows = new Map();
        /** The rows whose settings for new uploads are shown, by server ID: the default's as the window opens, and one just added. */
        const openRows = new Set();
        /** The saved servers being checked now, by ID: their rows say so, with Test busy. */
        const checking = new Set();

        /** Take main's answer: the list, the default and the checks as they are now; every row, and what uploads go by, follow. */
        function takeList(list) {
            saved = { servers: list.servers, defaultServer: list.defaultServer, checks: list.checks ?? {} };
            for (const [id, check] of Object.entries(saved.checks)) seenChecks.set(id, check);
            renderServers();
            refreshServer();
        }

        /** Check a saved server again, through main, which keeps what it finds in memory: its row says Checking… until then. */
        async function testServer(id) {
            checking.add(id);
            renderServers();
            try {
                const answer = await api.testServer(id);
                checking.delete(id);
                takeList(answer);
                return answer.check;
            } catch {
                // Removed meanwhile: there's nothing to say of it.
                checking.delete(id);
                renderServers();
                return { ok: false };
            }
        }

        /** Every row, in the list's order, with the count above them; a removed server's row goes. */
        function renderServers() {
            $('servers-count').textContent = saved.servers.length > 0 ? countOf(saved.servers.length, 'server') : 'No servers yet';
            for (const [id, row] of rows) {
                if (!saved.servers.some((server) => server.id === id)) {
                    row.element.remove();
                    rows.delete(id);
                    openRows.delete(id);
                }
            }
            saved.servers.forEach((server, index) => {
                if (!rows.has(server.id)) rows.set(server.id, serverRow(server.id));
                rows.get(server.id).paint(server, index);
            });
            // In order, moved only when the order changed: a button just pressed keeps its focus.
            const order = saved.servers.map((server) => rows.get(server.id).element);
            if (order.some((row, index) => serverList.children[index] !== row)) {
                const focused = document.activeElement;
                serverList.replaceChildren(...order);
                if (focused instanceof HTMLElement && serverList.contains(focused)) focused.focus();
            }
        }

        /**
         * What a server's last check found, as its status line's items and
         * tone: "Online", its version, then how uploads go there; or why it
         * can't be used. detail is the reason in full, for its tooltip.
         * @returns {{ items: string[], tone: string, detail?: string }}
         */
        function serverState(server, check) {
            if (!check) return { items: ['Not checked yet'], tone: 'muted' };
            if (!check.ok) return { items: ["Can't connect"], tone: 'danger', detail: connectionFailedText(server.url, check) };
            const info = check.serverInfo;
            if (!info?.version || !info?.capabilities) return { items: ['Not a Dropgate server'], tone: 'danger' };
            const online = ['Online', `Dropgate ${check.serverVersion ?? info.version}`];
            if (!check.dgup?.compatible) return { items: [...online, 'Needs an Update'], tone: 'danger', detail: check.dgup?.message };
            if (info.capabilities.upload?.enabled === false) return { items: [...online, 'Uploads Off'], tone: 'warning', detail: 'File uploads are disabled on this server.' };
            if (!check.baseUrl?.startsWith('https://')) return { items: [...online, 'Plain HTTP', 'Not Encrypted'], tone: 'warning' };
            if (!info.capabilities.upload?.e2ee) return { items: [...online, 'Not Encrypted'], tone: 'warning' };
            return { items: [...online, 'End-to-End Encrypted'], tone: 'success' };
        }

        /** A number of hours as a bullet-separated item: "24 Hours". */
        const hoursTitle = (n) => (Number.isInteger(n) ? countOf(n, 'Hour') : `${n} Hours`);

        /** A server's limits, as bullet-separated items in Title Case: "Keeps Files Up to 24 Hours · Up to 5 Downloads · Up to 500 MB". */
        function limitsTitle(upload) {
            const limits = limitsOf(upload);
            const size = upload.maxSizeMB;
            return [
                limits.hours === 0 ? 'No Time Limit' : `Keeps Files Up to ${hoursTitle(limits.hours)}`,
                limits.downloads === 0 ? 'Any Number of Downloads' : `Up to ${countOf(limits.downloads, 'Download')}`,
                size === 0 ? 'Any Size' : Number.isFinite(size) ? `Up to ${formatBytes(size * 1024 * 1024)}` : null,
            ].filter(Boolean).join(' · ');
        }

        /** What a server allows uploads, from its last check: its capabilities' upload part, or null until a check found one. */
        const uploadsOf = (check) => (check?.ok && check.serverInfo?.version && check.serverInfo?.capabilities?.upload) || null;

        /** A small button of a row's own. */
        function rowButton(label, variant, onClick) {
            const button = element('button', `btn ${variant}`, label);
            button.type = 'button';
            button.addEventListener('click', onClick);
            return button;
        }

        /** A button that's an icon alone, named for screen readers and its tooltip. */
        function iconButton(icon, label, onClick) {
            const button = rowButton(undefined, 'btn-outline-secondary icon-btn', onClick);
            button.append(glyph(icon));
            button.setAttribute('aria-label', label);
            button.title = label;
            return button;
        }

        /** A saved server's row, built once: paint() draws it as the server, its place and its check are now. */
        function serverRow(id) {
            const row = element('div', 'server-row');
            row.setAttribute('role', 'group');
            const icon = glyph('dns', 'kind-icon');
            const name = element('span', 'server-name');
            const pill = element('span', 'pill-default', 'Default');
            // Plain, in the secondary text's colour: it opens the row, and goes nowhere, so it doesn't look like a link.
            const toggle = element('button', 'btn btn-sm border-0 ms-auto p-0 icon-btn text-body-secondary');
            toggle.type = 'button';
            const toggleIcon = glyph('expand_more');
            toggle.append(toggleIcon);
            toggle.addEventListener('click', () => {
                if (openRows.has(id)) openRows.delete(id);
                else openRows.add(id);
                renderServers();
            });
            const head = element('div', 'server-head');
            head.append(icon, name, pill, toggle);
            const address = element('div', 'server-address selectable');
            const status = kit.ui.statusLine({ text: 'Not checked yet', tone: 'muted' });
            const limitsLine = element('div', 'server-limits');

            // Its settings for new uploads: no unit allows more than it does, and Unlimited only where it has no limit.
            const lifetimeValue = element('input', 'form-control');
            lifetimeValue.type = 'number';
            lifetimeValue.id = `server-${id}-lifetime`;
            lifetimeValue.min = '0';
            lifetimeValue.step = 'any';
            const lifetimeUnit = element('select', 'form-select');
            lifetimeUnit.id = `server-${id}-lifetime-unit`;
            lifetimeUnit.setAttribute('aria-label', 'Unit');
            for (const [value, label] of [['minutes', 'Minutes'], ['hours', 'Hours'], ['days', 'Days'], ['unlimited', 'Unlimited']]) {
                const option = element('option', '', label);
                option.value = value;
                lifetimeUnit.append(option);
            }
            const lifetimeGroup = element('div', 'input-group input-group-sm');
            lifetimeGroup.append(lifetimeValue, lifetimeUnit);
            const lifetimeField = formField('File lifetime', lifetimeGroup, `server-${id}-lifetime`);
            const downloads = element('input', 'form-control form-control-sm');
            downloads.type = 'number';
            downloads.id = `server-${id}-downloads`;
            downloads.step = '1';
            const downloadsField = formField('Max downloads', downloads, `server-${id}-downloads`);
            const fields = element('div', 'row g-2');
            const lifetimeColumn = element('div', 'col-sm-7');
            const downloadsColumn = element('div', 'col-sm-5');
            lifetimeColumn.append(lifetimeField.wrap);
            downloadsColumn.append(downloadsField.wrap);
            fields.append(lifetimeColumn, downloadsColumn);

            // Allow Fallback, for new uploads to it: saved through main as it's flipped.
            const fallback = kit.ui.switchField({
                id: `server-${id}-fallback`,
                label: 'Allow Fallback',
                help: {
                    on: "A new upload to this server may move on to the next server below if this one can't take it before it starts. Each upload's Advanced Options can change it.",
                    off: "A new upload to this server goes here only. Each upload's Advanced Options can change it.",
                },
                onChange: async (checked) => takeList(await api.setServerOptions(id, { allowFallback: checked }).catch(() => saved)),
            });

            // The account's place: accounts come later, so only what a server without them says.
            const slot = element('div', 'server-slot');
            slot.append(element('div', 'server-slot-caption', 'Account'), element('div', 'server-slot-text text-body-secondary', "This server doesn't use accounts."));

            const body = element('div', 'server-body');
            body.append(element('div', 'small fw-semibold mt-1', 'New uploads to this server'), fields, fallback.element, slot);

            const test = rowButton('Test', 'btn-outline-secondary', () => testServer(id));
            const makeDefault = rowButton('Set as Default', 'btn-outline-secondary', async () => {
                takeList(await api.setDefaultServer(id).catch(() => saved));
            });
            const up = iconButton('arrow_upward', 'Move Up', async () => takeList(await api.moveServer(id, -1).catch(() => saved)));
            const down = iconButton('arrow_downward', 'Move Down', async () => takeList(await api.moveServer(id, 1).catch(() => saved)));
            const remove = rowButton('Remove', 'btn-outline-danger ms-auto', async () => {
                const server = saved.servers.find((s) => s.id === id);
                if (!server) return;
                const ok = await kit.ui.confirm({
                    title: 'Remove This Server?',
                    body: `${server.name} leaves your list, with its settings for new uploads. Uploads already under way to it carry on.`,
                    confirmLabel: 'Remove',
                    variant: 'danger',
                    icon: 'delete',
                });
                if (ok) takeList(await api.removeServer(id).catch(() => saved));
            });
            const actions = element('div', 'server-actions');
            actions.append(test, makeDefault, up, down, remove);
            row.append(head, address, status.element, limitsLine, body, actions);

            /** Test's busy state, while the server is checked from anywhere: as the window opens, before an upload, or Test itself. */
            let restoreTest = null;
            /** What it allows, as its last check said, for its fields. */
            let limits = null;

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

            /**
             * Each help line says what the server allows, or why a value is
             * outside it; each value it allows is what's saved. Nothing is
             * saved until a check has said what it allows.
             * @returns {{ lifetime?: object, maxDownloads?: number }} the values within its limits
             */
            const checkFields = () => {
                if (!limits) {
                    setHelp(lifetimeField.help, 'Test the server to see its limits.');
                    setHelp(downloadsField.help, '');
                    return {};
                }
                const most = Number(lifetimeUnit.selectedOptions[0]?.dataset.most ?? 0);
                if (lifetimeUnit.value === 'unlimited') lifetimeValue.value = '';
                if (limits.hours !== 0) lifetimeValue.max = String(most);
                else lifetimeValue.removeAttribute('max');
                const within = {};

                const life = readLifetime();
                let lifeWhy = null;
                if (!life) lifeWhy = 'Enter a lifetime of more than 0.';
                else if (lifetimeOutside(life, limits)) {
                    lifeWhy = life.unit === 'unlimited'
                        ? `This server doesn't allow unlimited. It keeps files up to ${hours(limits.hours)}.`
                        : `Too long: This server keeps files up to ${hours(limits.hours)}.`;
                } else within.lifetime = life;
                setHelp(lifetimeField.help, lifeWhy ?? (limits.hours === 0 ? 'No time limit on this server.' : `Up to ${hours(limits.hours)}.`), lifeWhy ? 'danger' : undefined);

                const n = readDownloads();
                let downloadsWhy = null;
                if (n === null) downloadsWhy = limits.downloads === 0 ? 'Enter a whole number: 0 or more.' : `Enter a whole number from 1 to ${limits.downloads}.`;
                else if (downloadsOutside(n, limits)) {
                    downloadsWhy = n === 0
                        ? `This server doesn't allow unlimited downloads. It allows up to ${countOf(limits.downloads, 'download')}.`
                        : `Too many: This server allows up to ${countOf(limits.downloads, 'download')}.`;
                } else within.maxDownloads = n;
                const allows = limits.downloads === 0 ? '0 means unlimited.' : limits.downloads === 1 ? 'This server allows 1 download.' : `Up to ${countOf(limits.downloads, 'download')}.`;
                setHelp(downloadsField.help, downloadsWhy ?? allows, downloadsWhy ? 'danger' : undefined);
                return within;
            };

            /** A field changed: what's now within the server's limits is saved, through main. */
            const changed = async () => {
                lifetimeValue.disabled = lifetimeUnit.value === 'unlimited';
                const within = checkFields();
                const server = saved.servers.find((s) => s.id === id);
                if (!server) return;
                const options = {};
                if (within.lifetime && !sameLifetime(within.lifetime, server.lifetime)) options.lifetime = within.lifetime;
                if (within.maxDownloads !== undefined && within.maxDownloads !== server.maxDownloads) options.maxDownloads = within.maxDownloads;
                if (Object.keys(options).length > 0) takeList(await api.setServerOptions(id, options).catch(() => saved));
            };
            for (const control of [lifetimeValue, downloads]) control.addEventListener('input', changed);
            lifetimeUnit.addEventListener('change', changed);

            /** The fields as the server's settings are, and as far as its limits let them go. One being typed in is left as it is. */
            function paintFields(server, upload) {
                limits = upload ? limitsOf(upload) : null;
                const typing = [lifetimeValue, lifetimeUnit, downloads].includes(document.activeElement);
                if (!typing) {
                    lifetimeUnit.value = server.lifetime.unit;
                    lifetimeValue.value = server.lifetime.unit === 'unlimited' ? '' : String(server.lifetime.value);
                    downloads.value = String(server.maxDownloads);
                }
                for (const option of lifetimeUnit.options) {
                    const most = limits ? { minutes: limits.hours * 60, hours: limits.hours, days: limits.hours / 24, unlimited: 0 }[option.value] : 0;
                    option.dataset.most = String(most);
                    option.disabled = Boolean(limits) && ((option.value === 'unlimited' && limits.hours !== 0) || (option.value === 'days' && limits.hours !== 0 && limits.hours < 24));
                    if (option.value === 'unlimited') option.textContent = limits && limits.hours !== 0 ? 'Unlimited (not allowed by the server)' : 'Unlimited';
                }
                downloads.min = limits?.downloads === 0 ? '0' : '1';
                if (limits && limits.downloads > 0) downloads.max = String(limits.downloads);
                else downloads.removeAttribute('max');
                lifetimeUnit.disabled = !limits;
                lifetimeValue.disabled = !limits || lifetimeUnit.value === 'unlimited';
                // Where the server allows 1, and 1 is saved, it's the only value there is.
                if (!typing) downloads.disabled = !limits || (limits.downloads === 1 && server.maxDownloads === 1);
                checkFields();
            }

            function paint(server, index) {
                const check = saved.checks[server.id] ?? null;
                const busy = checking.has(server.id);
                const isDefault = server.id === defaultSaved()?.id;
                row.setAttribute('aria-label', server.name);
                icon.textContent = isPlainHttp(server.url) ? 'lan' : 'dns';
                name.textContent = server.name;
                name.title = server.name;
                pill.hidden = !isDefault;
                address.textContent = server.url;
                address.title = server.url;
                const state = busy ? { items: ['Checking…'], tone: 'running' } : serverState(server, check);
                status.set({ text: state.items.join(' · '), tone: state.tone, ...(state.detail ? { title: state.detail } : {}) });
                const upload = uploadsOf(check);
                limitsLine.hidden = !upload || busy;
                limitsLine.textContent = upload ? limitsTitle(upload) : '';
                const open = openRows.has(server.id);
                body.hidden = !open;
                toggle.setAttribute('aria-expanded', String(open));
                toggle.setAttribute('aria-label', open ? 'Hide Settings' : 'Show Settings');
                toggle.title = open ? 'Hide Settings' : 'Show Settings';
                toggleIcon.textContent = open ? 'expand_less' : 'expand_more';
                paintFields(server, upload);
                if (fallback.input.checked !== (server.allowFallback === true)) fallback.set(server.allowFallback === true);
                slot.hidden = !upload;
                makeDefault.hidden = isDefault;
                up.disabled = index === 0;
                down.disabled = index === saved.servers.length - 1;
                if (busy && !restoreTest) restoreTest = kit.ui.busy(test, 'Testing…');
                if (!busy && restoreTest) {
                    restoreTest();
                    restoreTest = null;
                }
            }

            return { element: row, paint };
        }

        /**
         * Add Server: an address, checked by the transfer window (Check),
         * showing what it found (its name and version, how uploads go there,
         * its limits) before it's added; Add Server then asks main, which
         * checks it again and saves it, as the default if it's the first.
         * Nothing is saved until then. An invite link isn't taken yet: it
         * comes with accounts. Check leaves the form open (close: false), and
         * Enter in the address presses it, as the kit's form does.
         */
        function openAddServer() {
            const input = element('input', 'form-control selectable');
            input.type = 'text';
            input.id = 'add-server-address';
            input.placeholder = 'https://drop.example.com';
            input.spellcheck = false;
            input.autocomplete = 'off';
            const field = formField('Server address', input, 'add-server-address');
            const usual = "Its address, starting with https://, or http:// for a server with no HTTPS. Invite links aren't supported yet.";
            setHelp(field.help, usual);
            const found = element('div', 'server-found');
            found.hidden = true;
            found.setAttribute('aria-live', 'polite');

            const dialog = kit.ui.dialog({
                title: 'Add Server',
                icon: 'dns',
                body: [field.wrap, found],
                actions: [{ label: 'Cancel', value: false, cancel: true }, { label: 'Check', value: 'check', variant: 'primary', close: false }],
            });
            const go = dialog.action('check');
            let open = true;
            dialog.closed.then(() => {
                open = false;
            });

            /** The address its check found a Dropgate server at, as typed: Add Server adds it. */
            let checked = null;
            const reset = () => {
                checked = null;
                found.hidden = true;
                go.textContent = 'Check';
                setHelp(field.help, usual);
            };
            input.addEventListener('input', reset);

            /** What a check found: its name and version, how uploads go there, its limits, and the address it was found at. */
            function showFound(check) {
                const info = check.serverInfo;
                const state = serverState({ url: check.baseUrl }, check);
                const upload = uploadsOf(check);
                const how = element('div', `small text-${state.tone}-emphasis`, state.items.filter((item) => !item.startsWith('Dropgate ')).join(' · '));
                found.replaceChildren(element('div', 'fw-semibold', `${info.name || hostName(check.baseUrl)} · Dropgate ${check.serverVersion ?? info.version}`), how,
                    ...(upload ? [element('div', 'small text-body-secondary', limitsTitle(upload))] : []),
                    ...(state.detail ? [element('div', 'small', state.detail)] : []),
                    element('div', 'server-address selectable', check.baseUrl));
                found.hidden = false;
            }

            go.addEventListener('click', async () => {
                const value = input.value.trim();
                if (!value) {
                    setHelp(field.help, "Enter the server's address.", 'danger');
                    return;
                }
                if (checked !== value) {
                    // Check: asked of the server, and nothing saved.
                    const restore = kit.ui.busy(go, 'Checking…');
                    const check = await api.checkServer(value).catch(() => null);
                    restore();
                    if (!open || input.value.trim() !== value) return;
                    if (!check) setHelp(field.help, "That isn't a server's address: Enter one such as https://drop.example.com.", 'danger');
                    else if (!check.ok) setHelp(field.help, connectionFailedText(value, check), 'danger');
                    else if (!check.serverInfo?.version || !check.serverInfo?.capabilities) setHelp(field.help, 'That address answered, but not as a Dropgate server.', 'danger');
                    else {
                        showFound(check);
                        checked = value;
                        go.textContent = 'Add Server';
                        setHelp(field.help, '');
                    }
                    return;
                }
                // Add Server: main checks it again, and saves it once it answers as a Dropgate server.
                const before = new Set(saved.servers.map((server) => server.id));
                const restore = kit.ui.busy(go, 'Adding…');
                const answer = await api.addServer(value).catch(() => null);
                restore();
                if (!answer?.server) {
                    if (open) {
                        reset();
                        setHelp(field.help, answer && !answer.check?.ok ? connectionFailedText(value, answer.check) : 'That address no longer answers as a Dropgate server.', 'danger');
                    }
                    if (answer) takeList(answer);
                    return;
                }
                openRows.add(answer.server.id);
                takeList(answer);
                dialog.close(answer.server.id);
                if (before.has(answer.server.id)) kit.ui.toast(`${answer.server.name} is saved already.`, { type: 'info' });
            });
        }

        /** An address's host, as the client reads it (one with no scheme is HTTPS): a server's name until it gives its own. */
        function hostName(address) {
            try {
                return new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(address) ? address : `https://${address}`).host || address;
            } catch {
                return address;
            }
        }

        // --- Initial Settings Load ---
        const settings = await kitApi.getSettings();
        saved = { servers: settings.servers, defaultServer: settings.defaultServer, checks: {} };
        // The default's row opens with its settings for new uploads shown.
        if (defaultSaved()) openRows.add(defaultSaved().id);
        renderServers();
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

        // Settings > Transfers: where new downloads are saved, shown whole
        // (Browse is the system's folder picker, in main; Reset goes back to
        // the system's Downloads), and how many transfers run at once.
        const foldersInput = $('downloads-folder');
        const resetFolderBtn = $('downloads-reset-btn');
        /** Show where new downloads are saved, and on every download waiting on it. */
        function showDefaultFolder(folder) {
            defaultFolder = folder;
            foldersInput.value = folder.path;
            resetFolderBtn.disabled = !folder.chosen;
            refreshFolders();
        }
        showDefaultFolder(await api.getDownloadFolder());
        $('downloads-browse-btn').addEventListener('click', async () => {
            const picked = await api.chooseFolder().catch(() => null);
            if (!picked) return;
            chosenFolders.push(picked);
            showDefaultFolder(await api.setDownloadFolder(picked.folder));
        });
        resetFolderBtn.addEventListener('click', async () => showDefaultFolder(await api.setDownloadFolder(null)));

        atOnce = settings.transfersAtOnce;
        const atOnceSlider = kit.ui.stepSlider({
            id: 'transfers-at-once',
            label: 'Transfers at once',
            min: 1,
            max: 6,
            value: atOnce,
            valueText: (n) => countOf(n, 'transfer'),
            help: (n) => `Up to ${countOf(n, 'transfer')} at once, uploads and downloads together. The rest wait as Queued; a paused one doesn't take a place.`,
            onChange: (n) => {
                atOnce = n;
                kitApi.setSettings({ transfersAtOnce: n });
                // Each queued one says how many run.
                for (const entry of [...shown.values(), ...downloadsShown.values()]) if (entry.view.state === 'queued') draw(entry.view);
            },
        });
        $('at-once-field').append(atOnceSlider.element);

        await checkDefaultServer();

        // --- Event Listeners ---
        addFilesBtn.addEventListener('click', () => fileInput.click());
        // Files picked with Add Files or the drop zone: by their paths, as a drop's are, together one upload.
        fileInput.addEventListener('change', (e) => {
            const picked = Array.from(e.target.files ?? []);
            fileInput.value = '';
            const paths = picked.map((file) => kitApi.getPathForFile(file)).filter(Boolean);
            // Picked from Download's header too: they're an upload, shown on Upload.
            if (paths.length) {
                shell.showView('upload');
                addPaths(paths, null);
            }
        });

        $('add-server-btn').addEventListener('click', () => openAddServer());

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

        // An upload falling back, to a server that would be a step down from
        // the one it was going to: main holds it there and asks, with what
        // that server said and each step down. Yes sends it, with the
        // encryption main found; anything else stops it, with that server's
        // reason.
        api.onAskFallback(async (question) => {
            const { id } = question;
            asking.add(id);
            if (shown.has(id)) draw(shown.get(id).view);
            const go = await askFallback(question);
            asking.delete(id);
            if (go) api.startTransfers([id], question.encrypt).catch(() => api.cancelTransfer(id).catch(() => {}));
            else api.cancelTransfer(id).catch(() => {});
        });

        /** The fallback's question: whether an upload goes to the next server, which would be a step down. */
        function askFallback({ id, from, to, reason, plain, unencrypted, lifetime, downloads, asked }) {
            const view = shown.get(id)?.view;
            const steps = [];
            if (plain) steps.push(`${to.host} is plain HTTP, so the upload won't be end-to-end encrypted, and the server can read your files.`);
            else if (unencrypted) steps.push(`${to.host} doesn't support end-to-end encryption, so the server can read your files.`);
            if (lifetime !== null) steps.push(`It keeps files up to ${hours(lifetime)}, and this upload asks for ${lifetimeText(asked.lifetime)}.`);
            if (downloads !== null) steps.push(`It allows up to ${countOf(downloads, 'download')}, and this upload asks for ${downloadsText(asked.maxDownloads)}.`);
            if (lifetime !== null || downloads !== null) steps.push("It would go with the server's limits instead.");
            return kit.ui.confirm({
                title: `Upload to ${to.host} Instead?`,
                body: `${from.host} couldn't take ${view ? nameOf(view) : 'this upload'}: ${sentence(reason)}`,
                detail: steps.join(' '),
                confirmLabel: 'Upload There',
                variant: 'warning',
                icon: 'warning',
            });
        }

        // A saved server checked by main itself (a fallback trying it): its row, and the uploads going there, say what it found.
        api.onServersChanged((list) => takeList(list));

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
         * Start uploads waiting, each server's together, in the order first
         * met: each server checked first; any whose lifetime or download limit
         * is outside what it allows now stops them, with a warning that can go
         * on with the server's limits instead (or leave them waiting); and the
         * Upload Security Warning is asked once for a server they won't be
         * end-to-end encrypted on. Main runs them in the transfer window, as
         * places free. One stopped before it starts is told to main, and stays
         * waiting.
         */
        async function startUploads(ids) {
            const left = new Set(ids);
            const waiting = () => [...left].map((id) => shown.get(id)?.view).filter((view) => view && startable(view));
            const serverOf = (view) => view.server?.id ?? '';
            while (waiting().length > 0) {
                // The first one's server, as main last said: one moved meanwhile goes with its new server's, next time round.
                const server = serverOf(waiting()[0]);
                const group = waiting().filter((view) => serverOf(view) === server).map((view) => view.id);
                for (const id of group) left.delete(id);
                await startOn(savedById(server), group);
                for (const view of group.map((id) => shown.get(id)?.view)) if (view && startable(view) && serverOf(view) !== server) left.add(view.id);
            }
        }

        /**
         * Start uploads waiting that go to one saved server (null: none saved,
         * so they can't). Those that allow fallback and that it can't take, by
         * its check now (not reached, uploads off, too small for them, or
         * outside its limits), go to main as they are, which moves them down
         * the saved order: no warning about this server is asked for them.
         */
        async function startOn(server, ids) {
            const check = server ? await testServer(server.id) : null;
            const compatible = compatibilityOf(server, check);
            const upload = uploadsOf(check);
            /** Those handed to main to fall back: main's word on them may reach this page a moment later. */
            const handed = new Set();
            // Still waiting, on this server: one picked another meanwhile goes with that one's.
            const current = () => ids.map((id) => shown.get(id)?.view).filter((view) => view && startable(view) && view.server?.id === server?.id && !handed.has(view.id));
            const tooBig = (view) => upload?.maxSizeMB > 0 && view.files.reduce((sum, file) => sum + file.size, 0) > upload.maxSizeMB * 1024 * 1024;
            const falling = server ? current().filter((view) => view.options?.allowFallback && (!compatible.compatible || tooBig(view) || outsideLimits(view.options, upload))) : [];
            for (const view of falling) handed.add(view.id);
            if (falling.length > 0) {
                // The word main holds this server to: they don't go there, whatever it is.
                await api.startTransfers(falling.map((view) => view.id), encryptsBy(check)).catch((error) => api.uploadFinished({ status: 'error', error: error?.message || String(error) }));
            }
            if (!compatible.compatible) {
                if (current().length > 0) api.uploadFinished({ status: 'error', error: compatible.message || 'Server is not compatible.' });
                return;
            }
            const outside = current().filter((view) => outsideLimits(view.options, upload));
            if (outside.length > 0) {
                if (!(await askServerLimits(outside, server, upload))) return;
                try {
                    for (const view of outside) await api.setTransferOptions(view.id, withinLimits(view.options, upload));
                } catch {
                    // One started or went meanwhile: what's left goes on as it is, and the server refuses anything outside its limits.
                }
            }
            const encrypt = encryptsBy(check);
            if (current().length === 0) return;
            if (!encrypt && !(await askUploadAnyway())) {
                api.uploadFinished({ status: 'error', error: 'Upload cancelled by user (insecure connection).' });
                return;
            }
            const waiting = current().map((view) => view.id);
            if (waiting.length === 0) return;
            try {
                await api.startTransfers(waiting, encrypt);
            } catch (error) {
                api.uploadFinished({ status: 'error', error: error?.message || String(error) });
            }
        }

        /** The server's limits on a lifetime (in hours, 0 for none) and on downloads (0 for none), as it last said. */
        function limitsOf(upload) {
            return { hours: upload.maxLifetimeHours, downloads: upload.maxFileDownloads ?? 1 };
        }

        /** Whether a lifetime is longer than the server allows: unlimited, or past its limit. */
        function lifetimeOutside(lifetime, limits) {
            if (limits.hours === 0) return false;
            const ms = lifetime.unit === 'unlimited' ? 0 : lifetimeToMs(lifetime.value, lifetime.unit);
            return ms === 0 || ms > limits.hours * 3_600_000;
        }

        /** Whether a download limit is more than the server allows: unlimited, or past its limit. */
        function downloadsOutside(n, limits) {
            return limits.downloads > 0 && (n === 0 || n > limits.downloads);
        }

        /** Whether an upload's options are outside its server's limits, as it last said them (its capabilities' upload part). */
        function outsideLimits(options, upload) {
            if (!options || !upload) return false;
            const limits = limitsOf(upload);
            return lifetimeOutside(options.lifetime, limits) || downloadsOutside(options.maxDownloads, limits);
        }

        /** An upload's options held to its server's limits: each one outside becomes its limit. */
        function withinLimits(options, upload) {
            const limits = limitsOf(upload);
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
         * The warning before uploads whose options are outside their server's
         * limits as it says them now: true to go on with its limits instead.
         * @param {any[]} views - Those outside them.
         * @param {{ url: string }} server - The saved server they go to.
         * @param {any} upload - What it allows uploads, from its check.
         */
        function askServerLimits(views, server, upload) {
            const [one] = views;
            const asks = views.length === 1
                ? `This upload asks for ${lifetimeText(one.options.lifetime)} and ${downloadsText(one.options.maxDownloads)}.`
                : `${countOf(views.length, 'upload')} here ask for more than that.`;
            return kit.ui.confirm({
                title: "Outside This Server's Limits",
                body: `${hostName(server.url)} ${limitsSentence(upload)}. ${asks}`,
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
         * limit, offering only what its server allows (Apply is off, with the
         * help line saying why, for a value outside); how it will be sent,
         * shown, never switched off; and for one of several files, the files,
         * each with its own Remove. Several going to different servers are
         * held to the tightest of their limits, each help line naming the
         * server that sets it. Each server is checked first unless this run
         * found it already. Its Allow Fallback, from its server's. Apply sets
         * them on main's upload; Cancel leaves it as it was.
         * @param {any[]} entries
         */
        async function openAdvanced(entries) {
            let views = entries.map((entry) => entry?.view).filter(editable);
            if (views.length === 0) return;
            for (const id of new Set(views.map((view) => view.server?.id ?? ''))) {
                const server = savedById(id);
                if (server && !checkOf(id)?.ok) await testServer(id);
                const compatible = compatibilityOf(server, checkOf(id));
                if (!compatible.compatible) {
                    kit.ui.toast(compatible.message || 'Could not connect to the server.', { type: 'warning' });
                    return;
                }
            }
            // As they are now: one may have moved on while its server was checked.
            views = views.map((view) => shown.get(view.id)?.view).filter(editable);
            if (views.length === 0) return;
            const servers = [...new Map(views.map((view) => [view.server.id, savedById(view.server.id)])).values()];
            const allowing = servers.map((server) => ({ server, host: hostName(server.url), limits: limitsOf(uploadsOf(checkOf(server.id))) }));
            /** The server whose limit on this is tightest (0 is none). */
            const tightest = (of) => allowing.reduce((best, one) => ((one.limits[of] !== 0 && (best.limits[of] === 0 || one.limits[of] < best.limits[of])) ? one : best));
            const [first] = views;
            const many = views.length > 1;
            const lifetimeBy = tightest('hours');
            const downloadsBy = tightest('downloads');
            const limits = { hours: lifetimeBy.limits.hours, downloads: downloadsBy.limits.downloads };

            const body = [element('p', 'kit-dialog-text', many ? `For the ${countOf(views.length, 'upload')} selected.` : nameOf(first))];

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
                body.push(element('div', 'form-label mb-0', 'Files'), fileList);
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

            // How it will be sent: shown, and never switched off here. Going to several servers, the first that won't encrypt is named.
            const encryption = element('div', 'options-encryption');
            const plainOn = allowing.find(({ server }) => !encryptsBy(checkOf(server.id)));
            const encrypts = !plainOn;
            const who = servers.length > 1 ? 'Their servers' : allowing[0].host;
            encryption.append(glyph(encrypts ? 'verified' : 'gpp_bad', encrypts ? 'text-success-emphasis' : 'text-danger-emphasis'), element('span', '', encrypts
                ? `End-to-end encrypted. ${who} can't read your files or their names.`
                : isPlainHttp(checkOf(plainOn.server.id)?.baseUrl ?? plainOn.server.url)
                    ? `Not encrypted: ${plainOn.host} is plain HTTP, so the server can read your files.`
                    : `Not encrypted: ${plainOn.host} doesn't support end-to-end encryption, so the server can read your files.`));
            // Allow Fallback, for these: its server's to start with. Several start on if every one has it.
            const fallback = kit.ui.switchField({
                id: 'options-fallback',
                label: 'Allow Fallback',
                checked: views.every((view) => view.options.allowFallback === true),
                help: servers.length > 1 || many ? {
                    on: "If an upload's server can't take it before it starts, the next server in Settings › Servers is tried. A less private one, or one with smaller limits, is never tried without asking. Each server tried learns your IP address and the upload's size.",
                    off: "Each upload goes to its own server only. If that server can't take it, the upload stops and says why.",
                } : {
                    on: `If ${allowing[0].host} can't take this upload before it starts, the next server in Settings › Servers is tried. A less private one, or one with smaller limits, is never tried without asking. Each server tried learns your IP address and the upload's size.`,
                    off: `This upload goes to ${allowing[0].host} only. If it can't take it, the upload stops and says why.`,
                },
            });
            body.push(lifetimeField.wrap, downloadsField.wrap, encryption, fallback.element);

            const dialog = kit.ui.dialog({
                title: 'Advanced Options',
                icon: 'tune',
                body,
                actions: [{ label: 'Cancel', value: false, cancel: true }, { label: 'Apply', value: true, variant: 'primary' }],
            });
            const apply = dialog.action(true);

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

                const host = lifetimeBy.host;
                const allows = limits.hours === 0 ? (servers.length > 1 ? 'Their servers have no time limit.' : `${host} has no time limit.`) : `${host} keeps files up to ${hours(limits.hours)}.`;
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
                const by = downloadsBy.host;
                let downloadsWhy = null;
                if (n === null) downloadsWhy = limits.downloads === 0 ? 'Enter a whole number: 0 or more.' : `Enter a whole number from 1 to ${limits.downloads}.`;
                else if (downloadsOutside(n, limits)) {
                    downloadsWhy = n === 0
                        ? `${by} doesn't allow unlimited downloads. It allows up to ${countOf(limits.downloads, 'download')}.`
                        : `Too many for ${by}, which allows up to ${countOf(limits.downloads, 'download')}.`;
                }
                const downloadsAllow = limits.downloads === 0 ? '0 means unlimited downloads.'
                    : limits.downloads === 1 ? `${by} allows 1 download.` : `${by} allows up to ${countOf(limits.downloads, 'download')}.`;
                setHelp(downloadsField.help, downloadsWhy ?? downloadsAllow, downloadsWhy ? 'danger' : undefined);
                apply.disabled = Boolean(lifeWhy || downloadsWhy);
            };
            for (const control of [lifetimeValue, downloads]) control.addEventListener('input', check);
            lifetimeUnit.addEventListener('change', check);
            check();

            // Apply closes it (the kit's own listener, first), and the options go to main as it fades.
            apply.addEventListener('click', async () => {
                const options = { lifetime: readLifetime(), maxDownloads: readDownloads(), allowFallback: fallback.input.checked };
                if (!many && kept.length !== first.files.length) options.files = kept.map((file) => file.index);
                const refused = [];
                for (const view of views) {
                    await api.setTransferOptions(view.id, options).catch(() => refused.push(view));
                }
                if (refused.length > 0) {
                    kit.ui.toast(refused.length === 1 ? 'That upload has already started, so its options stay as they were.'
                        : `${countOf(refused.length, 'upload')} had already started, so their options stay as they were.`, { type: 'warning' });
                }
            });
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
         * The saved servers on the bulk bar's "Upload all to" (what it says
         * kept, or the default) and every upload's "To", and each upload
         * drawn again by its server's last check.
         */
        function refreshServer() {
            fillServers(bulkTarget, bulkTarget.value || null);
            for (const entry of shown.values()) draw(entry.view);
            drawBars();
        }

        /**
         * Check the default server, through main (its row says so while it's
         * checked), as the window opens: no other is asked anything until
         * it's used. With none saved, nothing is asked of any server.
         */
        async function checkDefaultServer() {
            const server = defaultSaved();
            if (server) await testServer(server.id);
            else refreshServer();
        }

        /** Whether uploads can start on the default server, from its last check, or why not. */
        function defaultCompatibility() {
            return compatibilityOf(defaultSaved(), checkOf(defaultSaved()?.id));
        }

        /** Whether uploads can start on a server, from its last check, or why not. */
        function compatibilityOf(server, check) {
            if (!server) return { compatible: false, message: 'No server URL. Add one in Settings, under Servers.' };
            if (!check) return { compatible: false, message: '' };
            if (!check.ok) return { compatible: false, message: 'Could not connect to the server.' };
            const { serverInfo } = check;
            if (!serverInfo?.version || !serverInfo?.capabilities) return { compatible: false, message: "Cannot determine the server's version or capabilities." };
            if (serverInfo.capabilities.upload?.enabled === false) return { compatible: false, message: 'File uploads are disabled on this server.' };
            // Uploads need the server's hosted transfer protocol to work with this app's.
            if (!check.dgup?.compatible) return { compatible: false, message: check.dgup?.message ?? 'Server is not compatible.' };
            return { compatible: true, message: `Server: v${check.serverVersion}${serverInfo.name ? ` (${serverInfo.name})` : ''}, Client: v${appVersion}.` };
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
