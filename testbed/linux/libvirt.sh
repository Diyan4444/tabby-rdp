#!/bin/sh
# Creates an Ubuntu 24.04 (default), Debian 13, Fedora 44 or Rocky 9 test VM, provisioned with provision.sh and
# reachable over SSH with your key, then prints the settings for the test suites. Run it on the libvirt host, as a
# user in the libvirt group (no root needed); it needs virt-install and cloud-localds (cloud-image-utils).
#
#     testbed/linux/libvirt.sh [vm-name] [public-key-file]
# Rocky uses Xfce/xrdp; set TEST_XRDP_PASSWORD_FILE to a private file for its dedicated tabbyxrdp account.
#
# Defaults: tabby-rdp-linux, and ~/.ssh/id_ed25519.pub (or id_rsa.pub). The key file can hold several keys, one per
# line: this host's (for provisioning) and that of the machine that runs the tests, if another.
#
# The VM's disks go in a storage pool of the same name, on libvirt's default NAT network; the image and the seed are
# kept in $TESTBED_DIR (default ~/.cache/tabby-rdp-testbed). Remove it with:
#     virsh undefine --remove-all-storage <name> (after virsh destroy <name>); virsh pool-destroy/pool-undefine <name>
set -eu
NAME="${1:-tabby-rdp-linux}"
KEY="${2:-}"
if [ -z "$KEY" ]; then
    for k in "$HOME/.ssh/id_ed25519.pub" "$HOME/.ssh/id_rsa.pub"; do
        [ -f "$k" ] && { KEY="$k"; break; }
    done
fi
[ -n "$KEY" ] && [ -f "$KEY" ] || { echo "no public key found; pass one: $0 $NAME ~/.ssh/key.pub" >&2; exit 2; }
for c in virsh virt-install cloud-localds; do
    command -v $c >/dev/null || { echo "$c is not installed (virtinst, cloud-image-utils)" >&2; exit 2; }
done
HERE="$(cd "$(dirname "$0")" && pwd)"
V="virsh -c ${LIBVIRT_DEFAULT_URI:-qemu:///system}"
case "$(uname -m)" in
    aarch64|arm64) IMAGE_ARCH=arm64 ;;
    x86_64) IMAGE_ARCH=amd64 ;;
    *) echo 'unsupported host architecture' >&2; exit 2 ;;
esac
DISTRO="${TEST_DISTRO:-ubuntu2404}"
case "$DISTRO" in
    ubuntu2404)
        IMAGE_BASE="https://cloud-images.ubuntu.com/noble/${UBUNTU_IMAGE_BUILD:-current}"
        IMAGE_NAME="noble-server-cloudimg-$IMAGE_ARCH.img"
        MANIFEST=SHA256SUMS; CHECK=sha256sum; GUEST_USER=ubuntu; OS_VARIANT=ubuntu24.04
        ;;
    debian13)
        IMAGE_BASE="https://cloud.debian.org/images/cloud/trixie/${DEBIAN_IMAGE_BUILD:-latest}"
        IMAGE_NAME="debian-13-generic-$IMAGE_ARCH.qcow2"
        MANIFEST=SHA512SUMS; CHECK=sha512sum; GUEST_USER=debian; OS_VARIANT=debian13
        ;;
    fedora44)
        case "$IMAGE_ARCH" in arm64) FEDORA_ARCH=aarch64 ;; amd64) FEDORA_ARCH=x86_64 ;; esac
        IMAGE_BASE="https://dl.fedoraproject.org/pub/fedora/linux/releases/44/Cloud/$FEDORA_ARCH/images"
        IMAGE_NAME="Fedora-Cloud-Base-Generic-44-1.7.$FEDORA_ARCH.qcow2"
        MANIFEST="Fedora-Cloud-44-1.7-$FEDORA_ARCH-CHECKSUM"; CHECK=sha256sum; GUEST_USER=fedora; OS_VARIANT=fedora-unknown
        ;;
    rocky9)
        case "$IMAGE_ARCH" in arm64) ROCKY_ARCH=aarch64 ;; amd64) ROCKY_ARCH=x86_64 ;; esac
        IMAGE_BASE="https://download.rockylinux.org/pub/rocky/9/images/$ROCKY_ARCH"
        IMAGE_NAME="Rocky-9-GenericCloud-Base-${ROCKY_IMAGE_BUILD:-9.8-20260525.0}.$ROCKY_ARCH.qcow2"
        MANIFEST="$IMAGE_NAME.CHECKSUM"; CHECK=sha256sum; GUEST_USER=rocky; OS_VARIANT=rocky9
        [ -f "${TEST_XRDP_PASSWORD_FILE:-}" ] || { echo 'Set TEST_XRDP_PASSWORD_FILE to a private password file for Rocky/Xfce/xrdp' >&2; exit 2; }
        ;;
    *) echo 'TEST_DISTRO must be ubuntu2404, debian13, fedora44 or rocky9' >&2; exit 2 ;;
