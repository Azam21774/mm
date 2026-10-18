# MyMail desktop

The desktop backend uses IPC, with this process boundary:

```text
React UI → preload bridge → Electron main → Node worker
React UI ← progress events ← Electron main ← Node worker
```

`index.js` registers backend commands without opening an HTTP listener.
`server-process.js` runs those commands in a separate process so Puppeteer,
attachment generation, and sending do not block Electron's main event loop.
`ipc/worker-client.js` correlates concurrent requests and handles startup failures,
request timeouts, and interrupted operations. Jobs are never automatically retried.

`preload.js` exposes explicit `desktopBackend` methods and allowlisted event
subscriptions. The main process checks the caller and active license before
forwarding commands. Clearing/deactivating the license stops the worker and
rejects pending operations. Chrome windows retain their existing detached
lifecycle and can be reattached when the worker starts again.

Attachments cross IPC as binary data, with a 100 MB per-file limit and filename
validation. Requests return `{ status, data }`; the frontend adapter converts
failed status codes into errors. Ordinary commands have a two-minute response
timeout; `sendMails` allows 24 hours. A response timeout does not cancel the
operation—check progress or use the stop control before retrying.

## Development and verification

- `npm run dev`: start Next.js and Electron together.
- `npm test`: backend utilities, IPC lifecycle, and real worker integration tests.
- `npm run test:electron`: isolated Electron smoke test using a mocked license
  service; checks the real preload/main/worker boundary without sending mail.
- `node scripts/build-frontend.js`: build and copy the frontend export into `out`.
- `npm run build`: build the frontend and package the desktop application.

The packaged app still serves its static frontend from loopback HTTP to preserve
Next.js routes and existing browser storage behavior. That host exposes no backend
API or license status endpoint. Development still uses the Next.js server.
Remote admin/licensing and Google APIs continue to use HTTP, and Chrome automation
still uses Chrome's DevTools connection. Backend commands are desktop-only; a
standalone browser cannot invoke the IPC bridge.
