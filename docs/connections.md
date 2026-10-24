[← README](../README.md)

# Connecting to desktops and VMs

Choose how this computer reaches the RDP server. The route is independent of whether the remote desktop runs
Windows or Linux; Hyper-V consoles are the exception, because they connect to the Windows host's VM console service.

- [Compare connection routes](#connection-routes)
- [Add a desktop behind SSH](#windows-and-other-desktops-behind-a-host)
- [Create a profile or import an .rdp file](#remote-desktop-profiles)
- [Connect through an RD Gateway](#through-an-rd-gateway)
- [Start and discover VMs](#starting-a-desktop-that-is-off)
- [Follow ssh typed in a terminal](#use)

## Connection routes

| Route | Remote OS / server | Address is resolved from | What opens |
|---|---|---|---|
| SSH host's own desktop | Linux: automatic GNOME headless setup, or an existing xrdp server | The SSH host | Desktop overlay in the SSH tab; switch back to its console |
| SSH host's own desktop | Windows with OpenSSH Server and Remote Desktop | The Windows host, at `127.0.0.1:3389` | The same overlay; asks for a Windows account |
| Desktop behind an SSH host | Windows RDP or a reachable Linux RDP server | The SSH host | Desktop overlay reached through that SSH connection |
| RDP profile, direct | Windows or Linux with an existing RDP server | This computer, over LAN or VPN | A dedicated desktop tab |
| RDP profile, through SSH | Windows or Linux with an existing RDP server | The profile's selected SSH host | That SSH tab, with its desktop overlay |
| RD Gateway | Windows or Linux with an RDP server the gateway can reach | The gateway | The profile or behind-host desktop, tunneled over HTTPS |
| Hyper-V console | Guest OS can be Windows, Linux, or absent; host must run Windows / Hyper-V | The Windows SSH host, port 2179 | Basic or enhanced VM console; IronRDP only |

## Windows and other desktops behind a host

1. In the SSH host's menu, choose **Desktops › Add a desktop behind \<host\>…**.
2. Enter a name and the RDP address **as seen from the SSH host**.
3. Choose the server kind: **Windows**, **xrdp**, or **GNOME Remote Desktop**. Add a user name and domain if needed.

The desktop opens immediately and stays in that host's **Desktops** menu. Use **Settings › Edit a desktop** or
**Remove a desktop** to manage it. See [what follows an edit or removal](credentials-and-trust.md#what-changes-when-you-edit-a-desktop)
for saved-password and certificate behavior.

| Remote desktop | What must already run there | Sign-in |
|---|---|---|
| Windows | Remote Desktop enabled; no SSH server needed on the destination | Windows account |
| Linux through xrdp | xrdp and a desktop session such as Xfce, KDE Plasma, MATE or Cinnamon | Linux account |
| GNOME Remote Desktop | A configured, reachable GNOME Remote Desktop server | That server's credentials; automatic setup is available when opening its own SSH host |
| KDE through KRDP | The experimentally qualified, patched server stack | See [compatibility and qualification](compatibility.md#tested-environments) |

In Tabby's config file, they look like this:

```yaml
remoteDesktop:
  desktops:
    - name: Windows VM
      via: buildhost            # the SSH host: alias, hostname, user@hostname or user@hostname:port (not a machine
                                #   reached with ssh typed in another host's console)
      host: 192.168.122.20      # the RDP server as seen from that host
      port: 3389
      kind: windows             # or xrdp (a Linux desktop served by xrdp), or gnome
      username: alice           # optional; DOMAIN\user works too
      domain: CORP              # optional
      wake: { vm: win11 }       # optional: start it when it's off (see below)
      clipboard: fromRemote     # optional: its own clipboard sharing, both, fromRemote or off (see Clipboard)
```

The connection runs through the same SSH connection; the Windows machine needs Remote Desktop turned on, and nothing
else.

## Starting a desktop that is off

A VM on the SSH host, or a machine next to it, may be shut down when you want its desktop. With `wake`, the plugin
checks from the SSH host whether the desktop answers, and if it doesn't, starts it, shows **Starting \<name\>…** with
the time so far, and connects as soon as it answers (it gives up after 3 minutes):

- `wake: { vm: win11 }` starts the libvirt VM `win11` on the SSH host with `virsh start`, as your SSH user: first in
  `qemu:///system` (you need to be in the `libvirt` group, or allowed by polkit), then in your own `qemu:///session`.
  A paused VM is resumed.
- `wake: { mac: "aa:bb:cc:dd:ee:ff" }` sends a Wake-on-LAN packet from the SSH host (with `python3`, to the broadcast
  address, UDP port 9). Add `broadcast: 192.168.1.255` for a particular network, or `port: 7`.

In the add and edit forms, the last field takes a VM name or a MAC address. Automatic reconnects never start a desktop,
since it may have been shut down on purpose; **Reconnect** does.

## Remote desktop profiles

Create one at **Settings › Profiles & connections › New profile › Remote desktop (RDP)**. Set the address, server
kind and optional user name/domain. The profile appears beside SSH profiles and opens a dedicated desktop tab;
**Disconnect** leaves a **Connect** button. Quick connect also accepts `user@host:port` in Tabby's profile selector.

| Connect setting | Destination address | Where it appears |
|---|---|---|
| Direct | As this computer sees it | Dedicated desktop tab |
| An SSH profile | As that SSH host sees it | Desktop in that SSH tab, and in that host's desktop menu |
| RD Gateway | As the gateway sees it | Dedicated tab reached through the gateway |

Features follow the selected [RDP client](../native/README.md). Several profiles may use the same address with
different users: their passwords are separate, and their desktops can open side by side. Editing or removing one
leaves the other users' passwords and the address's certificate alone. Profiles without a user can share a password
saved by another unnamed-user profile. See [accounts and trust](credentials-and-trust.md).

### Import an .rdp file

Choose **Settings › Import an .rdp file…** in the desktop menu, or **Remote desktop: import an .rdp file…** in Tabby's
command palette. Review the address, gateway and account, then connect or choose **Add only**.

| File setting | Import behavior |
|---|---|
| Address, port, user name, domain, RD Gateway | Copied to the profile; the file name becomes its name |
| `desktopscalefactor` of 150 or more | Selects Retina sharpness |
| `redirectclipboard:i:0` | Disables clipboard sharing; an imported file cannot enable it |
| Sound left on the remote, fixed window size, drive/printer redirection, multiple monitors | Listed as unapplied in the import note |
| Remote startup program or local executable content | Never run or requested |
| Same address, user name, domain (case-insensitive), and gateway as an existing profile | Opens that profile; asks first if the import would disable its clipboard |

Import confirms where the sign-in will go and what the desktop can access: shared folders, the allowed clipboard
and the microphone if enabled. A gateway receives a password proof before the desktop signs in. Imported profiles
start as **Windows** and never inherit a saved desktop account, gateway account or server kind from group defaults.
They ask for sign-in unless credentials already exist for that address, user and gateway route. International host
names are shown as their resolved punycode; names with invisible characters are rejected.

In Tabby's config file:

```yaml
profiles:
  - type: rdp
    name: Office PC
    options:
      host: 192.168.1.20        # as this computer sees it (or as the SSH host sees it, with via)
      port: 3389
      kind: windows             # or xrdp, or gnome
      username: alice           # optional
      via: ''                   # or the id of an SSH profile to go through
      gateway: ''               # or an RD Gateway to go through: rdgw.example.com, or host:port
      gatewayAccount: ''        # or a saved account's id, for a gateway that takes another account
      clipboard: off            # optional: its own clipboard sharing, both, fromRemote or off; '' for the setting's.
                                # Left out, its group's and Tabby's profile defaults decide (see Clipboard)
```

## Through an RD Gateway

Where desktops sit behind a Remote Desktop Gateway (the HTTPS front door many companies put before their Windows
machines), give the profile the gateway's address in **RD Gateway**: `rdgw.example.com`, or `host:port` when it
isn't on 443. The profile's address is then the desktop as the gateway sees it (`pc17.corp.example`). The connection
goes to the gateway over HTTPS, signs in there, and the gateway connects it on; the desktop then asks for its own
sign-in as usual, inside that tunnel.

- **One sign-in by default.** The account you enter for the desktop also signs in to the gateway, as with Remote Desktop
  Connection's "use my RD Gateway credentials for the remote computer". A gateway that takes another account: pick a
  [saved account](credentials-and-trust.md#saved-accounts) under **Gateway account**; its password is asked for once and kept with the account.
  A remembered desktop password is kept for the gateway it was entered for (whichever account signs in to the gateway),
  so it is never sent through a different gateway named for the same address without asking; a new gateway, user name,
  domain or account asks again, and a new address takes the password along, unless a desktop is known at that address
  already. Version 0.5.0 kept such a password for the address alone, where a desktop at that address without a gateway
  would find it: those of the desktops configured with a gateway by then are forgotten after the update, once in each
  computer's keychain and once in Tabby's Vault, the first time a password is looked up, saved or forgotten there, and
  both desktops ask once. Until that has been done (a keychain that doesn't answer, a Vault whose passphrase prompt was
  cancelled), such a password isn't used. A [saved account](credentials-and-trust.md#saved-accounts) is one password for every desktop that
  names it, wherever each of them goes.
- **A refused sign-in says who refused it.** When it was the gateway (a wrong password, or its policy doesn't let the
  account in), the form comes back saying so, and nothing has gone to the desktop. A desktop the gateway's policy
  doesn't let the account reach, or that the gateway can't reach, is an error with that reason.
- **The gateway's certificate** is checked as a direct desktop's is ([above](#remote-desktop-profiles)):
  accepted when it is valid for the gateway's name by the certificate authorities this computer trusts (with a recent
  Tabby, an organisation's own in the system's store counts); any other (self-signed, say) is shown on the first
  connection and connected only after you confirm its fingerprint, because your sign-in reaches the gateway as a proof
  of your password. A later change stops the connection, before the sign-in goes out, until you trust the new one,
  unless an authority vouches for the new one and the one before wasn't one you trusted yourself (a gateway's
  certificate remembered by 0.5.0 is replaced so too, whichever way it was remembered). The desktop beyond the gateway
  has a certificate of its own: checked the same way for a remote desktop profile, remembered on first use behind an SSH
  host. Remembered ones are listed under Settings › Remote Desktop › Certificates.
- **Behind an SSH host too.** A desktop added behind an SSH host takes a gateway the same way (the **RD Gateway**
  field of its form): the gateway is then reached from that host.

It speaks the gateway's WebSocket transport (Windows Server 2012 R2 and later) and signs in with a user name and
password (NTLM, bound to the gateway's TLS certificate as gateways require by default). Smart cards, sign-in pages
and one-time codes at the gateway are not supported.

## VMs on a host

When you right-click an SSH host, the plugin looks at the host's libvirt VMs (`virsh`, as your SSH user; read-only, at
most once a minute; on a Windows host, [Hyper-V's](#hyper-v)) and lists the ones with a desktop under **Desktops**, with nothing to set up:

- a running VM whose RDP port answers: Windows, or Linux with xrdp;
- a Windows VM that's shut off: **Start and open**, which starts it (`virsh start`) and connects as soon as it answers.

A Linux VM that runs GNOME is left out: its desktop is reached by SSH-ing to it (its own desktop, or `ssh` typed in a
console on the host, [above](#use)). A VM found this way asks for its account the first time, like any Windows or xrdp
desktop; one the host lists as Linux (xrdp) also asks once before your password goes to it without Network Level
Authentication, since that it is xrdp is only the host's word. **Save \<name\> to this host's desktops** in its menu
keeps it, for a name of your own and other settings; its kind stays the host's word, and asks the same way (a VM saved
with an earlier version too), until you pick a kind for it in its edit form. VMs aren't looked for on a machine
reached with `ssh` typed in another host's console. The menu lists 256 VMs at most, and says so when a host has more;
add other libvirt VMs by their address with **Add a desktop behind \<host\>…**. Hyper-V VMs past the first 256 aren't
offered in the menu: one opens from a `remoteDesktop.desktops` entry in Tabby's config file, with `via` and `hyperv:
<its id>` (see [above](#windows-and-other-desktops-behind-a-host)).
**Settings › Remote Desktop › Find virtual machines on SSH hosts** turns this off.

A VM the plugin started can go back off by itself: **Settings › Remote Desktop › Shut down VMs it started** (5
minutes, 15 or an hour without a desktop open; never, by default). A small watcher on the SSH host sees to it, so it
also works once the tab is closed or Tabby has quit: after that long with no connection to the VM's desktop through the
host, it asks the VM to shut down (`virsh shutdown`, with a key press first, since Windows ignores the request while its
screen sleeps), then ends. VMs that were already running are never touched, and neither are machines woken over the
network.

### Hyper-V

A Windows SSH host that runs Hyper-V gets the same: its VMs (`Get-VM`, with PowerShell over the SSH connection) are
listed under **Desktops**, and one that is off is started when opened (`Start-VM`). What opens is the VM's console, as
Hyper-V Manager's **Connect** shows it: reached through the host (its port 2179), so the VM needs no network, no
Remote Desktop turned on, not even an operating system. A Windows guest that is up is asked for an enhanced session
(its own sign-in screen, the clipboard, sound, shared folders, resizing); before that, and for other guests, it is the
basic console: the picture, keyboard and mouse. The basic console is what has been tested so far; enhanced sessions
take the same path but haven't been tried against a running Windows guest yet.

The sign-in is the **host's**, not the guest's: an account that may open the VM's console there, which the plugin
asks for once per host (the SSH user is filled in). That is an administrator, a member of the host's Hyper-V
Administrators group, or an account given access with `Grant-VMConnectAccess`. A local administrator other than the
built-in one can list VMs over SSH and still be refused the console, since Windows gives it a reduced token over the
network; Hyper-V refuses by ending the connection at once, and the plugin then asks again, saying so. Listing VMs
takes an account Hyper-V lets do that (an administrator of the host, in practice).

## Use

### Following ssh typed in a terminal

It also works in a plain local terminal where you typed `ssh host` (macOS and Linux), as long as that host accepts
your key without a password prompt. And in an SSH tab where you typed `ssh` on to another machine: **Desktop** there
opens that machine's desktop, going through the first, as long as the first can log in to it by itself (a key there,
or agent forwarding). So one pane of a split can show the first machine's desktop, and the other, after `ssh other`,
that machine's. Desktop asks which desktop you mean, the first machine's or that one's, this time or **from now on**:
which `ssh` runs in a console is the first machine's to say. Chosen from now on, that machine's desktop opens at once
the next times. A machine reached this way keeps its saved sign-in and certificate under the machine it goes through,
apart from the same machine opened in a tab of its own, and only its own desktop opens that way (VMs aren't looked for
there): desktops added behind a host open in tabs connected to that host. A "from now on" is taken back by removing its
entry from `remoteDesktop.nestedSSH` in Tabby's config file (Settings › Config file): `via` is the tab's host,
`destination` the name typed after `ssh`.

One desktop per account: a second tab to the same `user@host` switches to the tab that has it open, rather than
connecting again.

## desk: the console on the desktop

Type `desk` in an SSH console, and the tab switches to that machine's desktop with a terminal attached to the very same
shell: its scrollback, working directory, jobs and running programs. Type on either side; both show it.

<p align="center">
  <img src="images/console.png" width="49%" alt="A console">
  <img src="images/desk.png" width="49%" alt="The same shell on the desktop, after typing desk">
</p>

`desk` is off by default, because it makes interactive SSH logins on that machine start inside a shareable session.
Turn it on in the pane's menu under **Remote Desktop › Settings**, or in Settings › Remote Desktop. The sessions are handled by a small helper, `trd-pty`, rather than tmux, so
your terminal's scrollback, colors and shortcuts stay as they are. Turning it off removes it again. Details:
[docs/desk.md](desk.md).

Before it acts on what `desk` prints, Tabby checks three things: the key `desk` sends, which only your account on that
machine can read and which Tabby learns when it opens the machine's desktop with `desk` on; that it is the key of the
machine the pane is connected to (its SSH host, or the machine `ssh` typed there went to); and that the pane is the
one you're in. So other output that only looks like what `desk` prints is ignored, and `desk` works on a machine once
its desktop has been opened with `desk` on from this Tabby, or from one that shares its config through config sync
(after updating from 0.5.0 or earlier, open it once again). The key tells `desk` apart from look-alikes, not from the
machine itself, which can always send it, nor from a recording of `desk`'s output (a terminal log, `script`,
asciinema), which holds it: shown again in that machine's pane while you're in it, it counts as `desk`. Open the
desktop of a machine you don't trust with `desk` off, which also has Tabby forget a key it had for it.
