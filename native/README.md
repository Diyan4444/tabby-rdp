# FreeRDP preview

Settings › Remote Desktop › Settings › **RDP client** selects the default client. RDP profiles and the add/edit
desktop form have an override. An empty override follows Settings. Existing configurations continue to use IronRDP.
Changes apply on the next connection; use Reconnect to compare clients on the same desktop. Accounts, certificate
trust and desktop identities are shared between the clients.

The initial FreeRDP preview renders inside the Tabby tab and supports keyboard, mouse, Unicode input, view only,
screenshots, scaling, reconnect and the display-control channel. It uses the plugin's existing direct, SSH and RD
Gateway transports, credential store and certificate/NLA prompts. Each attempt has its own native process.

The preview does **not** yet implement clipboard, audio playback/capture, shared folders, or Hyper-V VMConnect.
The supplied build uses native bitmap decoding (and the graphics pipeline for GNOME), with optional H.264 codecs
disabled. NLA currently uses NTLM; Kerberos/GSSAPI support is not compiled into this preview. Hyper-V consoles that
inherit the global client setting continue to use IronRDP. It has not been benchmarked against IronRDP on Windows Server. Native decoding alone does not establish
that this implementation will be faster: the cost of transferring pixels to the canvas also matters.

## Build

Build on each intended OS and CPU architecture. Requires Node 18+, CMake, a C compiler and an OpenSSL 3 development
installation with its license text. macOS also needs Xcode command-line tools; Linux needs `patchelf`; Windows
needs an MSVC developer shell (including `dumpbin`) and an OpenSSL installation/toolchain for the target architecture.

```sh
npm run build:freerdp -- --openssl-prefix /path/to/openssl3
npm run build
```

On macOS, omitting `--openssl-prefix` uses `brew --prefix openssl@3`. Additional arguments are passed directly to
CMake, e.g. `-DCMAKE_TOOLCHAIN_FILE=/path/to/vcpkg.cmake`. Build from this repository checkout; an installed npm
package does not contain the build tools or native source.

The script downloads the source archive identified by `freerdp-source.json`, verifies its pinned SHA-256, and builds
an unmodified FreeRDP with `options.cmake`. Build tools and source stay under `.qa/freerdp-build`. The output is
`native/bin/<platform>-<arch>/`, including the helper, its FreeRDP/WinPR/OpenSSL libraries and NTLM's required OpenSSL
legacy provider, license notices and a
`BUILD.json` with source identity and artifact hashes. macOS libraries are relocated beside the executable and signed
ad hoc; the helper does not depend on a user's Homebrew directory. Linux builds require a compatible target distro's
system ABI; Windows requires the applicable Microsoft C runtime. Builds for other platforms are independent.

No native executable is downloaded or compiled when Tabby loads the plugin. Selecting FreeRDP without the matching
helper produces an installation message before asking for credentials. It does not silently change to IronRDP.

`native/bin` is generated and ignored by Git, but included by `npm run pack:release` when present. For a public release, qualify
each intended platform/architecture and explicitly include the reviewed native outputs in the release commit
(`git add -f native/bin/<platform>-<arch>`). The existing package checks require distributed files to match the
release commit. A build on one computer supplies only that computer's platform/architecture.

The PR's **Build and package** CI job uploads **tabby-rdp-test-package**, a ZIP containing the plugin's npm tarball.
This is a plugin build for an existing Tabby installation. It does not create a release or publish to npm. The
current PR includes the macOS ARM64 helper; Windows, Linux and Intel Mac FreeRDP builds remain pending. IronRDP
remains available on those platforms. The package version is prepared as `0.6.0-rc.1`; tagging and publication wait
for further analysis and manual testing.

## Licensing

The Tabby helper is MIT licensed. FreeRDP and WinPR are Apache-2.0; OpenSSL 3 is Apache-2.0. Their full licenses and
FreeRDP's bundled attribution notice accompany the generated binaries. Keep these files in the published package.
The source/build identity is recorded in `BUILD.json`. New codecs, channels or native dependencies require reviewing
their own licensing and updating the packaging inventory; changing FreeRDP's top-level license file is insufficient.

## Verification

```sh
npm run typecheck
npm run test:unit
npm test -- --hidden visual-smoke
# With TRD_TEST_DIRECT, TRD_TEST_DIRECT_USER and TRD_TEST_DIRECT_PASSWORD for a dedicated server:
npm test -- --hidden freerdp
# Verify the installed tarball as well, including executable permissions and relocated native libraries:
npm test -- --packed --hidden freerdp
```

The FreeRDP unit tests run framing, bounds, keyboard and authenticated-relay tests on every platform. When the
helper exists, they additionally run real native TLS/NLA certificate-rejection tests, verifying that no username
routing cookie or authentication payload reaches a rejected peer. Real Windows Server performance and feature
qualification require a dedicated test machine; these local protocol tests do not substitute for that work.

The macOS ARM64 helper has also passed the live `freerdp` suite against a dedicated Windows Server 2025 VM:
rendering, input, view only, process cleanup, reconnect, and switching the same profile back to IronRDP. This is
functional validation, not a performance benchmark. Windows and Linux client builds still need qualification.
