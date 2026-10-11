#!/bin/sh
# Dedicated Fedora KDE QA guest only. Root; account password arrives on stdin, never argv/logs.
# Uses Plasma Wayland autologin in a disposable VM; do not apply to a personal workstation.
set -eu
[ "$(id -u)" = 0 ] || { echo 'Run as root' >&2; exit 2; }
TEST_USER=${1:?Dedicated existing SSH user required}
id "$TEST_USER" >/dev/null
. /etc/os-release
[ "$ID:$VERSION_ID" = fedora:44 ] || { echo 'Expected Fedora 44' >&2; exit 2; }
TEST_HOME=$(getent passwd "$TEST_USER" | cut -d: -f6)
TEST_UID=$(id -u "$TEST_USER")
as_user() { runuser -u "$TEST_USER" -- env XDG_RUNTIME_DIR="/run/user/$TEST_UID" DBUS_SESSION_BUS_ADDRESS="unix:path=/run/user/$TEST_UID/bus" "$@"; }
case "${2:-install}" in install|credentials) ;; *) echo 'Expected install or credentials' >&2; exit 2 ;; esac
IFS= read -r QA_PASSWORD
[ ${#QA_PASSWORD} -ge 20 ] || { echo 'A dedicated password of at least 20 characters is required' >&2; exit 2; }
printf '%s:%s\n' "$TEST_USER" "$QA_PASSWORD" | chpasswd
if [ "${2:-install}" = credentials ]; then
    # One-time wallet creation requires the dedicated VM console; never silently create an insecure personal wallet.
    [ -f "$TEST_HOME/.local/share/kwalletd/kdewallet.kwl" ] || { echo 'Create kdewallet in the dedicated Plasma session first; see docs/visual-qa.md' >&2; exit 2; }
    printf '%s\n' "$QA_PASSWORD" | as_user timeout 20 env QT_QPA_PLATFORM=offscreen kwallet-query -w "$TEST_USER" -f KRDP kdewallet
    unset QA_PASSWORD
    as_user chmod 700 "$TEST_HOME/.local/share/kwalletd"
    as_user systemctl --user restart app-org.kde.krdpserver.service
    exit
fi
unset QA_PASSWORD
dnf install -y plasma-desktop plasma-workspace kwin-wayland sddm krdp kwalletmanager pipewire-utils wireplumber xdg-desktop-portal-kde flatpak python3-gobject python3-cairo gtk3 dejavu-sans-fonts dejavu-sans-mono-fonts openssh-server openssl qemu-guest-agent mesa-dri-drivers ffmpeg-free openh264 freerdp
# Initial stock setup uses the older dependency; kde-freerdp.sh opts into the qualified private 3.32.1 fix.
dnf downgrade -y freerdp-3.24.2-1.fc44 freerdp-libs-3.24.2-1.fc44 libwinpr-3.24.2-1.fc44
dnf versionlock add freerdp freerdp-libs libwinpr
dnf versionlock add plasma-workspace kwin krdp kpipewire pipewire ffmpeg-free openh264
install -d -m 755 /etc/sddm.conf.d
cat > /etc/sddm.conf.d/tabby-visual-qa.conf <<CFG
[Autologin]
User=$TEST_USER
Session=plasma.desktop
Relogin=true
CFG
loginctl enable-linger "$TEST_USER"
systemctl start "user@$TEST_UID.service"
as_user systemctl --user daemon-reload
as_user systemctl --user start dbus.socket
as_user mkdir -p "$TEST_HOME/.local/share/krdpserver"
as_user chmod 700 "$TEST_HOME/.local/share/krdpserver"
# Keep the same private certificate across test reconnects; explicit operator rotation, never per-run regeneration.
if [ ! -f "$TEST_HOME/.local/share/krdpserver/krdp.crt" ]; then
    as_user sh -c 'umask 077; openssl req -nodes -new -x509 -newkey rsa:2048 -keyout "$HOME/.local/share/krdpserver/krdp.key" -out "$HOME/.local/share/krdpserver/krdp.crt" -days 365 -subj /CN=tabby-visual-qa-krdp' 2>/dev/null
fi
as_user kwriteconfig6 --file krdpserverrc --group General --key Certificate "$TEST_HOME/.local/share/krdpserver/krdp.crt"
as_user kwriteconfig6 --file krdpserverrc --group General --key CertificateKey "$TEST_HOME/.local/share/krdpserver/krdp.key"
as_user kwriteconfig6 --file krdpserverrc --group General --key SystemUserEnabled false
as_user kwriteconfig6 --file krdpserverrc --group General --key Users "$TEST_USER"
as_user kwriteconfig6 --file krdpserverrc --group General --key ListenPort 3389
as_user kwriteconfig6 --file kscreenlockerrc --group Daemon --key Autolock false
as_user kwriteconfig6 --file kscreenlockerrc --group Daemon --key LockOnResume false
as_user kwriteconfig6 --file kdeglobals --group KDE --key AnimationDurationFactor 0
# An inactive physical output produces zero KRDP frames, even after authentication succeeds.
as_user systemctl --user mask --now plasma-powerdevil.service
as_user flatpak permission-set kde-authorized remote-desktop org.kde.krdpserver yes
as_user mkdir -p "$TEST_HOME/.config/systemd/user/app-org.kde.krdpserver.service.d"
cat > "$TEST_HOME/.config/systemd/user/app-org.kde.krdpserver.service.d/qa.conf" <<'CFG'
[Service]
ExecStart=
ExecStart=/usr/bin/krdpserver --address 127.0.0.1 --monitor 0 --quality 100 --plasma
CFG
chown "$TEST_USER:$TEST_USER" "$TEST_HOME/.config/systemd/user/app-org.kde.krdpserver.service.d/qa.conf"
as_user systemctl --user daemon-reload
as_user systemctl --user enable app-org.kde.krdpserver.service
# No inbound RDP firewall opening: clients reach guest loopback through authenticated SSH forwarding.
systemctl enable sddm qemu-guest-agent
systemctl set-default graphical.target
rpm -q plasma-workspace krdp pipewire kpipewire ffmpeg-free openh264 freerdp freerdp-libs libwinpr
rpm -qf /usr/bin/kwin_wayland
echo 'Packages provisioned; finish dedicated KWallet and 800x600 display setup in docs/visual-qa.md before running QA. KDE coverage remains unqualified.'
