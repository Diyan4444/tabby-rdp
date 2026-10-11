# Visual QA operations (Phases 1–2)

The dashboard runs native macOS, Windows and Linux Tabby clients against **real Windows, GNOME/GRD and Xfce/xrdp desktops through IronRDP**, plus local settings checks. Select a client/desktop combination before running. Existing CDP suites remain available through `npm test`.

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
DOM replay of Electron `file://` pages can have missing local fonts/icons and a checkerboard canvas placeholder; use the actual PNG and trace filmstrip
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
`<test>-acceptance.json`, `<test>-dashboard.png`, `<test>-mobile.png`, `<test>-mobile-evidence.png`, and `<test>-trace.png`
to the data directory. Mobile captures are bounded overview/evidence views so growing history does not require a huge screenshot.
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
The first decoded frame (which can still show the Windows sign-in transition) is captured as connection evidence, not a stable regression baseline.

Each checkpoint retains decoded raw canvas and final visible canvas screenshots; Windows also captures the guest
screen using CopyFromScreen in the same interactive RDP session. Ubuntu Wayland currently has independent fixture
state, **not an independent guest pixel oracle**. Guest images supplement diagnosis; they are not silently accepted
as new baselines. The fixture automatically exits after five minutes and normally removes its own task/process and
temporary directory during cleanup. Forced cancellation may leave that directory until operator cleanup; it cannot
keep the fixture running indefinitely.

Resize additionally records twelve bounded observations, targeting 500 ms spacing (guest-oracle calls can extend it), including raw/visible filmstrips,
remote state, geometry, sampled RGBA and client monotonic timestamps/capture cost. A Windows guest-screen capture is also retained midway through the transition. The final four samples must be
correct; a later invalid sample after the first correct repaint fails. Transient settling is retained explicitly.
Measured clean runs: Linux collected twelve observations over 5.5 s; Windows took 39 s because each WinRM state read costs about 2.4 s and the guest-image observation cost 11.9 s. These are bounded observations, not exact repaint timing or high-frequency Windows coverage. The five point samples do not quantify whole-frame damage area or prove all text remains readable; screenshot
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

## Native client and desktop matrix

The fixed catalog now separates the **native Tabby client** (macOS, Windows, Linux) from the **remote RDP desktop**:
Ubuntu 24.04 / GNOME 46, Fedora 44 / GNOME 50, Debian **13.7** / GNOME 48, Rocky Linux 9 / Xfce / xrdp, and Windows 11. Each client also has a local
settings test. macOS is a Tabby client target; this does not promise a native macOS RDP server. Windows → Windows needs
a separate Windows server from the client VM for independent coverage. The original three Phase 1/2 IDs remain available.

The test reads the actual Tabby process's platform/architecture, checks its installed plugin bytes against the current
build, then verifies `/etc/os-release`, Debian's point release, GNOME Shell and GNOME Remote Desktop versions (or the
Windows edition/build, or Rocky/Xfce/xrdp/xorgxrdp versions). A wrong version fails preparation. Screenshot keys include **observed** desktop/distro, GNOME/GRD or Xfce/xrdp/xorgxrdp
versions, client OS/architecture, Tabby and Electron. Updating a VM therefore requires explicit baseline review.

Configure matrix cells with a private JSON file, selected by `TRD_QA_TARGETS_FILE` on both dashboard and baseline commands:

```json
{
  "visual-macos-fedora44": {
    "TRD_TEST_HOST": "127.0.0.1",
    "TRD_TEST_PORT": "2229",
    "TRD_TEST_USER": "fedora",
    "TRD_TEST_SSH_KEY": "/private/path/test-key"
  },
  "visual-windows-ubuntu2404": {
    "TRD_TEST_CLIENT_CDP_PORT": "9336",
    "TRD_TEST_HOST": "192.0.2.10",
    "TRD_TEST_PORT": "22",
    "TRD_TEST_USER": "ubuntu",
    "TRD_TEST_SSH_KEY": "C:\\TabbyVisualQA\\ssh-key"
  },
  "visual-macos-host": {},
  "visual-linux-host": { "TRD_TEST_CLIENT_CDP_PORT": "9337" }
}
```

The addresses and SSH key paths are **as seen by the native Tabby client**, while `TRD_TEST_CLIENT_CDP_PORT` is an
SSH-forwarded loopback port on the dashboard/test-driver machine. Windows desktop cells use the same `TRD_TEST_WIN_*`
variables documented above. Matrix cells do not inherit any `TRD_TEST_*` settings from other cells or the legacy environment
file. Absent cells display Not configured / Not executed. Configuration alone is never passing coverage. Keep both private
JSON files mode 0600; restart the dashboard after changing them. HTTP callers can select only fixed IDs, never configuration.