esac
IMAGE_URL="$IMAGE_BASE/$IMAGE_NAME"
WORK="${TESTBED_DIR:-${XDG_CACHE_HOME:-$HOME/.cache}/tabby-rdp-testbed/$DISTRO}"
mkdir -p "$WORK"
# Refuse to modify an existing guest, including another test thread's VM.
if $V dominfo "$NAME" >/dev/null 2>&1; then echo "VM already exists: $NAME" >&2; exit 2; fi
[ -f "$WORK/$IMAGE_NAME" ] || curl --connect-timeout 20 --max-time 1800 -fL -o "$WORK/$IMAGE_NAME" "$IMAGE_URL"
curl --connect-timeout 20 --max-time 60 -fsSL "$IMAGE_BASE/$MANIFEST" -o "$WORK/$MANIFEST"
# Verify this exact file, not whichever entries happen to exist in the cache.
python3 - "$WORK/$MANIFEST" "$IMAGE_NAME" > "$WORK/image.checksum" <<'CHECKSUM'
import re, sys
manifest, name = sys.argv[1:]
lines = open(manifest).read().splitlines()
found = []
for line in lines:
    match = re.fullmatch(r'([a-fA-F0-9]{64}|[a-fA-F0-9]{128})\s+[* ]?' + re.escape(name), line)
    bsd = re.fullmatch(r'SHA256 \(' + re.escape(name) + r'\) = ([a-fA-F0-9]{64})', line)
    if match or bsd: found.append((match or bsd).group(1))
if len(found) != 1: raise SystemExit('Expected exactly one checksum for requested image')
print(found[0] + '  ' + name)
CHECKSUM
(cd "$WORK" && $CHECK --check image.checksum)
printf 'instance-id: %s\nlocal-hostname: %s\n' "$NAME" "$NAME" > "$WORK/meta-data"
{
    printf '#cloud-config\nhostname: %s\nusers:\n  - default\nssh_pwauth: false\nssh_authorized_keys:\n' "$NAME"
    grep -v '^[[:space:]]*$' "$KEY" | sed 's/^/  - /'
} > "$WORK/user-data"
# DHCP by MAC address: the desktop packages bring NetworkManager, which asks for a lease by MAC, and the address
# would change at the first reboot otherwise.
RENDERER=''
case "$DISTRO" in fedora44|rocky9) ;; *) RENDERER='renderer: networkd' ;; esac
printf 'version: 2\n%s\nethernets:\n  lan:\n    match: {name: "en*"}\n    dhcp4: true\n    dhcp-identifier: mac\n' "$RENDERER" \
    > "$WORK/network-config"
cloud-localds -N "$WORK/network-config" "$WORK/seed.iso" "$WORK/user-data" "$WORK/meta-data"

# Disks in a storage pool of the VM's name, uploaded through libvirt, so no root is needed.
if ! $V pool-info "$NAME" >/dev/null 2>&1; then
    $V pool-define-as "$NAME" dir --target "/var/lib/libvirt/images/$NAME" >/dev/null
    $V pool-build "$NAME" >/dev/null
    $V pool-start "$NAME" >/dev/null
    $V pool-autostart "$NAME" >/dev/null
fi
$V vol-create-as "$NAME" "$NAME.qcow2" 4G --format qcow2 >/dev/null
$V vol-upload --pool "$NAME" "$NAME.qcow2" "$WORK/$IMAGE_NAME"
$V vol-resize --pool "$NAME" "$NAME.qcow2" 20G >/dev/null
$V vol-create-as "$NAME" seed.iso "$(wc -c < "$WORK/seed.iso")" --format raw >/dev/null
$V vol-upload --pool "$NAME" seed.iso "$WORK/seed.iso"

