'use strict';

const { countOf } = require('@diamonddigitaldev/electron-kit/format');
const { LIFETIME_UNIT_MS } = require('./payloads');

/**
 * Share with Dropgate's upload: to the server in Settings, with Settings'
 * lifetime and download limit, held to what the server allows as Upload holds
 * them, end-to-end encrypted when the server can be over HTTPS. Main makes it
 * from the server's check, with no window: the same rules as the page's own
 * checks (renderer.js' checkServerCompatibility(), applyServerLimits() and
 * validateLifetimeInput()), and the same messages when it can't go.
 *
 * A lifetime of Unlimited on a server with a limit becomes the limit, up to
 * 24 hours; a download limit above the server's, or Unlimited where it isn't
 * allowed, becomes the server's; a lifetime longer than the server's limit
 * stops the share, as it stops an upload from Upload. Nothing is saved.
 *
 * @param {{ lifetimeValue: number, lifetimeUnit: string, maxDownloads: number }} settings
 * @param {{ ok: boolean, baseUrl?: string, serverInfo?: any, dgup?: { compatible: boolean, message: string } }} check - The server's check, from the transfer window.
 * @returns {{ ok: true, options: { lifetime: { value: number, unit: string }, maxDownloads: number, encrypt: boolean } } | { ok: false, message: string }}
 */
function shareUpload(settings, check) {
    const stop = (message) => ({ ok: false, message });
    if (!check?.ok) return stop('Could not connect to the server.');
    const { serverInfo } = check;
    if (!serverInfo?.version || !serverInfo?.capabilities) return stop('Cannot determine the server\'s version or capabilities.');
    const upload = serverInfo.capabilities.upload;
    if (upload && upload.enabled === false) return stop('File uploads are disabled on this server.');
    if (!check.dgup?.compatible) return stop(check.dgup?.message || 'Server is not compatible.');

    let unit = Object.hasOwn(LIFETIME_UNIT_MS, settings.lifetimeUnit) ? settings.lifetimeUnit : 'hours';
    let value = unit === 'unlimited' ? 0 : settings.lifetimeValue;
    let maxDownloads = Number.isSafeInteger(settings.maxDownloads) && settings.maxDownloads >= 0 ? settings.maxDownloads : 1;

    if (upload) {
        const limitHours = upload.maxLifetimeHours;
        if (limitHours > 0 && unit === 'unlimited') {
            unit = 'hours';
            value = Math.min(24, limitHours);
        }
        if (unit !== 'unlimited' && !(Number.isFinite(value) && value > 0)) value = 0.5;
        if (limitHours > 0 && value * LIFETIME_UNIT_MS[unit] > limitHours * LIFETIME_UNIT_MS.hours) {
            const hours = Number.isInteger(limitHours) ? countOf(limitHours, 'hour') : `${limitHours} hours`;
            return stop(`File lifetime too long. Server limit: ${hours}.`);
        }

        const limit = upload.maxFileDownloads ?? 1;
        if (limit === 1) maxDownloads = 1;
        else if (limit > 1 && (maxDownloads === 0 || maxDownloads > limit)) maxDownloads = limit;
    } else if (unit !== 'unlimited' && !(Number.isFinite(value) && value > 0)) {
        value = 0.5;
    }

    const encrypt = Boolean(upload?.e2ee) && typeof check.baseUrl === 'string' && check.baseUrl.startsWith('https://');
    return { ok: true, options: { lifetime: { value, unit }, maxDownloads, encrypt } };
}

module.exports = { shareUpload };
