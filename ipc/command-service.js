const { EventEmitter } = require('node:events');

// A transport-independent command registry. Replies retain status/data so callers
// can distinguish validation failures from transport failures.
function createCommandService() {
  const handlers = new Map();
  const events = new EventEmitter();
  return {
    events,
    register(name, handler) {
      if (handlers.has(name)) throw new Error(`Duplicate command: ${name}`);
      handlers.set(name, handler);
    },
    async execute(name, payload = {}) {
      if (!handlers.has(name)) throw new Error(`Unknown command: ${name}`);
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        throw new Error('Command payload must be an object');
      }
      return new Promise((resolve, reject) => {
        const reply = new EventEmitter();
        let status = 200;
        reply.headersSent = false;
        reply.status = (value) => { status = value; return reply; };
        reply.send = (data) => {
          if (reply.headersSent) return reply;
          reply.headersSent = true;
          resolve({ status, data });
          return reply;
        };
        // Some commands acknowledge immediately and continue work (sendDrafts).
        // Preserve that behavior while still catching errors and cleaning up.
        Promise.resolve().then(() => handlers.get(name)(payload, reply))
          .then(() => {
            if (!reply.headersSent) reply.send({ status: true });
          })
          .catch((error) => {
            if (!reply.headersSent) reject(error);
            else console.error(`Background command ${name} failed:`, error);
          })
          .finally(() => reply.emit('finish'))
          .catch((error) => console.error(`Command ${name} cleanup failed:`, error));
      });
    },
  };
}
module.exports = { createCommandService };