# TPM is unnecessary for these software-rendered Linux fixtures. Some ARM guest kernels expose no tpmrm0
# for virt-install's default device, causing a 90-second systemd device wait before SSH.
BOOT_OPTION=''
if [ "${TEST_SECURE_BOOT:-1}" = 0 ]; then
    BOOT_OPTION='uefi,firmware.feature0.name=secure-boot,firmware.feature0.enabled=no'
fi
virt-install ${BOOT_OPTION:+--boot "$BOOT_OPTION"} --connect "${LIBVIRT_DEFAULT_URI:-qemu:///system}" --name "$NAME" --memory 4096 --vcpus 2 --import \
    --disk "vol=$NAME/$NAME.qcow2,bus=virtio" --disk "vol=$NAME/seed.iso,device=cdrom" --os-variant "$OS_VARIANT" \
    --network network=default,model=virtio --tpm none --graphics none --noautoconsole >/dev/null

printf 'Waiting for its address'
IP=
i=0; while [ $i -lt 90 ] && [ -z "$IP" ]; do
    sleep 2; printf .; i=$((i+1))
    IP="$($V domifaddr "$NAME" 2>/dev/null | awk '/ipv4/ { sub(/\/.*/, "", $4); print $4; exit }')"
done
echo
[ -n "$IP" ] || { echo "no address after 3 minutes; check: $V console $NAME" >&2; exit 1; }

SSH="ssh ${TEST_SSH_KEY:+-i $TEST_SSH_KEY} -o StrictHostKeyChecking=accept-new -o UserKnownHostsFile=$WORK/known_hosts -o BatchMode=yes -o ConnectTimeout=5 $GUEST_USER@$IP"
i=0; until $SSH true 2>/dev/null; do
    i=$((i+1)); [ $i -lt 60 ] || { echo "no SSH to $GUEST_USER@$IP" >&2; exit 1; }; sleep 3
done
# Let cloud-init finish first (it exits 2 for "done, with warnings", which is fine here).
$SSH cloud-init status --wait >/dev/null 2>&1 || true
$SSH 'cat > /tmp/provision.sh' < "$HERE/provision.sh"
$SSH sudo sh /tmp/provision.sh "$GUEST_USER"
if [ "$DISTRO" = rocky9 ]; then
    $SSH 'cat > /tmp/trd-xrdp-provision.sh' < "$HERE/xrdp.sh"
    $SSH sudo env TEST_PASSWORD_FILE=- sh /tmp/trd-xrdp-provision.sh tabbyxrdp "$GUEST_USER" < "$TEST_XRDP_PASSWORD_FILE"
    $SSH 'sudo systemctl enable --now xrdp; rm -f /tmp/trd-xrdp-provision.sh'
fi
# Freeze cloud-init before ejecting its datasource; otherwise Debian can rediscover the instance on reboot.
$SSH sudo touch /etc/cloud/cloud-init.disabled
# The cloud-init seed isn't needed any more (it would show as a "cidata" drive in Files). Then restart into the
# provisioned system (text mode), as it will run from now on.
SEED_DEV=$($V domblklist "$NAME" --details | awk '$2 == "cdrom" { print $3; exit }')
[ -z "$SEED_DEV" ] || $V change-media "$NAME" "$SEED_DEV" --eject --live --config >/dev/null
$V vol-delete --pool "$NAME" seed.iso >/dev/null 2>&1 || true
$SSH sudo reboot >/dev/null 2>&1 || true
sleep 10
i=0; until $SSH true 2>/dev/null; do
    i=$((i+1)); [ $i -lt 60 ] || { echo "no SSH to $GUEST_USER@$IP after restarting" >&2; exit 1; }; sleep 3
done

echo
echo "Test host ready at $IP (on this host's libvirt network). For the suites, on this host:"
echo "    export TRD_TEST_HOST=$IP TRD_TEST_USER=$GUEST_USER"
echo "From another machine, forward a port to it, for example:"
echo "    ssh -N -L 127.0.0.1:2222:$IP:22 $(id -un)@$(hostname)"
echo "    export TRD_TEST_HOST=127.0.0.1 TRD_TEST_PORT=2222 TRD_TEST_USER=$GUEST_USER"
