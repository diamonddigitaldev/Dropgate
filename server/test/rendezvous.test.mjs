// The rendezvous for direct transfers (rendezvous.js), on the wire: each
// message and rule, with raw WebSocket clients against the real server.
import assert from 'node:assert/strict';
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { once } from 'node:events';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';
import { startServer, waitFor } from './helpers/harness.mjs';
import {
    BY, CODE_LETTERS, CPACE_MESSAGE1_BYTES, ERROR, MAX_FRAMES_EACH_WAY, MAX_FRAME_BYTES, PING_INTERVAL_MS, QUARANTINE_MS, RELEASE_MS, TYPE,
    VERSION, askCode, connect, errorMessage, expectError, joinByCode, joinRoom, msg, openRoom, upgradeRefused,
} from './helpers/rendezvous.mjs';

const hex = (b) => Buffer.from(b).toString('hex');
/** Nothing open, no unused code and no address counted. Locators may still be waiting out their quarantine. */
const NOTHING_HELD = { sockets: 0, rooms: 0, attempts: 0, codes: 0, counted: 0 };
/** Codes off: the rules for rooms, frames and attempts, with nothing from codes in the way. */
const CODES_OFF = { RATE_LIMIT_MAX_REQUESTS: '0', P2P_MAX_CODES_PER_IP: '0' };

/** What the rendezvous holds, of these counts only. */
const heldOf = async (server, keys) => {
    const held = await server.rendezvousHeld();
    return Object.fromEntries(keys.map((key) => [key, held[key]]));
};

/** Waits until the rendezvous holds exactly this, of the counts it names. */
const heldBecomes = (server, expected) => waitFor(async () => {
    return JSON.stringify(await heldOf(server, Object.keys(expected))) === JSON.stringify(expected);
}, { what: `the rendezvous to hold ${JSON.stringify(expected)}` });

/** Sends a socket something and checks it's still open and answering: CODE on a sender's socket, with codes off. */
const stillOpen = async (sender) => {
    sender.send(msg.code());
    assert.equal(hex(await sender.next()), hex([TYPE.CODE_IS, 0]));
};

