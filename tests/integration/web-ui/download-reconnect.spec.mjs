// A download page whose connection drops part-way: the page carries on by
// itself, asking for the rest under the same lease, and the file is saved
// byte for byte, counted as one download. Nobody presses anything. The drop
// is made in the page, where fetch()'s body errors part-way, as it does when a
// connection goes; a complete answer with too few bytes is a different thing,
// which core refuses.
import { madeUpFile, summary } from '../helpers/files.mjs';
import { expect, test } from '../helpers/test.mjs';
import { download, openLink, uploadFromHomePage } from '../helpers/webui.mjs';

// Just over two 5 MiB chunks.
const SIZE = 11_000_000;

/** The server's requests as `METHOD /path`, with their headers. */
const requests = (server) => server.requests().map((r) => ({ ...r, route: `${r.method} ${new URL(r.url, server.baseUrl).pathname}` }));

for (const encrypted of [false, true]) {
    test.describe(encrypted ? 'end-to-end encrypted' : 'unencrypted', () => {
        if (!encrypted) test.use({ serverEnv: { UPLOAD_ENABLE_E2EE: 'false' } });

        test('a download whose connection drops part-way carries on by itself, and saves the file byte for byte', async ({ page, server }) => {
            const file = madeUpFile(`Reconnected ${encrypted ? 'sealed' : 'plain'} é.bin`, SIZE, encrypted ? 51 : 52);
            const link = await uploadFromHomePage(page, [file], { encrypted });

            // The first answer for the bytes breaks off a little over halfway, as a dropped
            // connection does: its body errors, as fetch()'s does when the connection goes.
            await page.addInitScript(() => {
                const realFetch = window.fetch;
                let cut = false;
                window.fetch = async (input, init) => {
                    const res = await realFetch(input, init);
                    const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
                    if (cut || !new URL(url, location.href).pathname.endsWith('/content') || !res.body) return res;
                    cut = true;
                    let left = Math.floor(Number(res.headers.get('content-length')) * 0.6);
                    window.cutAfterBytes = left;
                    const reader = res.body.getReader();
                    const body = new ReadableStream({
                        async pull(controller) {
                            if (left <= 0) {
                                void reader.cancel();
                                controller.error(new TypeError('network error'));
                                return;
                            }
                            const { done, value } = await reader.read();
                            if (done) {
                                controller.close();
                                return;
                            }
                            const part = value.subarray(0, left);
                            left -= part.byteLength;
                            controller.enqueue(part);
                        },
                    });
                    return new Response(body, { status: res.status, statusText: res.statusText, headers: res.headers });
                };
            });

            await openLink(page, link);
            await expect(page.locator('#file-name')).toHaveText(file.name);
            const got = await download(page, page.locator('#download-button'));
            await expect(page.locator('#status-title')).toHaveText(/download complete/i);
            expect(got.name).toBe(file.name);
            expect(summary(got.bytes)).toEqual(summary(file.buffer));

            // The rest came under the same lease, by Range, and the upload counted one download.
            const cut = { sent: await page.evaluate(() => window.cutAfterBytes) };
            expect(cut.sent, 'bytes before the cut').toBeGreaterThan(0);
            const contents = requests(server).filter((r) => r.route.endsWith('/content'));
            expect(contents.length, 'requests for the bytes').toBe(2);
            expect(contents[0].headers['dropgate-lease']).toBeTruthy();
            expect(contents[1].headers['dropgate-lease'], 'the same lease').toBe(contents[0].headers['dropgate-lease']);
            expect(contents[0].headers.range, 'the first asks for everything').toBeUndefined();
            expect(contents[1].headers.range, 'the second asks for the rest').toMatch(/^bytes=\d+-/);
            expect(Number(contents[1].headers.range.match(/^bytes=(\d+)-/)[1]), 'from no later than where it stopped').toBeLessThanOrEqual(cut.sent);
            expect(requests(server).filter((r) => r.route.endsWith('/leases') && r.method === 'POST'), 'leases taken').toHaveLength(1);
        });
    });
}
