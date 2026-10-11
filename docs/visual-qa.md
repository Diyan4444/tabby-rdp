# Visual QA operations (Phases 1–2)

The dashboard runs the local settings UI or **real Windows 11 / Ubuntu GNOME RDP desktops through Tabby and IronRDP** in a disposable Tabby profile. Select an environment before running. Existing CDP suites remain available through `npm test`.

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
run executes at a time; concurrent requests receive 409. Host runs time out after 180 seconds; RDP runs after 300 seconds. **Cancel run** terminates
execution and removes the disposable Tabby/profile. Use a dedicated checkout and avoid editing or invoking other
tests during a dashboard run: it tests the current working tree, not a separate immutable commit checkout.

## Central host and access

Keep one dashboard process on the chosen test machine with a persistent writable data directory. Configuration is
operator-controlled environment, never request parameters:

| Setting | Default | Purpose |
|---|---|---|
| `TRD_QA_PORT` | `4317` | Loopback HTTP port |
| `TRD_QA_DATA` | `.qa` in this checkout | Persistent run history and token |
| `TRD_QA_ENV_FILE` | unset | Private operator JSON containing string `TRD_TEST_*` settings |
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
does not deploy the dashboard as a remote service. Dedicated Linux and Windows guests were provisioned separately for Phase 2.

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

The local settings checkpoint is the visible 1100×800 settings viewport at device scale 1, with animations disabled and caret hidden.
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
`<test>-acceptance.json`, `<test>-dashboard.png`, `<test>-mobile.png`, and `<test>-trace.png` to the data directory.
A fresh run consumes one history slot. The dashboard itself needs no downloaded Playwright browser: its test attaches
to the existing Tabby. Only this browser acceptance script needs Chromium/Chrome.

## Dedicated real RDP environments

Use dedicated guests/accounts; these tests open a fullscreen fixture, resize the session and reconnect it. Do not
point them at a desktop someone is using. Provision Ubuntu with `testbed/linux/libvirt.sh` and `provision.sh`; the
libvirt script now selects amd64/arm64, verifies the downloaded image against Canonical's SHA256 manifest, accepts
`UBUNTU_IMAGE_BUILD=20260926` for a dated image and `TEST_SSH_KEY=/absolute/key` for provisioning. The GUI fixture
requires GTK 3, Python GI/Cairo and DejaVu Sans, installed by `provision.sh`. Keep networkd as the explicit cloud
image renderer; defer package-triggered service restarts until reboot so provisioning does not lose SSH.

Provision Windows 11 Pro with `testbed/windows/setup.ps1`, which accepts `-PasswordFile` to avoid putting a new test
account password in the command line. The test account needs RDP and WinRM permissions, and its SSH jump host needs
pywinrm (`provision.sh` installs it in `/opt/tabby-rdp-test/winrm`). Windows credentials are delivered through the
existing raw CDP/SSH helpers, with the disposable credential guard; Playwright tracing begins after sign-in.
Restrict WinRM/RDP to the isolated VM network and reach it through SSH.

Example private `.qa/private/environments.json` (replace all placeholders; chmod 600, parent directory 700):

```json
{
  "TRD_TEST_HOST": "127.0.0.1",
  "TRD_TEST_PORT": "2226",
  "TRD_TEST_USER": "ubuntu",
  "TRD_TEST_SSH_KEY": "/absolute/private/qa-key",
  "TRD_TEST_WIN_SSH_HOST": "127.0.0.1",
  "TRD_TEST_WIN_SSH_USER": "ubuntu",
  "TRD_TEST_WIN_ADDRESS": "<windows-private-ip>:3389",
  "TRD_TEST_WIN_USER": "tabbyrdp",
  "TRD_TEST_WIN_PASSWORD": "<dedicated-test-password>",
  "TRD_TEST_WIN_WINRM": "<windows-private-ip>:5985"
}
```

Forward the SSH transport with `ssh -N -L 127.0.0.1:2226:<ubuntu-private-ip>:22 <qa-host>`, then start:

```sh
TRD_QA_ENV_FILE="$PWD/.qa/private/environments.json" npm run qa
```

The JSON is read only at startup and is never returned by the API. Alternatively set the existing `TRD_TEST_*`
environment variables directly. The catalog reports missing setting names, not their values. **Configured** means
settings exist, not that the VM is reachable. Only an executed passing run establishes health. A missing setting,
failed connection or failed fixture setup produces Infrastructure failure, never Passed. Token holders cannot edit
configuration or supply commands. Protect the data directory: remote addresses and guest diagnostic details can
appear in authenticated artifacts even though credentials are excluded.

