#!/bin/sh
# Opt-in FreeRDP 3.32.1 compatibility for the dedicated Fedora 44 QA desktop.
# Preserve KRDP 6.7.5's TLS + wallet login; do not advertise unsupported extended NLA.
set -eu
[ "$(id -u)" != 0 ] || { echo 'Run as the dedicated Plasma user, with sudo available' >&2; exit 2; }
. /etc/os-release
[ "$ID:$VERSION_ID" = fedora:44 ] || { echo 'Expected Fedora 44' >&2; exit 2; }
[ "$(rpm -q --qf '%{VERSION}' krdp)" = 6.7.5 ] || { echo 'Expected KRDP 6.7.5' >&2; exit 2; }
HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PATCH="$HERE/krdp-freerdp-compat.patch"
SOURCE=270dcf01851229134f74fa7d90ac338ec788ec67
PATCH_SHA=$(sha256sum "$PATCH" | cut -d ' ' -f 1)
WORK="$HOME/.local/share/tabby-qa-krdp/$PATCH_SHA"
export XDG_RUNTIME_DIR="/run/user/$(id -u)"
export DBUS_SESSION_BUS_ADDRESS="unix:path=$XDG_RUNTIME_DIR/bus"
ENCODER=$(python3 - <<'PY'
import json,pathlib
m=json.loads((pathlib.Path.home()/'.local/share/tabby-qa-kpipewire/manifest.json').read_text())
p=pathlib.Path(m['library'])
assert p.is_file(), 'Install the isolated encoder correction first'
print(p.parent)
PY
)
# Explicitly preserve the known-good packages before changing this disposable guest.
mkdir -p "$HOME/tabby-qa-freerdp-rollback"
(cd "$HOME/tabby-qa-freerdp-rollback" && dnf download freerdp-3.24.2-1.fc44 freerdp-libs-3.24.2-1.fc44 libwinpr-3.24.2-1.fc44)
sudo dnf versionlock delete freerdp freerdp-libs libwinpr
sudo dnf install -y freerdp-3.32.1-1.fc44 freerdp-libs-3.32.1-1.fc44 libwinpr-3.32.1-1.fc44
sudo dnf versionlock add freerdp freerdp-libs libwinpr
sudo dnf install -y git cmake gcc-c++
sudo dnf builddep -y krdp
mkdir -p "$WORK"
if [ ! -d "$WORK/source" ]; then
    git clone --depth 1 --branch v6.7.5 https://invent.kde.org/plasma/krdp.git "$WORK/source"
fi
[ "$(git -C "$WORK/source" rev-parse HEAD)" = "$SOURCE" ] || { echo 'Unexpected upstream revision' >&2; exit 2; }
if git -C "$WORK/source" diff --quiet; then
    git -C "$WORK/source" apply --check "$PATCH"
    git -C "$WORK/source" apply "$PATCH"
else
    git -C "$WORK/source" diff --binary > "$WORK/current.patch"
    cmp "$PATCH" "$WORK/current.patch"
fi
[ -z "$(git -C "$WORK/source" ls-files --others --exclude-standard)" ] || { echo 'Unexpected untracked source files' >&2; exit 2; }
cmake -S "$WORK/source" -B "$WORK/build" -DCMAKE_BUILD_TYPE=RelWithDebInfo -DBUILD_TESTING=OFF -DBUILD_EXAMPLES=OFF -DCMAKE_INSTALL_PREFIX="$WORK/install"
cmake --build "$WORK/build" --target KRdp -j2
# Only the library is needed by Fedora's unchanged krdpserver binary.
mkdir -p "$WORK/install/lib64"
LIBRARY="$WORK/install/lib64/libKRdp.so.6.7.5"
# Replace atomically when rerunning: never truncate a library still mapped by the service.
cp "$WORK/build/bin/libKRdp.so.6.7.5" "$LIBRARY.new"
mv -f "$LIBRARY.new" "$LIBRARY"
ln -sfn libKRdp.so.6.7.5 "$WORK/install/lib64/libKRdp.so.6"
ln -sfn libKRdp.so.6 "$WORK/install/lib64/libKRdp.so"
[ -f "$LIBRARY" ] || { echo 'Expected private KRDP library missing' >&2; exit 2; }
python3 - "$SOURCE" "$PATCH_SHA" "$LIBRARY" <<'PY'
import hashlib,json,pathlib,sys
source,patch,library=sys.argv[1:]
manifest=dict(sourceCommit=source,patchSha256=patch,library=library,librarySha256=hashlib.sha256(pathlib.Path(library).read_bytes()).hexdigest())
(pathlib.Path.home()/'.local/share/tabby-qa-krdp/manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
PY
mkdir -p "$HOME/.config/systemd/user/app-org.kde.krdpserver.service.d"
# Sorts after encoder.conf. Both isolated libraries must be in the effective search path.
cat > "$HOME/.config/systemd/user/app-org.kde.krdpserver.service.d/freerdp.conf" <<CFG
[Service]
Environment="LD_LIBRARY_PATH=$WORK/install/lib64:$ENCODER"
CFG
systemctl --user daemon-reload
systemctl --user restart app-org.kde.krdpserver.service
echo 'Private KRDP compatibility library enabled with FreeRDP 3.32.1. Run real visual qualification.'
echo 'Rollback: remove freerdp.conf; unlock and downgrade the three saved FreeRDP RPMs, relock, reload and restart KRDP.'