### Dedicated native clients

Run `node scripts/qa/bundle-client.mjs` to build an installation directory containing only the plugin, its runtime
dependencies, the launcher and credential guard. Copy that directory to each dedicated client VM. Install a checksum-verified
Tabby release there, plus Node 18 or newer. The initial Linux/Windows clients use checksum-verified official 1.0.236
ARM64 binaries (xterm ^5); the existing macOS installation reports 1.0.236 with xterm ^6.0.0. All report Electron 43.7.0.
Those are separate observed builds, not a claim that the same version label means identical host contents. Start:

```sh
node scripts/qa/client.mjs /path/to/Tabby /path/to/client-bundle 9335
```

The launcher creates a temporary profile, disables analytics/updates, installs the same test-only credential guard used by
`test/run.ts`, keeps the native window mapped, and removes its profile/process tree when stopped. It stays alive for the
operator-managed CDP session; stop it after testing. Rebuild and redeploy the bundle after plugin changes. A stale bundle
fails the content check, even if its package version is unchanged. The dashboard executes the existing suites using `--port`,
with screenshots, traces and reports remaining on the central test driver. It does not install or remotely launch clients.

On Linux, install Xvfb and xfwm4 and start them on a dedicated display (for example `:91`, 1280×1024×24, `-nolisten tcp`).
Run both xfwm4 and the launcher with `DISPLAY=:91`. Use the distribution package's correctly owned/mode-4755
`chrome-sandbox`; the tested ARM64 package needed its permissions corrected. Forward CDP through SSH to the **guest's
loopback**, not its network address. Keep the window mapped; minimize/unmap can stop Chromium's animation frames.

On Windows, install Microsoft's signed ARM64 Visual C++ redistributable before the portable ARM64 Tabby build (otherwise
`russh.win32-arm64-msvc.node` fails to load). Run the launcher as the dedicated interactive test user, for example with an
interactive-token scheduled task. A WinRM service session cannot supply that desktop. If SSH is unavailable on Windows,
a `netsh interface portproxy` can forward the guest address to loopback CDP: firewall that port to the libvirt host alone,
then SSH-forward it from that host. Remove the firewall rule, portproxy and task at teardown. Never publish CDP to a LAN.

```sh
TRD_QA_TARGETS_FILE=/private/targets.json node scripts/qa/baseline.mjs visual-linux-fedora44
# Review new baseline PNGs, then use the dashboard (baseline updates always disabled):
TRD_QA_TARGETS_FILE=/private/targets.json npm run qa
TRD_QA_BROWSER=/path/to/chrome node scripts/qa/acceptance.mjs visual-linux-fedora44
```

### Additional Linux guests

Run on an isolated libvirt host with the existing public test key:

```sh
TEST_DISTRO=ubuntu2404 testbed/linux/libvirt.sh qa-ubuntu /path/test-key.pub
TEST_DISTRO=debian13 testbed/linux/libvirt.sh qa-debian /path/test-key.pub
TEST_DISTRO=fedora44 testbed/linux/libvirt.sh qa-fedora /path/test-key.pub
```

The provisioner selects distro-specific cloud images/packages/users (`ubuntu`, `debian`, `fedora`), verifies the exact image
against its vendor's HTTPS checksum manifest, and refuses existing VM names. Debian defaults to the current trixie image;
`DEBIAN_IMAGE_BUILD` and `UBUNTU_IMAGE_BUILD` can pin dated images. The runtime matrix requires Debian 13.7 exactly and will
reject a later point release until deliberately updated. Fedora pins image 44-1.7. Provisioning suppresses welcome tours,
notification banners and animations only for the dedicated test user. The fixture dismisses GNOME's startup overview through
real RDP Escape input. A failed assertion retains raw, visible and final-window evidence before cleanup.

On the tested ARM host, Fedora's shim was rejected by the installed Secure Boot firmware. The disposable Fedora test VM
uses non-Secure-Boot AAVMF; its image checksum was still verified. `TEST_SECURE_BOOT=0` explicitly requests UEFI without
Secure Boot for that case. This matrix does not qualify Secure Boot. Debian's initial provision attempt stopped before reboot
on an unsupported `grdctl --version`; package-version reporting now uses dpkg/rpm. Linux fixture VMs omit the
unnecessary virtual TPM: the tested Debian ARM kernel exposed no `/dev/tpmrm0` for the default device, causing a
90-second systemd device wait before SSH. The provisioner also freezes cloud-init before ejecting its seed. MAC-based DHCP with explicit
networkd prevents its desktop packages from changing the address. Reboot after provisioning so the installed user D-Bus
services are present before the first GNOME setup. The Debian and Fedora guests were reboot-checked.

