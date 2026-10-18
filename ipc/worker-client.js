const { fork } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { commands, events } = require('./commands');

class WorkerClient {
  constructor(workerPath, { onEvent = () => {}, onExit = () => {}, forkWorker = fork, startupTimeout = 30000 } = {}) {
    Object.assign(this, { workerPath, onEvent, onExit, forkWorker, startupTimeout });
    this.child = null;
    this.ready = null;
    this.pending = new Map();
  }

  start() {
    if (this.ready) return this.ready;
    let child;
    try {
      child = this.forkWorker(this.workerPath, [], {
        stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
        serialization: 'advanced',
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      });
    } catch (error) {
      return Promise.reject(error);
    }
    this.child = child;
    this.ready = new Promise((resolve, reject) => {
      const timer = setTimeout(() => fail(new Error('Backend worker startup timed out')), this.startupTimeout);
      const fail = (error) => {
        clearTimeout(timer);
        reject(error);
        if (this.child !== child) return;
        this.child = null;
        this.ready = null;
        for (const pending of this.pending.values()) pending.reject(error);
        this.pending.clear();
        child.kill();
        this.onExit(error);
      };
      this.fail = fail;
      child.on('error', fail);
      child.on('exit', () => fail(new Error('Backend worker exited; unfinished operations were interrupted.')));
      child.on('disconnect', () => fail(new Error('Backend worker disconnected.')));
      child.on('message', (message) => {
        if (this.child !== child) return;
        if (message?.type === 'ready') {
          clearTimeout(timer);
          resolve();
        } else if (message?.type === 'event' && events.includes(message.name)) {
          this.onEvent(message.name, message.payload);
        } else if (message?.type === 'response') {
          const pending = this.pending.get(message.id);
          if (!pending) return;
          this.pending.delete(message.id);
          if (message.error) pending.reject(new Error(message.error));
          else pending.resolve(message.result);
        }
      });
    });
    return this.ready;
  }

  async request(command, payload = {}, timeoutMs) {
    if (!commands.includes(command)) throw new Error('Unknown backend command');
    // Requests never restart an unlicensed/stopped worker implicitly.
    const child = this.child;
    if (!child || !this.ready) throw new Error('Backend is unavailable. Refresh the desktop license to reconnect.');
    await this.ready;
    if (this.child !== child || !child.connected) throw new Error('Backend is unavailable.');
    const timeout = timeoutMs ?? (command === 'sendMails' ? 24 * 60 * 60 * 1000 : 120000);
    return new Promise((resolve, reject) => {
      const id = randomUUID();
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('Backend response timed out. The operation may still be running; check progress before retrying.'));
      }, timeout);
      const finish = (callback) => (value) => { clearTimeout(timer); callback(value); };
      this.pending.set(id, { resolve: finish(resolve), reject: finish(reject) });
      const failed = (error) => {
        if (!error) return;
        const pending = this.pending.get(id);
        this.pending.delete(id);
        pending?.reject(error);
      };
      try { child.send({ type: 'request', id, command, payload }, failed); }
      catch (error) { failed(error); }
    });
  }

  stop() {
    if (this.child) this.fail(new Error('Backend stopped; unfinished operations were interrupted.'));
  }
}
module.exports = { WorkerClient };