For CLI execution, export the same variables, build, then use `npm test -- --hidden visual-linux` or
`visual-windows`. Explicit reviewed baseline creation is `npm run qa:baseline -- visual-linux` (or `visual-windows`).
The baseline command uses exported environment variables, not the dashboard's private JSON. Browser acceptance is
`node scripts/qa/acceptance.mjs visual-linux` or `visual-windows` against the running dashboard.

## RDP assertions and evidence

The versioned fixtures in `test/fixtures/visual/` own the fullscreen background, fonts, shapes, gradient, color
references, text and input marker. Independent remote JSON reports sequence, input source, dimensions and scale.
The real client framebuffer must agree with this state, four corner markers and the sequence tile. RDP mouse and
keyboard input must change both remote state and visible pixels. Baselines cover initial 800×600, tab return at
800×600, resize to 900×650 and reconnect. Device/remote scale is 1; H.264, clipboard, audio and microphone are off.
The OS shell at initial connection is captured as evidence but is not a stable regression baseline.

Each checkpoint retains decoded raw canvas and final visible canvas screenshots; Windows also captures the guest
screen using CopyFromScreen in the same interactive RDP session. Ubuntu Wayland currently has independent fixture
state, **not an independent guest pixel oracle**. Guest images supplement diagnosis; they are not silently accepted
as new baselines. The fixture automatically exits after five minutes and normally removes its own task/process and
temporary directory during cleanup. Forced cancellation may leave that directory until operator cleanup; it cannot
keep the fixture running indefinitely.

Resize additionally records twelve bounded observations, targeting 500 ms spacing (guest-oracle calls can extend it), including raw/visible filmstrips,
remote state, geometry, sampled RGBA and client monotonic timestamps/capture cost. A Windows guest-screen capture is also retained midway through the transition. The final four samples must be
correct; a later invalid sample after the first correct repaint fails. Transient settling is retained explicitly.
The five point samples do not quantify whole-frame damage area or prove all text remains readable; screenshot
comparison supplies broader spatial coverage at settled checkpoints. These observations do not infer presentation
from decoder counters or equate remote and local clocks. Every lifecycle has zero retries.

The dashboard shows current per-environment run status, the latest actual preview, checkpoints, reports and traces.
Expand **Raw canvas and resize filmstrip** for transition evidence. A later passing run does not overwrite a failure.
Broader Section 5 scenarios (simultaneous sessions, non-default DPI, clipboard, window movement, rapid animation,
long idle), H.264 controls and detailed invalid-region area/recovery metrics remain unimplemented coverage.

## Phase 2 testbed provenance

The executed Ubuntu guest uses the Canonical 24.04 ARM64 cloud image dated 20260926, GNOME Remote Desktop
46.3-0ubuntu1.2 and the installed package/font versions recorded in each report. Pin/retain the VM image and package
manifest when reproducing baselines; a package upgrade requires fresh review. Windows uses a fresh Windows 11 Pro
ARM64 guest, build 26300.9457, secure AAVMF, TPM 2 and signed virtio-win 0.1.285-1 NetKVM/vioscsi drivers. Windows
installation on this ARM host needed manual WinPE image application plus driver injection and the existing
specialize/OOBE answer file; the repository's x86 Windows libvirt script is not claimed to automate ARM installation.

The reused Microsoft installer remains `.UNVERIFIED`: its SHA256
`8992f2d2cfd2fa647e579e9eb31fc21f34da8333c29b6170fde17d2ed6623e9c` matches the published Arabic row despite
English API/WIM identification, and differs from the published English row. This disclosed inherited provenance
limitation is retained for this isolated testbed; it is not verified English media. No repository checksum gate was
weakened. New VM disks and credentials were created; another thread's existing guest was not modified. Private VM
addresses, credential paths and installation receipts are in ignored `.qa/private/` on the operator machine.

A separate thread observed persistent black center samples after Windows H.264 resize, with decoder activity and
recovery on reconnect. It did not establish full-screen blackness or a client-side cause. This suite's non-H.264
passes do not resolve that observation. Its follow-up requires same-session guest pixels during the failure,
spatial damage measurement and repaint/resize/reconnect recovery controls; preserve the original failure evidence.