The Windows test guests are unactivated. An activation watermark appeared on the older VM during preparation; it remains
in the retained evidence. Final matrix cells use the separate server VM. No licensing bypass or watermark masking is
performed. If activation state or another OS overlay changes later, strict comparisons can fail and require environment
review. The Phase 2 Windows installation-media provenance limitation also carries forward to the offline server clone.

### Rocky Linux 9 / Xfce / xrdp

The existing `test/suites/xrdp.ts` covers functional xrdp behavior on a GNOME/Xfce host. The new Rocky visual cells
exercise a separate Xfce-only server through the same visual fixture and screenshot/report pipeline, on all three native clients.

```sh
TEST_DISTRO=rocky9 TEST_XRDP_PASSWORD_FILE=/private/rocky-password \
  testbed/linux/libvirt.sh qa-rocky /path/test-key.pub
```

The private password file contains one password and a newline. Provisioning sends it over SSH stdin, installs
Xfce/xrdp/xorgxrdp from Rocky/EPEL with CRB enabled, and creates `tabbyxrdp` with the supplied SSH keys.
The Rocky image is pinned to `9.8-20260525.0` (`ROCKY_IMAGE_BUILD` can override it); its vendor SHA256 manifest is checked.
Sources: [Rocky Xfce setup](https://docs.rockylinux.org/9/guides/desktop/xfce_installation/),
[Rocky cloud images](https://download.rockylinux.org/pub/rocky/9/images/aarch64/),
[EPEL xrdp package](https://packages.fedoraproject.org/pkgs/xrdp/xrdp/epel-9.html).

Rocky's xrdp service starts at boot and listens only on guest loopback port 3390; Tabby reaches it through SSH.
SELinux remains enforcing. Its tested versions are Rocky **9.8**, Xfce **4.18.3**, xrdp **0.10.6.1**, xorgxrdp **0.10.5**.
Each `visual-{macos,windows,linux}-rocky9` target supplies `TRD_TEST_USER=tabbyxrdp`, `TRD_TEST_XRDP_USER=tabbyxrdp`,
`TRD_TEST_XRDP_PASSWORD`, and the existing SSH settings as seen by that client. The test verifies real xrdp discovery,
exercises its certificate-bound non-NLA consent through the normal UI, and locates the actual Xfce/Xorg session.
It requires xrdp 0.10 or newer for live resize, reuses the GTK fixture on X11, and closes the test's Xfce session during normal cleanup.
Forced cancellation can leave that account's Xfce session until operator cleanup; the fixture itself times out after five minutes.
Remote JSON and client screenshots are captured; no independent Linux guest pixel oracle is claimed.

Fedora KDE Plasma/KRDP is the planned third Linux RDP stack in [the plan](VISUAL-QA-PLAN.md#planned-third-linux-stack--fedora-kde-plasma--krdp).
It remains Pending and has no passing dashboard cell. Its session and H.264 requirements must be qualified separately.

### Executed matrix (2026-10-11)

All 18 browser workflows passed on clean commits `43a487f` / `8c4dd7c`, with identical RDP implementation and plugin content,
zero lifecycle retries and baseline writes disabled. Only the mobile acceptance capture helper changed between those commits.

| Native Tabby client | Settings | Ubuntu / GNOME 46 | Fedora / GNOME 50 | Debian 13.7 / GNOME 48 | Rocky 9 / Xfce / xrdp | Windows 11 |
|---|---|---|---|---|---|---|
| macOS ARM64 | Pass | Pass | Pass | Pass | Pass | Pass |
| Windows ARM64 | Pass | Pass | Pass | Pass | Pass | Pass |
| Linux ARM64 (Ubuntu) | Pass | Pass | Pass | Pass | Pass | Pass |

Exact run IDs, validation, cleanup and remaining limits are in [the plan handoff](VISUAL-QA-PLAN.md#phase-2-extension--distro-and-native-client-coverage-2026-10-11).
These are fifteen RDP lifecycles and three local UI checks, not x86_64 or H.264 qualification. macOS is a native client target;
Linux and Windows supply the remote server roles. Native Linux runs in Xvfb, separately from its host's GRD session.
Dedicated native clients remain running for dashboard use; their launcher/operator owns shutdown and profile cleanup.

To repeat the whole matrix against the configured dashboard, serialize it:

```sh
for client in macos windows linux; do
  for desktop in host ubuntu2404 fedora44 debian13 rocky9 windows11; do
    node scripts/qa/acceptance.mjs "visual-$client-$desktop" || exit
  done
done
```

Each run consumes one of the dashboard's 100 history slots. Keep previous failure evidence when archiving history.
