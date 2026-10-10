'use strict';

// What a notification says when transfers end (17 §4): transfers ending
// within a few seconds of each other are told of in one, with counts and
// Title Case titles, never a file's name. One on its own is told of as
// before: "Upload Successful", or "Upload Failed" with core's reason, which
// names no file. A cancelled one is told of by no one: whoever cancelled it
// knows. Kept apart from Electron, so the client's tests can read every text.

/** A kind's word, in Title Case, one or several. */
const NOUN = Object.freeze({ upload: ['Upload', 'Uploads'] });

/**
 * The one notification for transfers that ended together, or null for none.
 * @param {{ kind: 'upload', status: 'success' | 'error' | 'cancelled', error?: string }[]} ends
 * @returns {{ title: string, body: string } | null}
 */
function endNotice(ends) {
    const told = ends.filter(({ status }) => status !== 'cancelled');
    if (told.length === 0) return null;
    const kind = told[0].kind;
    const [one, several] = NOUN[kind];
    const failed = told.filter(({ status }) => status === 'error').length;
    const succeeded = told.length - failed;

    if (told.length === 1) {
        return succeeded === 1
            ? { title: `${one} Successful`, body: 'Link copied to clipboard.' }
            : { title: `${one} Failed`, body: told[0].error || 'An unknown error occurred.' };
    }
    if (succeeded === 0) return { title: `${told.length} ${several} Failed`, body: `None of them finished, so there's no link.` };
    const latest = 'The latest link is copied to the clipboard.';
    if (failed === 0) return { title: `${told.length} ${several} Finished`, body: latest };
    return { title: `${told.length} ${several} Finished`, body: `${succeeded} succeeded, ${failed} failed. ${latest}` };
}

/**
 * The tray's line for what's going: counts in Title Case between bullets,
 * such as "2 Uploading • 1 Paused • 1 Queued", or "Nothing Running".
 * @param {{ running: number, paused: number, queued: number }} counts
 */
function countsLine({ running, paused, queued }) {
    const parts = [];
    if (running) parts.push(`${running} Uploading`);
    if (paused) parts.push(`${paused} Paused`);
    if (queued) parts.push(`${queued} Queued`);
    return parts.length ? parts.join(' • ') : 'Nothing Running';
}

module.exports = { endNotice, countsLine };
