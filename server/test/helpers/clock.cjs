// Test-only preload: lets a test move the server's Date.now() forward over IPC,
// so time-based cleanup can be exercised without waiting for real minutes.
const realNow = Date.now;
let offsetMs = 0;

Date.now = () => realNow() + offsetMs;

process.on('message', (msg) => {
    if (msg && msg.type === 'advance-clock') {
        offsetMs += msg.ms;
        process.send({ type: 'clock-advanced', offsetMs });
    }
});
