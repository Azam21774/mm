// Dedicated Node worker: no HTTP listener, all commands/events travel over IPC.
const backend = require('./index');
const { commands, events } = require('./ipc/commands');

const send = (message) => {
  if (process.connected) process.send(message, () => {});
};
for (const name of events) {
  backend.events.on(name, (payload) => send({ type: 'event', name, payload }));
}
process.on('message', async (message) => {
  if (message?.type !== 'request' || typeof message.id !== 'string') return;
  try {
    if (!commands.includes(message.command)) throw new Error('Unknown backend command');
    const result = await backend.execute(message.command, message.payload);
    send({ type: 'response', id: message.id, result });
  } catch (error) {
    send({ type: 'response', id: message.id, error: error.message || 'Backend command failed' });
  }
});
process.on('disconnect', () => process.exit(0));
// Puppeteer installs signal listeners when it launches Chromium. Explicitly exit
// as well so a stopped worker cannot stay alive after the browser is closed.
process.once('SIGTERM', () => process.exit(0));
process.once('SIGINT', () => process.exit(0));
process.on('uncaughtException', (error) => {
  console.error('Backend worker crashed:', error);
  process.exit(1);
});
send({ type: 'ready' });
