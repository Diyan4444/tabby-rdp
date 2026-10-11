# Test machines

The suites need a Linux desktop host, and for the Windows suite, a Windows machine. Use dedicated virtual machines,
not machines you use: the suites start and stop desktop sessions, change settings, and install `desk`'s login hook
on the test account.

## Linux desktop host

Select installation media explicitly before provisioning. Download a dated Ubuntu 24.04 cloud image for the VM's
architecture from [Ubuntu's cloud image archive](https://cloud-images.ubuntu.com/noble/), authenticate its published
SHA256SUMS using Ubuntu's signing key, and record the image, build date and digest in your test run notes. Set:

```sh
export UBUNTU_IMAGE=/absolute/path/to/reviewed-noble-image.img
export UBUNTU_IMAGE_SHA256='<64 hexadecimal characters from the authenticated checksum list>'
```

Both Linux VM scripts verify the local file before booting it. Multipass must run on the machine holding this file;
the selected image must match its architecture. There is no default `current` image or release alias. A missing or
incorrect digest stops setup. A digest computed only from an untrusted download is not publisher verification.

Ubuntu 24.04 with GNOME Remote Desktop 46, reachable over SSH with your key. Either:

**A Multipass VM** ([Multipass](https://canonical.com/multipass) runs on macOS, Linux and Windows):

```sh
testbed/linux/multipass.sh                 # creates "tabby-rdp-linux", provisions it, adds ~/.ssh/id_ed25519.pub
# prints: export TRD_TEST_HOST=<address> TRD_TEST_USER=ubuntu
```

**A libvirt VM** on a Linux host, from Ubuntu's cloud image, without root (as a user in the `libvirt` group; needs
`virtinst` and `cloud-image-utils`):

```sh
testbed/linux/libvirt.sh [name] [keys.pub]   # on the libvirt host; keys.pub: this host's key and your test machine's
# prints the address, and how to forward a port to it from another machine
```

The libvirt script supports amd64 and arm64 images. Select a reviewed dated image and set `TEST_SSH_KEY` to the
provisioning private key when needed. Keep a separate `TESTBED_DIR` for each reviewed image build. Other distro
profiles use `TEST_IMAGE` and `TEST_IMAGE_SHA256`; Ubuntu also accepts the legacy variables above.

**Or any Ubuntu 24.04 VM** (virt-manager, UTM, Hyper-V, a cloud instance), with SSH set up for your key:

```sh
scp testbed/linux/provision.sh testbed/linux/winrm-requirements.txt user@host:
ssh -t user@host sudo sh provision.sh
```

[`provision.sh`](linux/provision.sh) installs a minimal GNOME desktop (`ubuntu-desktop-minimal`), GNOME Remote
Desktop, PipeWire's tools, Python's GObject bindings, `pywinrm`, tmux and OpenSSH; switches the boot target to text
mode (the plugin runs its own headless GNOME session); and lets the test user's systemd run without a login. Give the
VM 2 CPUs, 4 GB of memory and 20 GB of disk. No GPU is needed.

`winrm-requirements.txt` pins pywinrm and every dependency, with SHA-256 hashes for CPython 3.12 Linux x86_64 and
ARM64 wheels. Ubuntu provisioning requires that file beside `provision.sh`, rejects other Ubuntu releases, disables pip
source builds, and requires matching hashes. To upgrade, download the complete wheel tree for both architectures
without installing it, review the versions and publisher artifacts, update the pins and wheel hashes, and verify
`pip download --require-hashes --only-binary=:all: -r winrm-requirements.txt` for both targets. Ubuntu packages still
receive updates from the distribution's signed apt repositories; this is not a frozen operating-system snapshot.
The Debian, Fedora and Rocky profiles do not install this Ubuntu-specific WinRM wheel lock; use the Ubuntu SSH
gateway for Windows guest checks. Their Linux desktop checks do not require WinRM.

### xrdp, for the xrdp suite (optional)

On the same host, after `provision.sh`:

```sh
scp testbed/linux/xrdp.sh user@host:
# On the host, read the password without echoing it or putting it in shell history:
read -r -s -p 'xrdp password: ' TEST_PASSWORD; echo
export TEST_PASSWORD
sh xrdp.sh
unset TEST_PASSWORD
```

[`xrdp.sh`](linux/xrdp.sh) installs xrdp with XFCE (and `pipewire-module-xrdp` for sound, where the release has it),
sets xrdp's port to 3390 so that it doesn't clash with GNOME Remote Desktop on 3389, and creates an account,
`tabbyxrdp`, with that password, XFCE as its session and the test user's SSH keys. It leaves xrdp stopped: the xrdp
suite starts it for its run with the test user's `sudo` (passwordless on Ubuntu's cloud images) and stops it
afterwards, so that for the other suites the host has GNOME only. Then:

```sh
export TRD_TEST_XRDP_PASSWORD='<the password>'   # TRD_TEST_XRDP_USER=tabbyxrdp and TRD_TEST_XRDP_PORT=3390 are the defaults
npm test -- xrdp
```

The suite checks both ways a host offers xrdp: next to GNOME, as a second desktop (with the test user), and as the
host's own desktop where GNOME isn't installed (with `tabbyxrdp`, running the plugin's setup with a `PATH` that has no
`grdctl` or `gnome-shell`).

### A second account to ssh on to, for the nested suite (optional)

After `xrdp.sh`, as the test user on the host:

```sh
scp testbed/linux/nested.sh user@host: && ssh user@host sh nested.sh
```

[`nested.sh`](linux/nested.sh) lets the test user `ssh trdhop` to the `tabbyxrdp` account without a password (a key
made for it), the way you would ssh on from one machine to the next, and moves that account's GNOME Remote Desktop to
port 3391 (the test user's has 3389). Then `TRD_TEST_NESTED=trdhop npm test -- nested`.

## Windows machine

Windows 10 or 11 Pro (or Windows Server), for example a VM on the same virtual network as the Linux test host.

**A libvirt VM**, next to the Linux one, installed unattended from Microsoft's Windows 11 Enterprise evaluation ISO
(90 days; about 7 GB) and prepared with `setup.ps1`. It needs `virtinst`, `genisoimage` and
`swtpm` (Windows 11 wants UEFI Secure Boot and a TPM), and takes 15 to 30 minutes:

```sh
export WINDOWS_ISO_SHA256='<digest authenticated against Microsoft publication for this exact ISO>'
TEST_PASSWORD='<a password for the test account>' testbed/windows/libvirt.sh tabby-rdp-windows /path/to/windows.iso
# prints the settings and a private file containing the administrator's password
```

**Or any Windows machine.** In an elevated PowerShell on it:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\setup.ps1 -PasswordFile 'C:\private\test-password.txt'
```

[`setup.ps1`](windows/setup.ps1) turns on Remote Desktop (with Network Level Authentication) and WinRM (marking the
network private, which WinRM's settings require), and creates a local test account, `tabbyrdp`, that can use both
without being an administrator.

The suite reaches Windows through an SSH host, as users do: the Linux test host works, if it can reach the Windows
machine. It runs its checks inside Windows over WinRM from that host (`provision.sh` installs `pywinrm`):

```sh
export TRD_TEST_WIN_ADDRESS=192.168.122.20:3389 TRD_TEST_WIN_WINRM=192.168.122.20:5985
export TRD_TEST_WIN_USER=tabbyrdp TRD_TEST_WIN_PASSWORD='<its password>'
npm test -- windows
```

If the Windows VM runs on a host with user-mode networking (QEMU's `-netdev user`), forward its ports to that host's
loopback instead (`hostfwd=tcp:127.0.0.1:13389-:3389,hostfwd=tcp:127.0.0.1:15985-:5985`), use that host as
`TRD_TEST_WIN_SSH_HOST`, and `127.0.0.1:13389` / `127.0.0.1:15985` as the addresses.

## Windows Server: a Hyper-V host and an RD Gateway (optional)

For the two ways to a desktop that need a server: a VM's console through its Hyper-V host (port 2179, as Hyper-V
Manager's Connect does), and a desktop behind a Remote Desktop Gateway. One machine does both.

**A libvirt VM**, next to the others, installed unattended from Microsoft's Windows Server 2025 evaluation ISO (180
days; about 6 GB):

```sh
export WINDOWS_ISO_SHA256='<digest authenticated against Microsoft publication for this exact ISO>'
TEST_PASSWORD='<a password for the test account>' testbed/windows-server/libvirt.sh tabby-rdp-winserver /path/to/server.iso
# prints the addresses and a private file containing the administrator's password
```

It is prepared with `setup.ps1` (as the Windows machine above) and [`server.ps1`](windows-server/server.ps1), which

- installs **RD Gateway** with a self-signed certificate and policies that let the test account (a local one: the
  machine is in no domain, the gateway authenticates with NTLM) connect through it to any computer it reaches, the
  Windows test machine for one;
- installs **Hyper-V**, turns on enhanced session mode, and makes two guest VMs: `tabby-rdp-guest`, Windows
  (Server Core, with the test account in it) from the image on the installation disc, for enhanced sessions; and
  `tabby-rdp-empty`, without a disk, which sits at its firmware's screen and is console enough to connect to. The
  test account is a Hyper-V administrator on the host, which is what lets it open a guest's console;
- turns on **OpenSSH Server** with PowerShell as its shell, for listing the host's VMs over SSH. Listing them
  (`Get-VM`) takes the administrator account, `tabbyadmin`: the test account can sign in and open consoles, but
  Hyper-V didn't let it list VMs. Your public key (`SSH_KEY`, default `~/.ssh/id_ed25519.pub`) may sign in as
  `tabbyadmin`.

The script ends with the `TRD_TEST_HYPERV…` and `TRD_TEST_GATEWAY…` settings for the `hyperv` and `gateway` suites
([test/README.md](../test/README.md)). The gateway asks for nothing more than the account: it checks that the sign-in
was made over its own TLS connection (extended protection, its default), which the plugin's sign-in carries.

Hyper-V in a VM needs nested virtualization: the libvirt host's KVM with `nested` on (`cat
/sys/module/kvm_*/parameters/nested`). The VM takes 16 GB of memory and one CPU while it runs, and up to 120 GB of
disk. One CPU because of how deep the nesting can get: where the libvirt host is itself a VM, the machine froze with
more (`VCPUS=4` on a host that isn't one is much faster); on one CPU, installing can take a couple of hours. On such
a host a guest that starts an operating system froze the machine too, Windows or Linux: run the script with
`START_GUEST=0`, which leaves the Windows guest off, and test with the empty one (a console, but no enhanced
session). The password has to meet Windows Server's complexity rules (three of:
capitals, small letters, digits, symbols).

**Or any Windows Server 2022 or 2025 with the desktop** (RD Gateway isn't offered on Server Core), its installation
disc in a drive. In an elevated PowerShell on it, after `setup.ps1`:

```powershell
.\server.ps1 -PasswordFile 'C:\private\test-password.txt'   # restarts once, and finishes at startup
# -SshKeys <a file of public keys>: may sign in over SSH as an administrator (the hyperv suite lists the VMs that way)
```

Get Windows media from [Microsoft's Evaluation Center](https://www.microsoft.com/en-us/evalcenter/) and verify the
exact edition, language, architecture and SHA-256 against Microsoft's publication. Both Windows scripts require a
local ISO and `WINDOWS_ISO_SHA256`; neither follows a mutable download redirect. They verify the file on each run
and upload it again instead of trusting an existing libvirt volume's length. If an authoritative digest is not
available for your media, stop and obtain verified media; there is no skip-verification option.

Run `python3 testbed/test_images.py` to exercise valid, malformed, missing and mismatched media digests locally.

Provisioning credentials are test-only secrets. The Windows scripts need Python 3 and build their answer file and
password file in a new mode-700 temporary directory, with mode-600 files. Passwords reach the renderer through
stdin; Windows setup reads the password file from the config disc rather than a process argument. Exit and signal
traps remove local answer files and config ISOs, eject the uploaded config disc, and delete its libvirt volume.
If libvirt cannot delete the volume, the script prints the cleanup command; remove it before reusing the machine.
An interrupted unattended installation may need to be restarted because its config disc is removed.

On success the administrator password is saved to the printed, randomly named mode-600 file in `TESTBED_DIR`,
instead of the terminal or CI log. Move it into your secret store, then delete that file. On Windows, protect any
manually supplied password file with an administrators-only ACL and remove it after setup; the scripts still
accept `-Password` for compatibility, but it can expose a secret in process arguments and history. The Server's
second stage needs its administrators-only `C:\tabby-rdp\guest.txt` across a reboot; failure handlers and the
second-stage finally block remove it. After a failure, restart provisioning with the password file and remove any
unfinished guest VM before retrying or discarding the test machine.
Never run provisioning with shell tracing enabled. Catchable signals are cleaned up; a killed host or SIGKILL
requires deleting any leftover `provision.*` directory and `config.iso` volume manually.

Run `python3 testbed/test_credentials.py` for the local answer-file and cleanup regression checks.

### Versioned visual QA matrix

Rocky Linux 9 with Xfce/xrdp is also available using `TEST_DISTRO=rocky9` and
`TEST_XRDP_PASSWORD_FILE=/private/password`. This uses a dedicated `tabbyxrdp` account and the existing
`xrdp.sh` provisioner, with EPEL/CRB packages, an Xorg session and a loopback-only listener on 3390.
Fedora KDE Plasma/KRDP has a separately qualified patched, fixed-monitor profile; see `docs/VISUAL-QA-PLAN.md`.

The Linux libvirt provisioner also accepts `TEST_DISTRO=debian13` and `TEST_DISTRO=fedora44`; the default remains
`ubuntu2404`. Each creates a separate guest and refuses an existing VM name. Debian 13.7/GNOME 48 and Fedora 44/GNOME 50
complement Ubuntu's GNOME 46. For each distro, set `TEST_IMAGE` to a locally reviewed cloud image and
`TEST_IMAGE_SHA256` to its reviewed digest. Authenticate the publisher's checksum first; where it uses SHA-512, verify
that checksum before recording the verified file's SHA-256. The script verifies the local file on every run and
never downloads a mutable default image. `TEST_SECURE_BOOT=0` explicitly
selects non-Secure-Boot UEFI where the host firmware rejects Fedora's shim. The visual tests verify the actual installed
versions instead of trusting the image name.

See [the native-client matrix instructions](../docs/visual-qa.md#native-client-and-desktop-matrix) for separate Windows,
Linux and macOS Tabby clients, private CDP tunnels, exact version checks and per-cell dashboard configuration. These are
native Tabby applications, not browser substitutes. Do not use another thread's running desktop as a test fixture.