describe('the rendezvous', () => {
    let server;

    before(async () => {
        server = await startServer({ held: true, env: CODES_OFF });
    });

    after(() => server?.stop());

    describe('a room by link', () => {
        test('with codes off, CREATE is answered CREATED with no locator, a code asked for or not', async () => {
            for (const code of [false, true]) {
                const sender = await connect(server);
                sender.send(msg.create({ roomId: randomBytes(16), code }));
                assert.equal(hex(await sender.next()), '8100', `code ${code}`);
                sender.close();
            }
        });

        test("JOIN by the room's ID gives the receiver the room's nonce, and the sender an ATTEMPT by link with its tag", async () => {
            const room = await openRoom(server);
            const receiver = await connect(server);
            receiver.send(msg.joinByLink(room.roomId));
            assert.equal(hex(await receiver.next()), hex(Buffer.concat([Buffer.from([TYPE.JOINED]), room.roomNonce])));
            assert.equal(hex(await room.sender.next()), hex([TYPE.ATTEMPT, 1, BY.LINK]));
            room.sender.close();
        });

        test('a CREATE with a credential in the right shape opens its room; nothing asks for one yet', async () => {
            const sender = await connect(server);
            sender.send(msg.create({ roomId: randomBytes(16), credential: 'zq7Credential.token-_~+/=' }));
            assert.equal(hex(await sender.next()), '8100');
            sender.close();
            const longest = await connect(server);
            longest.send(msg.create({ roomId: randomBytes(16), credential: 'a'.repeat(8192) }));
            assert.equal(hex(await longest.next()), '8100', 'one of 8,192 bytes');
            longest.close();
        });

        test("the minor is passed over: any minor of the server's major works, either way", async () => {
            const roomId = randomBytes(16);
            const sender = await connect(server);
            sender.send(msg.create({ roomId, minor: 9 }));
            assert.equal(hex(await sender.next()), '8100');
            const receiver = await connect(server);
            receiver.send(msg.joinByLink(roomId, { minor: 255 }));
            assert.equal((await receiver.next())[0], TYPE.JOINED);
            sender.close();
        });

        test("with codes off, CODE is answered CODE_IS with no locator, RENEW is answered nothing, and the room carries on by link", async () => {
            const room = await openRoom(server);
            room.sender.send(msg.renew());
            await stillOpen(room.sender);
            assert.deepEqual(room.sender.pending(), []);
            const { receiver } = await joinRoom(server, room);
            room.sender.close();
            await receiver.closed;
        });
    });

    describe('frames', () => {
        test('pass whole, byte for byte and in order, each way: empty, one byte, the largest, and every byte value', async () => {
            const room = await openRoom(server);
            const { receiver, tag } = await joinRoom(server, room);
            const frames = [
                Buffer.alloc(0), Buffer.from([0]), Buffer.from([0xff]), randomBytes(MAX_FRAME_BYTES),
                Buffer.from(Array.from({ length: 256 }, (_, i) => i)), Buffer.alloc(0), randomBytes(1234),
                // Anything that looks like a message passes as it is: the server never reads a frame.
                errorMessage(ERROR.BUSY), msg.drop(tag), msg.create({ roomId: room.roomId }),
            ];
            for (const frame of frames) receiver.send(msg.receiverSend(frame));
            for (const frame of frames) room.sender.send(msg.send(tag, frame));
            for (const frame of frames) {
                assert.equal(hex(await room.sender.next()), hex(Buffer.concat([Buffer.from([TYPE.FRAME_TO_SENDER, tag]), frame])));
                assert.equal(hex(await receiver.next()), hex(Buffer.concat([Buffer.from([TYPE.FRAME_TO_RECEIVER]), frame])));
            }
            room.sender.close();
        });

        test("go only to their own attempt, by tag, when a room has several", async () => {
            const room = await openRoom(server);
            const a = await joinRoom(server, room);
            const b = await joinRoom(server, room);
            assert.notEqual(a.tag, b.tag);
            room.sender.send(msg.send(b.tag, Buffer.from('to b')));
            room.sender.send(msg.send(a.tag, Buffer.from('to a')));
            assert.equal((await a.receiver.next()).subarray(1).toString(), 'to a');
            assert.equal((await b.receiver.next()).subarray(1).toString(), 'to b');
            b.receiver.send(msg.receiverSend(Buffer.from('from b')));
            assert.equal(hex(await room.sender.next()), hex(Buffer.concat([Buffer.from([TYPE.FRAME_TO_SENDER, b.tag]), Buffer.from('from b')])));
            assert.deepEqual(a.receiver.pending(), []);
            room.sender.close();
        });

        test('a frame to a tag with no attempt goes nowhere, and the room carries on', async () => {
            const room = await openRoom(server);
            room.sender.send(msg.send(7, Buffer.from('nobody')));
            room.sender.send(msg.send(0, Buffer.alloc(0)));
            await stillOpen(room.sender);
            room.sender.close();
        });

        test(`at most ${MAX_FRAMES_EACH_WAY} pass each way in an attempt: the next ends it with LIMIT, and the sender is told GONE`, async () => {
            for (const way of ['to the sender', 'to the receiver']) {
                const room = await openRoom(server);
                const { receiver, tag } = await joinRoom(server, room);
                const [from, to, frame] = way === 'to the sender'
                    ? [receiver, room.sender, () => msg.receiverSend(Buffer.from([1]))]
                    : [room.sender, receiver, () => msg.send(tag, Buffer.from([1]))];
                for (let i = 0; i < MAX_FRAMES_EACH_WAY; i++) from.send(frame());
                for (let i = 0; i < MAX_FRAMES_EACH_WAY; i++) assert.equal((await to.next()).at(-1), 1, `${way}: frame ${i + 1}`);
                from.send(frame());
                const ended = await expectError(receiver, ERROR.LIMIT);
                assert.deepEqual({ message: ended.message, closeCode: ended.closeCode }, ended.expected, way);
                assert.equal(hex(await room.sender.next()), hex([TYPE.GONE_TO_SENDER, tag]), way);
                assert.deepEqual(to === room.sender ? room.sender.pending() : [], [], `${way}: nothing past the limit`);
                // The room's other attempts, and new ones, carry on.
                const next = await joinRoom(server, room);
                room.sender.send(msg.send(next.tag, Buffer.from('after')));
                assert.equal((await next.receiver.next()).subarray(1).toString(), 'after');
                room.sender.close();
            }
        });
    });

    describe('attempts', () => {
        test('a room takes 4 attempts by link at once; a fifth is BUSY, and once one ends another can join', async () => {
            const room = await openRoom(server);
            const attempts = [];
            for (let i = 0; i < 4; i++) attempts.push(await joinRoom(server, room));
            assert.deepEqual(attempts.map((a) => a.tag), [1, 2, 3, 4]);
            const fifth = await connect(server);
            fifth.send(msg.joinByLink(room.roomId));
            const busy = await expectError(fifth, ERROR.BUSY);
            assert.deepEqual({ message: busy.message, closeCode: busy.closeCode }, busy.expected);
            attempts[0].receiver.close();
            assert.equal(hex(await room.sender.next()), hex([TYPE.GONE_TO_SENDER, 1]));
            const again = await joinRoom(server, room);
            // Not tag 1 straight back, which the sender may still have been sending to.
            assert.equal(again.tag, 5);
            room.sender.close();
        });

        test('tags go round from 255 back to 1, skipping those still in use', async () => {
            const room = await openRoom(server);
            const kept = await joinRoom(server, room);
            assert.equal(kept.tag, 1);
            const tags = [];
            for (let i = 0; i < 256; i++) {
                const { receiver, tag } = await joinRoom(server, room);
                tags.push(tag);
                receiver.close();
                assert.equal(hex(await room.sender.next()), hex([TYPE.GONE_TO_SENDER, tag]));
            }
            assert.deepEqual(tags.slice(0, 3), [2, 3, 4]);
            assert.deepEqual(tags.slice(252, 256), [254, 255, 2, 3], 'past 255, round to the first free');
            room.sender.close();
        });

        test("a receiver's socket closing ends its attempt: the sender is told GONE with its tag", async () => {
            const room = await openRoom(server);
            const { receiver, tag } = await joinRoom(server, room);
            receiver.close();
            assert.equal(hex(await room.sender.next()), hex([TYPE.GONE_TO_SENDER, tag]));
            room.sender.close();
        });

        test('DROP ends that attempt: its receiver is told GONE and closed, the sender told nothing, the rest carry on', async () => {
            const room = await openRoom(server);
            const dropped = await joinRoom(server, room);
            const other = await joinRoom(server, room);
            room.sender.send(msg.drop(dropped.tag));
            assert.equal(hex(await dropped.receiver.next()), hex([TYPE.GONE_TO_RECEIVER]));
            assert.equal((await dropped.receiver.closed).code, 1000);
            room.sender.send(msg.send(dropped.tag, Buffer.from('gone')));
            room.sender.send(msg.drop(dropped.tag));
            room.sender.send(msg.send(other.tag, Buffer.from('still here')));
            assert.equal((await other.receiver.next()).subarray(1).toString(), 'still here');
            await stillOpen(room.sender);
            assert.deepEqual(room.sender.pending(), [], 'no GONE for an attempt the sender dropped');
            room.sender.close();
        });

        test('after LOCK, no new attempt joins (BUSY), and the attempts under way carry on both ways', async () => {
            const room = await openRoom(server);
            const { receiver, tag } = await joinRoom(server, room);
            room.sender.send(msg.lock());
            room.sender.send(msg.lock());
            await stillOpen(room.sender);
            const late = await connect(server);
            late.send(msg.joinByLink(room.roomId));
            const busy = await expectError(late, ERROR.BUSY);
            assert.deepEqual({ message: busy.message, closeCode: busy.closeCode }, busy.expected);
            room.sender.send(msg.send(tag, Buffer.from('on')));
            assert.equal((await receiver.next()).subarray(1).toString(), 'on');
            receiver.send(msg.receiverSend(Buffer.from('on too')));
            assert.equal((await room.sender.next()).subarray(2).toString(), 'on too');
            room.sender.close();
        });

        test("a room lives while its sender's socket is open: when it closes, every attempt is told GONE and closed, and the room is gone", async () => {
            const room = await openRoom(server);
            const receivers = [await joinRoom(server, room), await joinRoom(server, room), await joinRoom(server, room)];
            room.sender.close();
            for (const { receiver } of receivers) {
                assert.equal(hex(await receiver.next()), hex([TYPE.GONE_TO_RECEIVER]));
                assert.equal((await receiver.closed).code, 1000);
            }
            const late = await connect(server);
            late.send(msg.joinByLink(room.roomId));
            const notFound = await expectError(late, ERROR.NOT_FOUND);
            assert.deepEqual({ message: notFound.message, closeCode: notFound.closeCode }, notFound.expected);
        });
    });

    describe('errors', () => {
        const expectRefusal = async (messages, code, what) => {
            const client = await connect(server);
            for (const m of [messages].flat()) client.send(m);
            const got = await expectError(client, code);
            assert.deepEqual({ message: got.message, closeCode: got.closeCode }, got.expected, what);
        };

        test("a major other than the server's is VERSION_UNSUPPORTED with the server's version, on CREATE and on JOIN, before anything else is read", async () => {
            for (const major of [0, 3, 5, 255]) {
                await expectRefusal(msg.create({ roomId: randomBytes(16), major }), ERROR.VERSION_UNSUPPORTED, `CREATE major ${major}`);
                await expectRefusal(msg.joinByLink(randomBytes(16), { major }), ERROR.VERSION_UNSUPPORTED, `JOIN major ${major}`);
                // Only the type and the major, as a later major's message might be laid out differently.
                await expectRefusal(Buffer.from([TYPE.CREATE, major]), ERROR.VERSION_UNSUPPORTED, `a bare CREATE major ${major}`);
                await expectRefusal(Buffer.from([TYPE.JOIN, major, 0, 9, 9]), ERROR.VERSION_UNSUPPORTED, `a bare JOIN major ${major}`);
            }
            assert.equal(hex(errorMessage(ERROR.VERSION_UNSUPPORTED)), `ff01${'04'}${'00'}`, `the server's DGDTP is ${VERSION.major}.${VERSION.minor}`);
        });

        test('NOT_FOUND: no room has that ID; and with codes off, a well-formed locator finds none', async () => {
            await expectRefusal(msg.joinByLink(randomBytes(16)), ERROR.NOT_FOUND, 'an unknown room ID');
            const room = await openRoom(server, { code: true });
            for (const locator of ['AB', 'ZZ', 'HJK']) await expectRefusal(msg.joinByCode(locator), ERROR.NOT_FOUND, `locator ${locator}`);
            room.sender.close();
        });

        test("BUSY: a second CREATE with a live room's ID, from another socket", async () => {
            const room = await openRoom(server);
            await expectRefusal(msg.create({ roomId: room.roomId }), ERROR.BUSY, 'the same room ID');
            await stillOpen(room.sender);
            room.sender.close();
        });

        test('MALFORMED, and the socket closed 1002: a first message that is neither CREATE nor JOIN, or a CREATE or JOIN not laid out right', async () => {
            const roomId = randomBytes(16);
            const create = msg.create({ roomId });
            const cases = {
                'an empty message': Buffer.alloc(0),
                'SEND first': msg.send(1, Buffer.from('x')),
                "a receiver's SEND first": msg.receiverSend(Buffer.from('x')),
                'DROP first': msg.drop(1),
                'LOCK first': msg.lock(),
                'CODE first': msg.code(),
                'an unknown type': Buffer.from([0x77, 4, 0]),
                'a server message': Buffer.from([TYPE.CREATED, 0]),
                'CREATE with its type alone': Buffer.from([TYPE.CREATE]),
                'CREATE cut short': create.subarray(0, create.length - 1),
                'CREATE one byte long': Buffer.concat([create, Buffer.from([0])]),
                'CREATE with a flag but the code\'s': msg.create({ roomId, code: false }).fill(2, 35, 36),
                'CREATE with its top flag set': msg.create({ roomId }).fill(0x80, 35, 36),
                'CREATE whose credential is longer than its length says': Buffer.concat([msg.create({ roomId, credential: 'abc' }), Buffer.from('d')]),
                'CREATE whose credential is shorter than its length says': msg.create({ roomId, credential: 'abcd' }).subarray(0, -1),
                'CREATE with a credential that is not token68': msg.create({ roomId, credential: 'not a token' }),
                'CREATE with a credential of padding alone': msg.create({ roomId, credential: '==' }),
                'CREATE with a credential over 8,192 bytes': msg.create({ roomId, credential: 'a'.repeat(8193) }),
                'JOIN with its type alone': Buffer.from([TYPE.JOIN]),
                'JOIN with no way to join': Buffer.from([TYPE.JOIN, 4, 0]),
                'JOIN by something else': Buffer.concat([Buffer.from([TYPE.JOIN, 4, 0, 3]), roomId]),
                'JOIN by link cut short': msg.joinByLink(roomId).subarray(0, -1),
                'JOIN by link one byte long': Buffer.concat([msg.joinByLink(roomId), Buffer.from([0])]),
                'JOIN by a one-letter locator': msg.joinByCode('A'),
                'JOIN by a four-letter locator': msg.joinByCode('ABCD'),
                'JOIN by a locator whose length is wrong': msg.joinByCode('AB').subarray(0, -1),
                'JOIN by a locator with a letter codes never use': msg.joinByCode('AI'),
                'JOIN by a lower-case locator': msg.joinByCode('ab'),
                'JOIN by a locator with a digit': msg.joinByCode('A1'),
            };
            for (const [what, m] of Object.entries(cases)) await expectRefusal(m, ERROR.MALFORMED, what);
        });

        test("MALFORMED on a sender's socket: a second CREATE, a JOIN, a receiver's message, or a message not laid out right; its room ends", async () => {
            const cases = {
                'a second CREATE': (room) => msg.create({ roomId: room.roomId }),
                'a second CREATE for another room': () => msg.create({ roomId: randomBytes(16) }),
                'a JOIN': (room) => msg.joinByLink(room.roomId),
                "a receiver's SEND": () => msg.receiverSend(Buffer.from('x')),
                'SEND with no tag': () => Buffer.from([TYPE.SEND]),
                'DROP with no tag': () => Buffer.from([TYPE.DROP]),
                'DROP with two tags': () => Buffer.from([TYPE.DROP, 1, 2]),
                'LOCK with a byte after it': () => Buffer.from([TYPE.LOCK, 0]),
                'CODE with a byte after it': () => Buffer.from([TYPE.CODE, 0]),
                'RENEW with a byte after it': () => Buffer.from([TYPE.RENEW, 0]),
                'an empty message': () => Buffer.alloc(0),
                'an unknown type': () => Buffer.from([0x07]),
                'a server message': () => Buffer.from([TYPE.ERROR, 1]),
            };
            for (const [what, make] of Object.entries(cases)) {
                const room = await openRoom(server);
                const { receiver } = await joinRoom(server, room);
                room.sender.send(make(room));
                const got = await expectError(room.sender, ERROR.MALFORMED);
                assert.deepEqual({ message: got.message, closeCode: got.closeCode }, got.expected, what);
                assert.equal(hex(await receiver.next()), hex([TYPE.GONE_TO_RECEIVER]), `${what}: the receiver is told`);
            }
        });

        test("MALFORMED on a receiver's socket: anything but its SEND, or a frame over 8,230 bytes; the sender is told GONE", async () => {
            const cases = {
                'a second JOIN': (room) => msg.joinByLink(room.roomId),
                'a CREATE': () => msg.create({ roomId: randomBytes(16) }),
                "a sender's SEND": (_room, tag) => msg.send(tag, Buffer.from('x')),
                'DROP': (_room, tag) => msg.drop(tag),
                'LOCK': () => msg.lock(),
                'CODE': () => msg.code(),
                'an empty message': () => Buffer.alloc(0),
                'a frame of 8,231 bytes': () => msg.receiverSend(Buffer.alloc(MAX_FRAME_BYTES + 1)),
            };
            for (const [what, make] of Object.entries(cases)) {
                const room = await openRoom(server);
                const { receiver, tag } = await joinRoom(server, room);
                receiver.send(make(room, tag));
                const got = await expectError(receiver, ERROR.MALFORMED);
                assert.deepEqual({ message: got.message, closeCode: got.closeCode }, got.expected, what);
                assert.equal(hex(await room.sender.next()), hex([TYPE.GONE_TO_SENDER, tag]), `${what}: the sender is told`);
                room.sender.close();
            }
        });

        test('whatever a socket sends after it has been refused or ended is ignored, and the server carries on', async () => {
            // A sender's refusal, then more in the same breath, before the close reaches it.
            const sender = await connect(server);
            sender.send(msg.create({ roomId: randomBytes(16) }));
            await sender.next();
            sender.send(Buffer.from([0x07]));
            for (const m of [msg.send(1, Buffer.from('x')), msg.lock(), msg.code(), msg.drop(1)]) sender.send(m);
            assert.equal(hex(await sender.next()), hex(errorMessage(ERROR.MALFORMED)));
            await sender.closed;

            // A receiver's, and a receiver dropped while it's still sending.
            const room = await openRoom(server);
            const refused = await joinRoom(server, room);
            refused.receiver.send(msg.lock());
            for (let i = 0; i < 20; i++) refused.receiver.send(msg.receiverSend(Buffer.from('x')));
            await refused.receiver.closed;
            assert.equal(hex(await room.sender.next()), hex([TYPE.GONE_TO_SENDER, refused.tag]));
            const dropped = await joinRoom(server, room);
            room.sender.send(msg.drop(dropped.tag));
            for (let i = 0; i < 200; i++) dropped.receiver.send(msg.receiverSend(Buffer.from('y')));
            await dropped.receiver.closed;

            const info = await fetch(`${server.baseUrl}/api/info`);
            assert.equal(info.status, 200, 'the server is still up');
            await stillOpen(room.sender);
            room.sender.close();
            await heldBecomes(server, NOTHING_HELD);
        });

        test('a text message closes the socket 1003, with no ERROR; one over 8,232 bytes closes it 1009; 8,232 bytes is taken', async () => {
            const text = await connect(server);
            text.ws.send('{"type":"CREATE"}');
            assert.equal((await text.closed).code, 1003);
            assert.deepEqual(text.pending(), []);

            const room = await openRoom(server);
            const { receiver, tag } = await joinRoom(server, room);
            const largest = msg.send(tag, randomBytes(MAX_FRAME_BYTES));
            assert.equal(largest.length, 8232);
            room.sender.send(largest);
            assert.equal(hex(await receiver.next()), hex(Buffer.concat([Buffer.from([TYPE.FRAME_TO_RECEIVER]), largest.subarray(2)])));
            room.sender.send(Buffer.concat([largest, Buffer.from([0])]));
            assert.equal((await room.sender.closed).code, 1009);
            assert.equal(hex(await receiver.next()), hex([TYPE.GONE_TO_RECEIVER]), 'and its room ends');

            const sender = await connect(server);
            sender.ws.send(Buffer.from('a text message in a binary frame is just bytes'), { binary: false });
            assert.equal((await sender.closed).code, 1003);
        });
    });

    describe('what it holds', () => {
        test('nothing once every room has ended, however they ended', async () => {
            await heldBecomes(server, NOTHING_HELD);
            const room = await openRoom(server);
            const a = await joinRoom(server, room);
            await joinRoom(server, room);
            const idle = await connect(server);
            const counts = ['sockets', 'rooms', 'attempts'];
            assert.deepEqual(await heldOf(server, counts), { sockets: 4, rooms: 1, attempts: 2 });
            room.sender.send(msg.drop(a.tag));
            await a.receiver.closed;
            assert.deepEqual(await heldOf(server, counts), { sockets: 3, rooms: 1, attempts: 1 });
            room.sender.close();
            idle.close();
            await heldBecomes(server, NOTHING_HELD);
        });

        test('a room, a code, an attempt and a socket each hold only known fields, made in one place, with nothing from the request; nothing reaches the disk', () => {
            const source = fs.readFileSync(path.join(server.dir, 'rendezvous.js'), 'utf8').replace(/\r\n/g, '\n');
            // The code alone, without its comments, which talk about addresses.
            const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/ \/\/ .*$/gm, '');
            const fieldsOf = (body) => [...body.matchAll(/(?:^|[{,])\s*(\w+)(?=\s*[:,}])/g)].map((m) => m[1]);

            const room = code.match(/\n {8}const room = \{([\s\S]*?)\n {8}\};/g);
            assert.equal(room?.length, 1, 'one place makes a room');
            assert.deepEqual(fieldsOf(room[0].replace(/^[\s\S]*?\{/, '{')), ['id', 'nonce', 'sender', 'locked', 'attempts', 'lastTag', 'code']);
            const roomCode = code.match(/const code = \{[^}]*\};/g);
            assert.equal(roomCode?.length, 1, "one place makes a room's code");
            assert.deepEqual(fieldsOf(roomCode[0].replace(/^[^{]*/, '')), ['locator', 'attempt', 'release']);
            const attempt = code.match(/const attempt = \{[^}]*\};/g);
            assert.equal(attempt?.length, 1, 'one place makes an attempt');
            assert.deepEqual(fieldsOf(attempt[0].replace(/^[^{]*/, '')), ['room', 'tag', 'by', 'receiver', 'live', 'toSender', 'toReceiver']);
            const peer = code.match(/const peer = \{[^}]*\};/g);
            assert.equal(peer?.length, 1, 'one place makes a socket\'s state');
            assert.deepEqual(fieldsOf(peer[0].replace(/^[^{]*/, '')), ['ws', 'role', 'room', 'attempt', 'heardAt', 'finished', 'counted']);
            assert.equal(code.match(/rooms\.set\(/g).length, 1, 'and nothing else adds a room');
            assert.equal(code.match(/counts\.set\(/g).length, 1, 'or sets a count');

            // The upgrade's request is handed to ws and never kept: a socket's state is made from the socket and
            // its address's keyed hash. The address is hashed as the socket connects, and goes nowhere else.
            assert.equal(code.match(/\breq\b/g).length, 2, 'the request is only passed on');
            assert.equal(code.match(/\baddress\b/g).length, 4, 'the address is only hashed');
            assert.match(code, /handleUpgrade: \(req, socket, head, address\) => \{\n\s*const counted = countKeyOf\(address\);\n\s*sockets\.handleUpgrade\(req, socket, head, \(ws\) => connect\(ws, counted\)\);\n\s*\}/);
            assert.match(code, /const countKeyOf = \(address\) => createHmac\('sha256', countKey\)\.update\(String\(address \?\? ''\)\)\.digest\(\)\.toString\('latin1', 0, COUNT_KEY_BYTES\);/);
            assert.match(code, /const countKey = randomBytes\(32\);/);
            assert.equal(code.match(/\bcountKey\b/g).length, 2, 'the key is made and used, never written or handed out');
            assert.match(code, /const connect = \(ws, counted\) =>/);
            assert.deepEqual([...code.matchAll(/require\('([^']+)'\)/g)].map((m) => m[1]), ['crypto', 'ws'], 'no file system, nothing but crypto and ws');
        });
    });
});

describe('the rendezvous on the test clock', () => {
    let server;

    before(async () => {
        server = await startServer({ held: true, clock: true, env: CODES_OFF });
    });

    after(() => server?.stop());

    test('pings every socket every 30 seconds, and a socket that answers stays open', async () => {
        const room = await openRoom(server);
        const { receiver, tag } = await joinRoom(server, room);
        for (let i = 1; i <= 6; i++) {
            await server.advanceClock(PING_INTERVAL_MS);
            await waitFor(() => room.sender.pings.length === i && receiver.pings.length === i, { what: `ping ${i}` });
            // A round trip each way, so the server has the pongs before the clock moves on.
            room.sender.send(msg.send(tag, Buffer.alloc(0)));
            await receiver.next();
            receiver.send(msg.receiverSend(Buffer.alloc(0)));
            await room.sender.next();
        }
        await stillOpen(room.sender);
        room.sender.close();
        await heldBecomes(server, NOTHING_HELD);
    });

    test("a socket silent for 60 seconds is closed: a silent sender's room ends with it, a silent receiver's attempt too", async () => {
        const room = await openRoom(server, { autoPong: false });
        const { receiver } = await joinRoom(server, room);
        const silentRoom = await openRoom(server);
        const silent = await joinRoom(server, silentRoom, { autoPong: false });

        await server.advanceClock(PING_INTERVAL_MS);
        await waitFor(() => room.sender.pings.length === 1 && silent.receiver.pings.length === 1, { what: 'the first pings' });
        // The answering ones prove the server has heard them.
        await stillOpen(silentRoom.sender);
        receiver.send(msg.receiverSend(Buffer.alloc(0)));
        await room.sender.next();
        assert.deepEqual(await heldOf(server, ['sockets', 'rooms', 'attempts']), { sockets: 4, rooms: 2, attempts: 2 });

        await server.advanceClock(PING_INTERVAL_MS);
        assert.equal((await room.sender.closed).code, 1006, 'the silent sender, cut off');
        assert.equal(hex(await receiver.next()), hex([TYPE.GONE_TO_RECEIVER]), "and its receiver told its room's gone");
        assert.equal((await silent.receiver.closed).code, 1006, 'the silent receiver, cut off');
        assert.equal(hex(await silentRoom.sender.next()), hex([TYPE.GONE_TO_SENDER, silent.tag]));
        silentRoom.sender.close();
        await heldBecomes(server, NOTHING_HELD);
    });

    test('a socket that sends messages, but never answers a ping, stays open while it does', async () => {
        const room = await openRoom(server, { autoPong: false });
        for (let i = 1; i <= 4; i++) {
            await server.advanceClock(PING_INTERVAL_MS);
            await waitFor(() => room.sender.pings.length === i, { what: `ping ${i}` });
            await stillOpen(room.sender);
        }
        assert.deepEqual(await heldOf(server, ['sockets', 'rooms', 'attempts']), { sockets: 1, rooms: 1, attempts: 0 });
        room.sender.close();
        await heldBecomes(server, NOTHING_HELD);
    });

    test('a socket that only answers pings, and sends nothing, stays open', async () => {
        const quiet = await connect(server);
        for (let i = 1; i <= 4; i++) {
            await server.advanceClock(PING_INTERVAL_MS);
            await waitFor(() => quiet.pings.length === i, { what: `ping ${i}` });
            // The pong has nothing to prove it arrived, but a moment.
            await sleep(200);
        }
        assert.deepEqual(await heldOf(server, ['sockets', 'rooms', 'attempts']), { sockets: 1, rooms: 0, attempts: 0 });
        quiet.close();
        await heldBecomes(server, NOTHING_HELD);
    });

    test('a socket that has never sent CREATE or JOIN is closed the same way when silent', async () => {
        const idle = await connect(server, { autoPong: false });
        await server.advanceClock(PING_INTERVAL_MS);
        await waitFor(() => idle.pings.length === 1, { what: 'the ping' });
        await server.advanceClock(PING_INTERVAL_MS);
        assert.equal((await idle.closed).code, 1006);
        await heldBecomes(server, NOTHING_HELD);
    });

    test('a room with both devices connected stays open over 48 hours, with no cap, and holds nothing about it on disk', async () => {
        const before = listFiles(server.dir);
        const room = await openRoom(server);
        const { receiver, tag } = await joinRoom(server, room);
        const STEP_MS = 55_000;
        const steps = Math.ceil((48 * 60 * 60 * 1000) / STEP_MS);
        assert.ok(steps < MAX_FRAMES_EACH_WAY, 'the round trips stay under the frame limit');
        for (let i = 1; i <= steps; i++) {
            await server.advanceClock(STEP_MS);
            await waitFor(() => room.sender.pings.length === i && receiver.pings.length === i, { what: `ping ${i}`, intervalMs: 1 });
            room.sender.send(msg.send(tag, Buffer.alloc(0)));
            await receiver.next();
            receiver.send(msg.receiverSend(Buffer.alloc(0)));
            await room.sender.next();
        }
        room.sender.send(msg.send(tag, Buffer.from('after two days')));
        assert.equal((await receiver.next()).subarray(1).toString(), 'after two days');
        const late = await joinRoom(server, room);
        assert.equal(late.tag, 2, 'and takes new attempts');
        assert.deepEqual(listFiles(server.dir), before, 'nothing written');
        room.sender.close();
        await heldBecomes(server, NOTHING_HELD);
    });
});

/** Every file under a folder, with its size, but the harness's own (its request log, its listening file). */
function listFiles(dir) {
    const out = [];
    const walk = (d) => {
        for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
            const full = path.join(d, entry.name);
            if (entry.name === 'node_modules') continue;
            if (entry.isDirectory()) walk(full);
            else out.push(`${path.relative(dir, full)} ${fs.statSync(full).size}`);
        }
    };
    walk(dir);
    return out.filter((f) => !/^(requests\.jsonl|listening\.json|listen-error\.json) /.test(f)).sort();
}

describe('the rendezvous upgrade', () => {
    test('goes through the rate limiter, counted by the address the one-hop proxy rule gives, and is answered 429 past it', async (t) => {
        const server = await startServer({ held: true, env: { RATE_LIMIT_MAX_REQUESTS: '2' } });
        t.after(server.stop);
        const from = (address) => ({ headers: { 'X-Forwarded-For': `198.51.100.1, ${address}` } });
        assert.equal(await upgradeRefused(server, from('203.0.113.1')), null);
        assert.equal(await upgradeRefused(server, from('203.0.113.1')), null);
        assert.deepEqual(await upgradeRefused(server, from('203.0.113.1')), {
            status: 429, body: JSON.stringify({ code: 'RATE_LIMITED', error: 'Too many requests, please try again later.' }),
        });
        // The last address in X-Forwarded-For is the client's, by the server's own rule: another has its own count.
        assert.equal(await upgradeRefused(server, from('203.0.113.2')), null);
        await heldBecomes(server, NOTHING_HELD);
    });

    test('is at its one path only: any other is refused, and PeerJS keeps its own', async (t) => {
        const server = await startServer({ held: true, env: { RATE_LIMIT_MAX_REQUESTS: '0' } });
        t.after(server.stop);
        for (const path of ['/api/v4/rendezvous/', '/api/v4/rendezvous/abc', '/api/v4/rendezvousx', '/api/v4', '/', '/p2p']) {
            assert.notEqual(await upgradeRefused(server, { path }), null, path);
        }
        assert.equal(await upgradeRefused(server, { path: '/api/v4/rendezvous?x=1' }), null, 'a query is ignored');
        // PeerJS's signalling socket still opens, and still says OPEN.
        const peer = await connect(server, { path: '/peerjs/peerjs?key=peerjs&id=zq7PEER&token=zq7TOKEN' });
        assert.equal(JSON.parse((await peer.next()).toString()).type, 'OPEN');
        peer.close();
    });

    test('with direct transfer off, is answered as any other request: there\'s nothing there', async (t) => {
        const server = await startServer({ held: true, env: { ENABLE_P2P: 'false', ENABLE_UPLOAD: 'true' } });
        t.after(server.stop);
        assert.deepEqual(await upgradeRefused(server), { status: 404, body: JSON.stringify({ code: 'NOT_FOUND', error: 'There is nothing here.' }) });
        assert.equal(await server.rendezvousHeld(), null);
    });
});

describe('what the rendezvous logs', () => {
    const OWN_LINE = /^\[\d{4}-\d{2}-\d{2}T[\d:.]+Z\] \[(ERROR|WARN|INFO|DEBUG)\] (.*)$/;
    let server;

    before(async () => {
        server = await startServer({ env: { LOG_LEVEL: 'DEBUG', ...CODES_OFF } });
        await waitFor(() => server.output.stdout.includes('is running'), { what: 'the startup log' });
    });

    after(() => server?.stop());

    /** What the server logs while `run` runs, as [level, message]. */
    const loggedBy = async (run) => {
        const mark = server.mark();
        await run();
        await sleep(100);
        const { stdout, stderr } = server.since(mark);
        return (stdout + stderr).split(/\r?\n/).filter(Boolean).map((l) => (l.match(OWN_LINE) ?? [null, '?', l]).slice(1));
    };

    test('at DEBUG, with codes off, each event as it happens, and nothing else: no frame, tag, drop, lock or refusal', async () => {
        let room;
        let attempt;
        assert.deepEqual(await loggedBy(async () => { room = await openRoom(server); }), [['DEBUG', "A direct transfer's room opened."]]);
        assert.deepEqual(await loggedBy(async () => { (await openRoom(server, { code: true })).sender.close(); }), [
            ['DEBUG', "A direct transfer's room opened."], ['DEBUG', 'No code was free.'], ['DEBUG', "A direct transfer's room closed."],
        ]);
        assert.deepEqual(await loggedBy(async () => { attempt = await joinRoom(server, room); }), [['DEBUG', 'A receiver joined.']]);
        assert.deepEqual(await loggedBy(async () => { await stillOpen(room.sender); }), [['DEBUG', 'No code was free.']]);
        assert.deepEqual(await loggedBy(async () => {
            attempt.receiver.send(msg.receiverSend(Buffer.from('zq7FRAME')));
            await room.sender.next();
            room.sender.send(msg.send(attempt.tag, Buffer.from('zq7FRAME')));
            await attempt.receiver.next();
            room.sender.send(msg.renew());
            room.sender.send(msg.drop(attempt.tag));
            await attempt.receiver.closed;
            room.sender.send(msg.lock());
            const busy = await connect(server);
            busy.send(msg.joinByLink(room.roomId));
            await busy.closed;
            for (const refused of [msg.joinByLink(randomBytes(16)), msg.joinByCode('AB'), msg.create({ roomId: randomBytes(16), major: 3 }), Buffer.from([0x07])]) {
                const client = await connect(server);
                client.send(refused);
                await client.closed;
            }
        }), []);
        assert.deepEqual(await loggedBy(async () => {
            room.sender.close();
            await room.sender.closed;
        }), [['DEBUG', "A direct transfer's room closed."]]);
    });
});

describe('a socket that can\'t keep up', () => {
    test("is closed once 1 MiB waits to be sent to it: a slow receiver's attempt ends, a slow sender's room", async (t) => {
        const server = await startServer({ held: true, env: { RATE_LIMIT_MAX_REQUESTS: '0' } });
        t.after(server.stop);

        const room = await openRoom(server);
        const slow = await joinRoom(server, room);
        slow.receiver.ws.pause();
        let cutOff = false;
        room.sender.ws.on('message', (m) => { if (m[0] === TYPE.GONE_TO_SENDER) cutOff = true; });
        const frame = msg.send(slow.tag, randomBytes(MAX_FRAME_BYTES));
        let sent = 0;
        while (sent < MAX_FRAMES_EACH_WAY && !cutOff) {
            room.sender.send(frame);
            sent++;
            if (sent % 64 === 0) await sleep(5);
        }
        assert.equal(hex(await room.sender.next({ timeoutMs: 10_000 })), hex([TYPE.GONE_TO_SENDER, slow.tag]), 'the slow receiver cut off');
        assert.ok(sent < MAX_FRAMES_EACH_WAY, `cut off before the frame limit (after ${sent} frames)`);

        const { receiver } = await joinRoom(server, room);
        room.sender.ws.pause();
        let roomGone = false;
        receiver.ws.on('message', (m) => { if (m[0] === TYPE.GONE_TO_RECEIVER) roomGone = true; });
        const back = msg.receiverSend(randomBytes(MAX_FRAME_BYTES));
        for (let i = 0; i < MAX_FRAMES_EACH_WAY && !roomGone; i++) {
            receiver.send(back);
            if (i % 64 === 0) await sleep(5);
        }
        assert.equal(hex(await receiver.next({ timeoutMs: 10_000 })), hex([TYPE.GONE_TO_RECEIVER]), "the slow sender cut off, and its room's attempts told");
        await heldBecomes(server, NOTHING_HELD);
    });
});

/** CPace's first message, as a receiver by code sends it first: its bytes don't matter to the server. */
const message1 = () => randomBytes(CPACE_MESSAGE1_BYTES);
/** Every locator of this many letters. */
const everyLocator = (letters) => {
    let all = [''];
    for (let i = 0; i < letters; i++) all = all.flatMap((start) => [...CODE_LETTERS].map((letter) => start + letter));
    return all;
};
/** A proxy saying the connection came from this address (the server trusts one hop). */
const from = (address) => ({ headers: { 'X-Forwarded-For': address } });

/** Expects a socket to be refused with this ERROR, and closed. */
const refusedWith = async (client, code, what) => {
    const got = await expectError(client, code);
    assert.deepEqual({ message: got.message, closeCode: got.closeCode }, got.expected, what);
};

/** Joins by a locator, expecting an ERROR. */
const joinRefused = async (server, locator, code, what) => {
    const client = await connect(server);
    client.send(msg.joinByCode(locator));
    await refusedWith(client, code, what);
};

/** Opens many rooms at once, a code asked for in each. */
const openRooms = async (server, count, opts = {}) => {
    const rooms = [];
    for (let at = 0; at < count; at += 200) {
        rooms.push(...await Promise.all(Array.from({ length: Math.min(200, count - at) }, () => openRoom(server, { code: true, ...opts }))));
    }
    return rooms;
};

/** Closes every room's sender, and waits until each is closed. */
const closeRooms = async (rooms) => {
    for (const room of rooms) room.sender.close();
    await Promise.all(rooms.map((room) => room.sender.closed));
};

describe('codes', () => {
    let server;
    // Each test's rooms come from an address of its own, so the cap of 5 unused codes is each test's own.
    let addresses = 0;
    const own = () => from(`198.51.100.${++addresses}`);

    before(async () => {
        server = await startServer({ held: true, env: { RATE_LIMIT_MAX_REQUESTS: '0' } });
    });

    after(() => server?.stop());

    test("CREATE with a code asked for gives a locator of two of the code's letters; a JOIN by it gives the receiver the room's nonce, the sender an ATTEMPT by code, and frames pass both ways", async () => {
        const room = await openRoom(server, { code: true, ...own() });
        assert.match(room.locator, /^[A-HJ-NP-Z]{2}$/);
        const receiver = await connect(server);
        receiver.send(msg.joinByCode(room.locator));
        assert.equal(hex(await receiver.next()), hex(Buffer.concat([Buffer.from([TYPE.JOINED]), room.roomNonce])));
        const [type, tag, by] = await room.sender.next();
        assert.deepEqual([type, by], [TYPE.ATTEMPT, BY.CODE]);
        const m1 = message1();
        receiver.send(msg.receiverSend(m1));
        assert.equal(hex(await room.sender.next()), hex(Buffer.concat([Buffer.from([TYPE.FRAME_TO_SENDER, tag]), m1])));
        room.sender.send(msg.send(tag, Buffer.from('message 2')));
        assert.equal((await receiver.next()).subarray(1).toString(), 'message 2');
        await closeRooms([room]);
    });

    test("the first frame by a code, CPace's first message, uses it up: only that one reaches the sender; a JOIN by it is BUSY while its attempt has sent nothing, and finds nothing once it has; the attempt carries on", async () => {
        const room = await openRoom(server, { code: true, ...own() });
        const first = await joinByCode(server, room);
        const meanwhile = await connect(server);
        meanwhile.send(msg.joinByCode(room.locator));
        await refusedWith(meanwhile, ERROR.BUSY, 'a second JOIN while the first has sent nothing');
        assert.deepEqual(await heldOf(server, ['codes']), { codes: 1 }, 'the code still unused');

        const m1 = message1();
        first.receiver.send(msg.receiverSend(m1));
        assert.equal(hex(await room.sender.next()), hex(Buffer.concat([Buffer.from([TYPE.FRAME_TO_SENDER, first.tag]), m1])));
        assert.deepEqual(await heldOf(server, ['codes']), { codes: 0 }, 'the code used up');
        await joinRefused(server, room.locator, ERROR.NOT_FOUND, 'a JOIN by the used code, the right password or not');

        // The sender's next code is another locator: the used one waits out its quarantine.
        const next = await askCode(room.sender);
        assert.match(next, /^[A-HJ-NP-Z]{2}$/);
        assert.notEqual(next, room.locator);

        // The attempt carries on, CPace's second and third messages and more, without touching the new code.
        room.sender.send(msg.send(first.tag, randomBytes(99)));
        assert.equal((await first.receiver.next()).length, 1 + 99);
        first.receiver.send(msg.receiverSend(randomBytes(64)));
        assert.equal((await room.sender.next()).length, 2 + 64);
        assert.deepEqual(room.sender.pending(), [], 'nothing else reached the sender');
        assert.deepEqual(await heldOf(server, ['codes']), { codes: 1 }, 'the new code still unused');
        first.receiver.close();
        await room.sender.next();
        await joinByCode(server, { ...room, locator: next });
        await closeRooms([room]);
    });

    test('a receiver by code who leaves, or is dropped, before sending anything leaves the code unused for the next', async () => {
        const room = await openRoom(server, { code: true, ...own() });
        const leaving = await joinByCode(server, room);
        leaving.receiver.close();
        assert.equal(hex(await room.sender.next()), hex([TYPE.GONE_TO_SENDER, leaving.tag]));
        const dropped = await joinByCode(server, room);
        room.sender.send(msg.drop(dropped.tag));
        assert.equal(hex(await dropped.receiver.next()), hex([TYPE.GONE_TO_RECEIVER]));
        assert.deepEqual(await heldOf(server, ['codes']), { codes: 1 });
        const last = await joinByCode(server, room);
        last.receiver.send(msg.receiverSend(message1()));
        await room.sender.next();
        assert.deepEqual(await heldOf(server, ['codes']), { codes: 0 });
        await closeRooms([room]);
    });

    test('while a code is unused, CODE gives it again and RENEW answers nothing; CODE gives a new one only once it has been used, and with none asked for at CREATE, CODE gives one', async () => {
        const room = await openRoom(server, { code: true, ...own() });
        assert.equal(await askCode(room.sender), room.locator);
        room.sender.send(msg.renew());
        assert.equal(await askCode(room.sender), room.locator);
        assert.deepEqual(room.sender.pending(), []);

        const plain = await openRoom(server, own());
        assert.equal(plain.locator, null);
        const given = await askCode(plain.sender);
        assert.match(given, /^[A-HJ-NP-Z]{2}$/);
        assert.equal(await askCode(plain.sender), given);
        await joinByCode(server, { ...plain, locator: given });
        await closeRooms([room, plain]);
    });

    test("LOCK releases the unused code: a JOIN by it finds nothing and CODE gives none, while the attempts under way carry on", async () => {
        const room = await openRoom(server, { code: true, ...own() });
        const byLink = await joinRoom(server, room);
        room.sender.send(msg.lock());
        await joinRefused(server, room.locator, ERROR.NOT_FOUND, 'the released code');
        room.sender.send(msg.code());
        assert.equal(hex(await room.sender.next()), hex([TYPE.CODE_IS, 0]), 'a locked room is given no code');
        room.sender.send(msg.send(byLink.tag, Buffer.from('on')));
        assert.equal((await byLink.receiver.next()).subarray(1).toString(), 'on');
        assert.deepEqual(await heldOf(server, ['codes']), { codes: 0 });
        await closeRooms([room]);
    });

    test('LOCK while an attempt by code has sent nothing releases the code, and that attempt carries on', async () => {
        const room = await openRoom(server, { code: true, ...own() });
        const byCode = await joinByCode(server, room);
        room.sender.send(msg.lock());
        await joinRefused(server, room.locator, ERROR.NOT_FOUND, 'the released code');
        byCode.receiver.send(msg.receiverSend(message1()));
        assert.equal((await room.sender.next()).length, 2 + CPACE_MESSAGE1_BYTES);
        await closeRooms([room]);
    });

    test("a room ending releases its code: a JOIN by it finds nothing, and its address's count is gone", async () => {
        const room = await openRoom(server, { code: true, ...own() });
        const counted = (await server.rendezvousHeld()).counted;
        await closeRooms([room]);
        await heldBecomes(server, { codes: 0, counted: counted - 1 });
        await joinRefused(server, room.locator, ERROR.NOT_FOUND, "the room's code");
    });

    test('one attempt by code at a time, beside the 4 by link: a new code is BUSY until the last attempt by code ends', async () => {
        const room = await openRoom(server, { code: true, ...own() });
        for (let i = 0; i < 4; i++) await joinRoom(server, room);
        const first = await joinByCode(server, room);
        first.receiver.send(msg.receiverSend(message1()));
        await room.sender.next();
        const next = await askCode(room.sender);
        const busy = await connect(server);
        busy.send(msg.joinByCode(next));
        await refusedWith(busy, ERROR.BUSY, 'while the first attempt by code is live');
        first.receiver.close();
        assert.equal(hex(await room.sender.next()), hex([TYPE.GONE_TO_SENDER, first.tag]));
        await joinByCode(server, { ...room, locator: next });
        await closeRooms([room]);
    });

    test("a locator of the other length finds nothing: the server's codes have 2 letters", async () => {
        const room = await openRoom(server, { code: true, ...own() });
        await joinRefused(server, `${room.locator}A`, ERROR.NOT_FOUND, 'three letters on a server of two');
        await closeRooms([room]);
        await heldBecomes(server, NOTHING_HELD);
    });
});

/**
 * Moves the server's clock on, in steps well under its 60-second silence
 * limit, hearing from every sender before each step (a frame to no attempt,
 * which goes nowhere, then a ping of its own answered, so the server has read
 * it), so none is closed for silence and no code is renewed.
 */
const advanceKeeping = async (server, ms, rooms) => {
    const touch = async ({ sender }) => {
        if (sender.ws.readyState !== sender.ws.OPEN) return;
        sender.send(msg.send(0, Buffer.alloc(0)));
        const pong = once(sender.ws, 'pong');
        sender.ws.ping();
        await pong;
    };
    for (let left = ms; left > 0; left -= 50_000) {
        await Promise.all(rooms.map(touch));
        await server.advanceClock(Math.min(50_000, left));
    }
};

test('a locator is drawn at random from the free ones: the first 100 given start with most of the 24 letters, and two servers give them in different orders', async () => {
    const drawn = [];
    for (let run = 0; run < 2; run++) {
        const server = await startServer({ env: { RATE_LIMIT_MAX_REQUESTS: '0', P2P_MAX_CODES_PER_IP: '1000' } });
        try {
            const rooms = [];
            for (let i = 0; i < 100; i++) rooms.push(await openRoom(server, { code: true }));
            drawn.push(rooms.map((r) => r.locator));
            await closeRooms(rooms);
        } finally {
            await server.stop();
        }
    }
    for (const locators of drawn) {
        // At random, 100 draws start with about 23.7 different letters; fewer than 15 is under one in 10^17.
        const firsts = new Set(locators.map((l) => l[0]));
        assert.ok(firsts.size >= 15, `the first letters: ${[...firsts].join('')}`);
        assert.equal(new Set(locators).size, 100, 'each once');
    }
    assert.notDeepEqual(drawn[0], drawn[1]);
});

describe('codes on the test clock', () => {
    test("an unused code is released 10 minutes after its sender last asked for it or renewed it: it's told CODE_GONE, and a JOIN by it finds nothing", async (t) => {
        const server = await startServer({ held: true, clock: true, env: { RATE_LIMIT_MAX_REQUESTS: '0' } });
        t.after(server.stop);
        const room = await openRoom(server, { code: true });
        // Real time passes between the clock's steps too, so each check stands well clear of the 10 minutes.
        await advanceKeeping(server, RELEASE_MS - 10_000, [room]);
        room.sender.send(msg.renew());
        await advanceKeeping(server, RELEASE_MS - 10_000, [room]);
        assert.equal(await askCode(room.sender), room.locator, 'kept while renewed; CODE renews it too');
        await advanceKeeping(server, RELEASE_MS - 10_000, [room]);
        assert.deepEqual(room.sender.pending(), []);
        assert.deepEqual(await heldOf(server, ['codes', 'counted']), { codes: 1, counted: 1 });

        await advanceKeeping(server, 20_000, [room]);
        assert.equal(hex(await room.sender.next()), hex([TYPE.CODE_GONE]));
        assert.deepEqual(await heldOf(server, ['codes', 'counted', 'quarantined']), { codes: 0, counted: 0, quarantined: 1 });
        await joinRefused(server, room.locator, ERROR.NOT_FOUND, 'the released code');
        const next = await askCode(room.sender);
        assert.notEqual(next, room.locator, 'the released locator waits out its quarantine');
        // The room carries on by link.
        await joinRoom(server, room);
        await closeRooms([room]);
    });

    test('every one of the 576 locators can be held at once, the next sender gets its link and no code, and each locator that leaves (used, locked, its room closed, released) is held back 5 minutes', async (t) => {
        const server = await startServer({ held: true, clock: true, env: { RATE_LIMIT_MAX_REQUESTS: '0', P2P_MAX_CODES_PER_IP: '1000' } });
        t.after(server.stop);
        const rooms = await openRooms(server, 576);
        assert.deepEqual(rooms.map((r) => r.locator).sort(), everyLocator(2), 'every locator, each once');
        assert.deepEqual(await heldOf(server, ['codes', 'free', 'quarantined']), { codes: 576, free: 0, quarantined: 0 });

        // None free: the 577th sender's room works by link.
        const linkOnly = await openRoom(server, { code: true });
        assert.equal(linkOnly.locator, null);
        assert.equal(await askCode(linkOnly.sender), null);
        await joinRoom(server, linkOnly);
        await closeRooms([linkOnly]);

        // Three leave now: one used, one locked, one whose room closes.
        const [used, locked, closed, expiring] = rooms;
        const byCode = await joinByCode(server, used);
        byCode.receiver.send(msg.receiverSend(message1()));
        await used.sender.next();
        locked.sender.send(msg.lock());
        await closeRooms([closed]);
        const live = rooms.filter((r) => r !== closed);
        await heldBecomes(server, { codes: 573, quarantined: 3, free: 0 });

        // A room opened from here on is kept, so its code isn't released for silence. Real time passes between
        // the clock's steps too, so each check stands well clear of when a locator comes back.
        const next = async () => {
            const room = await openRoom(server, { code: true });
            live.push(room);
            return room.locator;
        };
        await advanceKeeping(server, QUARANTINE_MS - 20_000, live);
        assert.equal(await next(), null, 'none back before 5 minutes');
        await advanceKeeping(server, 40_000, live);
        const back = [await next(), await next(), await next()];
        assert.deepEqual(back.sort(), [used.locator, locked.locator, closed.locator].sort(), 'those three back after 5 minutes');
        assert.equal(await next(), null, 'and no others');

        // Released: every code but one renewed, which goes 10 minutes after it was given.
        const renewAllBut = (skipped) => { for (const room of live) if (room !== skipped) room.sender.send(msg.renew()); };
        renewAllBut(expiring);
        await advanceKeeping(server, RELEASE_MS - QUARANTINE_MS, live);
        assert.equal(hex(await expiring.sender.next()), hex([TYPE.CODE_GONE]));
        renewAllBut(expiring);
        assert.equal(await next(), null, 'the released one held back');
        await advanceKeeping(server, QUARANTINE_MS - 20_000, live);
        assert.equal(await next(), null, 'still, well before 5 minutes');
        await advanceKeeping(server, 40_000, live);
        assert.equal(await next(), expiring.locator, 'back after 5 minutes');
        await closeRooms(live);
    });
});

describe('codes at 3 letters', () => {
    test('every one of the 13,824 locators can be held at once, then the next sender gets its link and no code; a JOIN by 3 letters finds its room, by 2 nothing; the messages are the same', async (t) => {
        const server = await startServer({ held: true, env: { RATE_LIMIT_MAX_REQUESTS: '0', P2P_LOCATOR_LETTERS: '3', P2P_MAX_CODES_PER_IP: '20000' } });
        t.after(server.stop);
        const rooms = await openRooms(server, 13_824);
        assert.deepEqual(rooms.map((r) => r.locator).sort(), everyLocator(3), 'every locator, each once');
        assert.deepEqual(await heldOf(server, ['codes', 'free']), { codes: 13_824, free: 0 });

        const linkOnly = await openRoom(server, { code: true });
        assert.equal(linkOnly.locator, null);
        await joinRoom(server, linkOnly);

        await joinByCode(server, rooms[0]);
        await joinRefused(server, rooms[1].locator.slice(0, 2), ERROR.NOT_FOUND, 'two letters on a server of three');
        await closeRooms([...rooms, linkOnly]);
        await heldBecomes(server, { ...NOTHING_HELD, quarantined: 13_824 });
    });
});

/** An IPv6 address without :: and without an IPv4 part, as its 16 bytes. */
const ipv6Bytes = (address) => {
    const [head, tail = ''] = address.split('::');
    const front = head ? head.split(':') : [];
    const back = tail ? tail.split(':') : [];
    const groups = [...front, ...Array(8 - front.length - back.length).fill('0'), ...back];
    return Buffer.from(groups.map((g) => g.padStart(4, '0')).join(''), 'hex');
};

/** Every way an address could be written in memory or a key: its text, its bytes, and as IPv4-mapped. */
const formsOf = (address) => {
    const texts = [address];
    const binary = [];
    const v4 = address.replace(/^::ffff:/i, '');
    if (net.isIPv4(v4)) {
        texts.push(v4, `::ffff:${v4}`);
        const bytes = Buffer.from(v4.split('.').map(Number));
        binary.push(bytes, Buffer.concat([Buffer.alloc(10), Buffer.from([0xff, 0xff]), bytes]));
    } else {
        const bytes = ipv6Bytes(address);
        binary.push(bytes, bytes.subarray(0, 7));
        // The /56 network the rate limiter counts it by, as it writes it (for these tests' addresses).
        texts.push(`${address.split('::')[0]}::/56`);
    }
    return { texts, binary };
};

describe('the per-address count of unused codes', () => {
    test('a sixth unused code from one address gives a room with no code, which works by link, while another address still gets codes; a code used up lets it have another', async (t) => {
        const server = await startServer({ held: true, env: { RATE_LIMIT_MAX_REQUESTS: '0' } });
        t.after(server.stop);
        const a = from('203.0.113.10');
        const five = [];
        for (let i = 0; i < 5; i++) five.push(await openRoom(server, { code: true, ...a }));
        assert.ok(five.every((r) => r.locator), 'five codes');
        const sixth = await openRoom(server, { code: true, ...a });
        assert.equal(sixth.locator, null, 'the sixth: no code');
        assert.equal(await askCode(sixth.sender), null, 'and none on asking');
        await joinRoom(server, sixth);
        const other = await openRoom(server, { code: true, ...from('203.0.113.11') });
        assert.ok(other.locator, 'another address still gets one');

        const byCode = await joinByCode(server, five[0]);
        byCode.receiver.send(msg.receiverSend(message1()));
        await five[0].sender.next();
        assert.ok(await askCode(sixth.sender), 'one used up, its address may have another');
        assert.equal(await askCode(five[0].sender), null, 'and no more');
        await closeRooms([...five, sixth, other]);
        await heldBecomes(server, NOTHING_HELD);
    });

    test("an address is counted as the rate limiter counts it: an IPv4 address in either of its forms, an IPv6 address by its /56 network", async (t) => {
        const server = await startServer({ held: true, env: { RATE_LIMIT_MAX_REQUESTS: '0' } });
        t.after(server.stop);
        const capOf = async (addresses) => {
            const rooms = [];
            for (let i = 0; i < 6; i++) rooms.push(await openRoom(server, { code: true, ...from(addresses[i % addresses.length]) }));
            return { rooms, given: rooms.filter((r) => r.locator).length };
        };
        const v4 = await capOf(['192.0.2.20', '::ffff:192.0.2.20']);
        assert.equal(v4.given, 5, 'an IPv4 address and its IPv4-mapped form share 5');
        const v6 = await capOf(['2001:db8:7:100::1', '2001:db8:7:1ff:ffff::2']);
        assert.equal(v6.given, 5, 'two IPv6 addresses in one /56 share 5');
        const elsewhere = await openRoom(server, { code: true, ...from('2001:db8:7:200::1') });
        assert.ok(elsewhere.locator, 'the next /56 has its own');
        assert.deepEqual((await server.rendezvousCounted()).map(([, count]) => count).sort(), [1, 5, 5]);
        await closeRooms([...v4.rooms, ...v6.rooms, elsewhere]);
        await heldBecomes(server, NOTHING_HELD);
    });

    test('holds no address: its keys are 16-byte keyed hashes, an entry goes at 0, and after a restart the same addresses have other keys and the same cap; nothing on disk, in memory or in the log', async (t) => {
        const server = await startServer({ held: true, env: { RATE_LIMIT_MAX_REQUESTS: '0', LOG_LEVEL: 'DEBUG' } });
        t.after(server.stop);
        const addresses = ['203.0.113.50', '2001:db8:5:100::1', '::ffff:192.0.2.33'];
        const forms = addresses.map(formsOf);
        const before = listFiles(server.dir);

        /** Rooms from each address: one past its cap from the first, two from the second, one from the third. */
        const openFromEach = async () => {
            const rooms = [];
            for (const [address, count] of [[addresses[0], 6], [addresses[1], 2], [addresses[2], 1]]) {
                for (let i = 0; i < count; i++) rooms.push({ address, ...await openRoom(server, { code: true, ...from(address) }) });
            }
            assert.equal(rooms.filter((r) => r.address === addresses[0] && !r.locator).length, 1, 'the first address capped at 5');
            assert.ok(rooms.filter((r) => r.address !== addresses[0]).every((r) => r.locator), 'the others not');
            return rooms;
        };
        const checkKeys = async () => {
            const counted = await server.rendezvousCounted();
            assert.deepEqual(counted.map(([, count]) => count).sort(), [1, 2, 5]);
            for (const [key] of counted) {
                assert.match(key, /^[0-9a-f]{32}$/, 'a key is 16 bytes');
                for (const { texts, binary } of forms) {
                    for (const text of texts) {
                        assert.ok(!key.includes(Buffer.from(text).toString('hex')), `${key} holds ${text}`);
                        for (const plain of [createHash('sha256').update(text).digest(), createHmac('sha256', Buffer.alloc(32)).update(text).digest()]) {
                            assert.notEqual(key, plain.subarray(0, 16).toString('hex'), `${key} is an unkeyed hash of ${text}`);
                        }
                    }
                    for (const bytes of binary) assert.ok(!key.includes(bytes.toString('hex')), `${key} holds ${bytes.toString('hex')}`);
                }
            }
            return counted.map(([key]) => key);
        };

        const rooms = await openFromEach();
        const keys = await checkKeys();

        // In memory: nothing the process holds is any of the addresses, written any way.
        const snapshot = await server.heapSnapshot(path.join(server.dir, 'held.heapsnapshot'));
        const heap = fs.readFileSync(snapshot, 'utf8');
        fs.rmSync(snapshot);
        for (const { texts } of forms) for (const text of texts) assert.ok(!heap.includes(text), `the server's memory holds ${text}`);

        // An entry goes once its count is 0.
        await closeRooms(rooms.filter((r) => r.address === addresses[2]));
        await waitFor(async () => (await server.rendezvousCounted()).length === 2, { what: "the third address's entry to go" });
        await closeRooms(rooms.filter((r) => r.address !== addresses[2]));
        await heldBecomes(server, NOTHING_HELD);

        // After a restart: the same addresses, the same cap, other keys.
        await server.restart();
        const again = await openFromEach();
        const keysAgain = await checkKeys();
        assert.deepEqual(keysAgain.filter((key) => keys.includes(key)), [], 'no key the same as before the restart');
        await closeRooms(again);
        await heldBecomes(server, NOTHING_HELD);

        assert.deepEqual(listFiles(server.dir), before, 'nothing written');
        const output = server.output.stdout + server.output.stderr;
        for (const { texts } of forms) for (const text of texts) assert.ok(!output.includes(text), `the log holds ${text}`);
    });

    test("at DEBUG, a code given, joined by, used, renewed, released or locked logs nothing of its own; a room given none says 'No code was free.'", async (t) => {
        const server = await startServer({ held: true, clock: true, env: { RATE_LIMIT_MAX_REQUESTS: '0', LOG_LEVEL: 'DEBUG', P2P_MAX_CODES_PER_IP: '1' } });
        t.after(server.stop);
        await waitFor(() => server.output.stdout.includes('is running'), { what: 'the startup log' });
        const loggedBy = async (run) => {
            const mark = server.mark();
            await run();
            await sleep(100);
            const { stdout, stderr } = server.since(mark);
            return (stdout + stderr).split(/\r?\n/).filter(Boolean).map((l) => l.replace(/^\[[^\]]*\] /, ''));
        };
        let room;
        assert.deepEqual(await loggedBy(async () => { room = await openRoom(server, { code: true }); }), ["[DEBUG] A direct transfer's room opened."]);
        assert.ok(room.locator);
        assert.deepEqual(await loggedBy(async () => {
            const byCode = await joinByCode(server, room);
            byCode.receiver.send(msg.receiverSend(message1()));
            await room.sender.next();
            byCode.receiver.close();
            await room.sender.next();
        }), ['[DEBUG] A receiver joined.']);
        assert.deepEqual(await loggedBy(async () => {
            assert.ok(await askCode(room.sender));
            room.sender.send(msg.renew());
            await advanceKeeping(server, RELEASE_MS + 10_000, [room]);
            assert.equal(hex(await room.sender.next()), hex([TYPE.CODE_GONE]));
            assert.ok(await askCode(room.sender));
            room.sender.send(msg.lock());
            room.sender.send(msg.code());
            assert.equal(hex(await room.sender.next()), hex([TYPE.CODE_IS, 0]), 'a locked room is given none');
        }), []);
        assert.deepEqual(await loggedBy(async () => {
            const given = await openRoom(server, { code: true });
            assert.ok(given.locator);
            const capped = await openRoom(server, { code: true });
            assert.equal(capped.locator, null);
            await closeRooms([given, capped]);
        }), [
            "[DEBUG] A direct transfer's room opened.", "[DEBUG] A direct transfer's room opened.", '[DEBUG] No code was free.',
            "[DEBUG] A direct transfer's room closed.", "[DEBUG] A direct transfer's room closed.",
        ]);
        await closeRooms([room]);
    });
});
