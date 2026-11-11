// Test-only preload: lets a test ask the server, over IPC, how much its
// rendezvous holds right now (rendezvous.js' held(): how many sockets, rooms
// and attempts), so it can check nothing is left once they've ended.
//
// It catches the rendezvous as server.js makes it, without changing it: when
// rendezvous.js is loaded, its createRendezvous() is wrapped to keep what it
// returns. A server with direct transfer off has none, and answers null.
const Module = require('node:module');
const path = require('node:path');

let rendezvous = null;

const realLoad = Module._load;
Module._load = function load(request, parent, ...rest) {
    const exported = realLoad.call(this, request, parent, ...rest);
    if (path.basename(request, '.js') === 'rendezvous' && typeof exported?.createRendezvous === 'function' && !exported.createRendezvous.wrapped) {
        const create = exported.createRendezvous;
        exported.createRendezvous = Object.assign((...args) => (rendezvous = create(...args)), { wrapped: true });
    }
    return exported;
};

process.on('message', (msg) => {
    if (msg && msg.type === 'rendezvous-held') process.send({ type: 'rendezvous-held', held: rendezvous ? rendezvous.held() : null });
});
