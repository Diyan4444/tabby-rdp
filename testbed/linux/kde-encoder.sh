#!/bin/sh
# Opt-in correction for the disposable Fedora 44 KRDP guest. Run as its dedicated desktop user.
# Does not replace Fedora's libraries: only this user's KRDP service loads the private build.
set -eu
[ "$(id -u)" != 0 ] || { echo 'Run as the dedicated Plasma user, with sudo available' >&2; exit 2; }
. /etc/os-release
[ "$ID:$VERSION_ID" = fedora:44 ] || { echo 'Expected Fedora 44' >&2; exit 2; }
HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PATCH="$HERE/kpipewire-krdp-color.patch"
SOURCE=6318082fe449b50e701abc4d91308c2371cf8741
PATCH_SHA=$(sha256sum "$PATCH" | cut -d ' ' -f 1)
WORK="$HOME/.local/share/tabby-qa-kpipewire/$PATCH_SHA"
export XDG_RUNTIME_DIR="/run/user/$(id -u)"
export DBUS_SESSION_BUS_ADDRESS="unix:path=$XDG_RUNTIME_DIR/bus"
# Building may update development dependencies; retain the DNF transaction log with the testbed record.
sudo dnf install -y git cmake gcc-c++
sudo dnf builddep -y kpipewire
mkdir -p "$WORK"
if [ ! -d "$WORK/source" ]; then
    git clone --depth 1 --branch v6.7.5 https://invent.kde.org/plasma/kpipewire.git "$WORK/source"
fi
[ "$(git -C "$WORK/source" rev-parse HEAD)" = "$SOURCE" ] || { echo 'Unexpected upstream revision' >&2; exit 2; }
if git -C "$WORK/source" diff --quiet; then
    git -C "$WORK/source" apply --check "$PATCH"
    git -C "$WORK/source" apply "$PATCH"
else
    # Repeat execution accepts only the exact patch, not arbitrary local source edits.
    git -C "$WORK/source" diff --binary > "$WORK/current.patch"
    cmp "$PATCH" "$WORK/current.patch"
fi
[ -z "$(git -C "$WORK/source" ls-files --others --exclude-standard)" ] || { echo 'Unexpected untracked source files' >&2; exit 2; }
cmake -S "$WORK/source" -B "$WORK/build" -DCMAKE_BUILD_TYPE=RelWithDebInfo -DBUILD_TESTING=OFF -DCMAKE_INSTALL_PREFIX="$WORK/install"
cmake --build "$WORK/build" -j2
cmake --install "$WORK/build"
LIBRARY="$WORK/install/lib64/libKPipeWireRecord.so.6.7.5"
[ -f "$LIBRARY" ] || { echo 'Expected private encoder library missing' >&2; exit 2; }
python3 - "$SOURCE" "$PATCH_SHA" "$LIBRARY" <<'PY'
import hashlib,json,pathlib,sys
source,patch,library=sys.argv[1:]
manifest=dict(sourceCommit=source,patchSha256=patch,library=library,librarySha256=hashlib.sha256(pathlib.Path(library).read_bytes()).hexdigest())
p=pathlib.Path.home()/'.local/share/tabby-qa-kpipewire/manifest.json'
p.write_text(json.dumps(manifest,indent=2)+'\n')
PY
mkdir -p "$HOME/.config/systemd/user/app-org.kde.krdpserver.service.d"
cat > "$HOME/.config/systemd/user/app-org.kde.krdpserver.service.d/encoder.conf" <<CFG
[Service]
Environment="LD_LIBRARY_PATH=$WORK/install/lib64"
Environment=KPIPEWIRE_FORCE_ENCODER=libopenh264
CFG
systemctl --user daemon-reload
systemctl --user restart app-org.kde.krdpserver.service
echo 'Private encoder enabled for KRDP only. Record loaded-library identity and run real visual qualification.'
echo 'Rollback: remove the KRDP encoder.conf override, reload the user manager and restart KRDP.'
