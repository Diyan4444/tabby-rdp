# Visual QA operations (Phase 1)

The dashboard runs **the actual Remote Desktop settings UI in a disposable Tabby profile**. It does not connect to
an RDP server. Phase 2 adds remote desktop coverage. Existing CDP suites remain available through `npm test`.

## Start and use

Requirements: Node 22 or newer, `npm ci`, and an installed Tabby. The existing runner finds Tabby at its standard
installation path; otherwise set `TABBY_BIN` to the executable. The checked-in baseline was reviewed on macOS arm64,
Tabby **1.0.236**, Electron **43.7.0**, xterm declaration **^6.0.0**. This is the installed build's reported identity,
not a qualification of every build with that version. Different hosts require their own reviewed baseline.

```sh
npm ci
npm run qa
# In a separate terminal, read the token printed only as a file path by the server:
cat .qa/token
```

Open <http://127.0.0.1:4317>, sign in with the token, and choose **Run visual test**. The server builds the current
checkout, starts the existing isolated test runner, and invokes Playwright against that Tabby's CDP port. Select
any run to see its status, source commit/dirty flag, duration, actual/expected screenshots, host metadata, execution
log, and Playwright HTML report. Open a test in the report and select its trace thumbnail to use the locally hosted
trace viewer. Downloadable `trace.zip` also works with `npx playwright show-trace <file>`.

The dashboard and all evidence are served locally. No screenshots or traces are uploaded to a third-party service.
DOM replay of Electron `file://` pages can have missing local fonts/icons; use the actual PNG and trace filmstrip
for pixel evidence. The trace still records real actions, timings, assertions, source and DOM snapshots.

The runner uses its existing credential guard and temporary profile; it disables update checks. Only one dashboard
run executes at a time; concurrent requests receive 409. Runs time out after 180 seconds. **Cancel run** terminates
execution and removes the disposable Tabby/profile. Use a dedicated checkout and avoid editing or invoking other
tests during a dashboard run: it tests the current working tree, not a separate immutable commit checkout.

## Central host and access

Keep one dashboard process on the chosen test machine with a persistent writable data directory. Configuration is
operator-controlled environment, never request parameters:

| Setting | Default | Purpose |
|---|---|---|
| `TRD_QA_PORT` | `4317` | Loopback HTTP port |
| `TRD_QA_DATA` | `.qa` in this checkout | Persistent run history and token |
| `TABBY_BIN` | Existing runner's platform default | Tabby executable |

Use an SSH tunnel to access a central host: `ssh -N -L 4317:127.0.0.1:4317 <qa-host>`, then open the same localhost URL.
The server deliberately listens only on `127.0.0.1`; it rejects other Host names and cross-origin mutations.
Token holders have the same operator privileges. There is no arbitrary command, argument, environment, baseline
update, or checkout endpoint. All results/artifacts require authentication, including the trace viewer. Browser
sessions last eight hours, use an HttpOnly/SameSite=Strict cookie, and expire on service restart. Restart after
rotating the token file. Keep this data directory and SSH account private.

For a persistent service, run `node /absolute/checkout/scripts/qa/server.mjs` under your existing user service manager,
with an absolute `TRD_QA_DATA` and `TABBY_BIN`. On macOS use a logged-in user LaunchAgent; on Linux use the documented
Xvfb/window-manager setup in `test/README.md` (the Tabby window must remain mapped). A server OS without a GUI session
cannot qualify the desktop application just by serving the dashboard. This phase was executed on macOS only; it
does not deploy a remote service or provision VMs.

On normal shutdown children are terminated. After an unexpected server exit, the runner watches its parent PID and
cleans up Tabby. Restart marks unfinished records as **Infrastructure failure**, never Passed. Completed records and
artifacts survive restart. A PID lock prevents two servers sharing one data directory. If a stale PID was reused by
another process, inspect it before removing `server.pid`.

## Results and storage

Each `.qa/runs/<id>/` holds `run.json`, `results.json`, bounded `execution.log`, independent copies of attachments in
`evidence/`, raw Playwright `artifacts/`, and the self-contained `report/`. Back up/restore these directories together.
The result index is atomically replaced. Passed requires an executed passing test with actual screenshot and trace
files, a passing reporter result, and exit zero. Failed assertions, skipped tests, launch/build/report failures,
not-executed tests, and cancellation remain distinct. A missing baseline is an explicit failing visual assertion.

There is a 100-run capacity limit and a 2 MB log limit per command. Archive/remove old completed run directories
while the service is stopped when it reaches capacity. Nothing silently deletes failure evidence. Automatic
retention, broader suites, CI artifact ingestion and long-term trends belong to later phases.

## Baselines and local commands

```sh
npm run test:visual       # build + real Tabby screenshot check, no baseline writes
npm run qa:baseline       # explicitly create/update this platform + host runtime baseline
npm run test:qa           # HTTP controls, lifecycle/recovery and result-classification tests
npm run typecheck
```

`qa:baseline` is a local maintainer action. Inspect every changed PNG in `test/visual/baselines/`, explain the change,
and commit it through review. Normal execution, including a missing baseline, never writes baselines. Dashboard
children explicitly disable baseline updates even if the parent environment requested them.

The checkpoint is the visible 1100×800 settings viewport at device scale 1, with animations disabled and caret hidden.
There are zero allowed differing pixels (Playwright's default per-pixel perceptual threshold), zero retries, and a
pinned Playwright version in the lockfile. Baselines are keyed by OS, architecture, Tabby version and Electron version.
Compare only under the same theme/fonts/runtime; this phase does not provision those dependencies on other hosts.

## Repeat the browser acceptance demonstration

Start the dashboard, then:

```sh
npx playwright install chromium
node scripts/qa/acceptance.mjs
# Or use an already installed browser by setting TRD_QA_BROWSER to its executable.
```

This signs in through the UI, clicks Run, waits for Passed, verifies screenshot loading, opens the HTML report and
its trace viewer, verifies the recorded screenshot assertion, and checks the dashboard at 390 px width. It writes
`acceptance.json`, `dashboard-acceptance.png`, `dashboard-mobile.png`, and `trace-acceptance.png` to the data directory.
A fresh run consumes one history slot. The dashboard itself needs no downloaded Playwright browser: its test attaches
to the existing Tabby. Only this browser acceptance script needs Chromium/Chrome.
