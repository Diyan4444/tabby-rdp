#!/bin/sh
# Creates an Ubuntu 24.04 (default), Debian 13, Fedora 44 or Rocky 9 test VM, provisioned with provision.sh and
# reachable over SSH with your key, then prints the settings for the test suites. Run it on the libvirt host, as a
# user in the libvirt group (no root needed); it needs virt-install and cloud-localds (cloud-image-utils).
#
#     testbed/linux/libvirt.sh [vm-name] [public-key-file]
# Rocky uses Xfce/xrdp; set TEST_XRDP_PASSWORD_FILE to a private file for its dedicated tabbyxrdp account.
# fedora44-kde uses Plasma/KRDP; set TEST_KRDP_PASSWORD_FILE, then complete its documented console setup.
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
DISTRO="${TEST_DISTRO:-ubuntu2404}"
case "$DISTRO" in
    ubuntu2404) GUEST_USER=ubuntu; OS_VARIANT=ubuntu24.04 ;;
    debian13) GUEST_USER=debian; OS_VARIANT=debian13 ;;
    fedora44|fedora44-kde) GUEST_USER=fedora; OS_VARIANT=fedora-unknown ;;
    rocky9) GUEST_USER=rocky; OS_VARIANT=rocky9 ;;
    *) echo 'TEST_DISTRO must be ubuntu2404, debian13, fedora44, fedora44-kde or rocky9' >&2; exit 2 ;;
esac
if [ "$DISTRO" = rocky9 ]; then
    [ -f "${TEST_XRDP_PASSWORD_FILE:-}" ] || { echo 'Set TEST_XRDP_PASSWORD_FILE to a private password file for Rocky/Xfce/xrdp' >&2; exit 2; }
fi
if [ "$DISTRO" = fedora44-kde ]; then
    [ -f "${TEST_KRDP_PASSWORD_FILE:-}" ] || { echo 'Set TEST_KRDP_PASSWORD_FILE to a private password file for the dedicated KDE account' >&2; exit 2; }
fi
# Preserve the release branch's reviewed-media requirement for every distro.
# UBUNTU_IMAGE/SHA256 remain compatible aliases only for the Ubuntu profile.
if [ "$DISTRO" = ubuntu2404 ]; then
    TEST_IMAGE="${TEST_IMAGE:-${UBUNTU_IMAGE:-}}"
    TEST_IMAGE_SHA256="${TEST_IMAGE_SHA256:-${UBUNTU_IMAGE_SHA256:-}}"
fi
: "${TEST_IMAGE:?set TEST_IMAGE to a reviewed local cloud image for the selected distro and architecture}"
: "${TEST_IMAGE_SHA256:?set TEST_IMAGE_SHA256 to the reviewed image SHA-256}"
sh "$HERE/../verify-image.sh" "$TEST_IMAGE" "$TEST_IMAGE_SHA256"
WORK="${TESTBED_DIR:-${XDG_CACHE_HOME:-$HOME/.cache}/tabby-rdp-testbed/$DISTRO}"
mkdir -p "$WORK"
# Refuse to modify an existing guest, including another test thread's VM.
if $V dominfo "$NAME" >/dev/null 2>&1; then echo "VM already exists: $NAME" >&2; exit 2; fi
printf 'instance-id: %s\nlocal-hostname: %s\n' "$NAME" "$NAME" > "$WORK/meta-data"
{
    printf '#cloud-config\nhostname: %s\nusers:\n  - default\nssh_pwauth: false\nssh_authorized_keys:\n' "$NAME"
    grep -v '^[[:space:]]*$' "$KEY" | sed 's/^/  - /'
} > "$WORK/user-data"
# DHCP by MAC address: the desktop packages bring NetworkManager, which asks for a lease by MAC, and the address
# would change at the first reboot otherwise.
RENDERER=''
case "$DISTRO" in fedora44|fedora44-kde|rocky9) ;; *) RENDERER='renderer: networkd' ;; esac
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
$V vol-upload --pool "$NAME" "$NAME.qcow2" "$TEST_IMAGE"
$V vol-resize --pool "$NAME" "$NAME.qcow2" 20G >/dev/null
$V vol-create-as "$NAME" seed.iso "$(wc -c < "$WORK/seed.iso")" --format raw >/dev/null
$V vol-upload --pool "$NAME" seed.iso "$WORK/seed.iso"

# TPM is unnecessary for these software-rendered Linux fixtures. Some ARM guest kernels expose no tpmrm0
# for virt-install's default device, causing a 90-second systemd device wait before SSH.
BOOT_OPTION=''
if [ "${TEST_SECURE_BOOT:-1}" = 0 ]; then
    BOOT_OPTION='uefi,firmware.feature0.name=secure-boot,firmware.feature0.enabled=no'
fi
DISPLAY_ARGS='--graphics none'
if [ "$DISTRO" = fedora44-kde ]; then DISPLAY_ARGS='--graphics vnc,listen=127.0.0.1 --video virtio'; fi
virt-install ${BOOT_OPTION:+--boot "$BOOT_OPTION"} --connect "${LIBVIRT_DEFAULT_URI:-qemu:///system}" --name "$NAME" --memory 4096 --vcpus 2 --import \
    --disk "vol=$NAME/$NAME.qcow2,bus=virtio" --disk "vol=$NAME/seed.iso,device=cdrom" --os-variant "$OS_VARIANT" \
    --network network=default,model=virtio --tpm none $DISPLAY_ARGS --noautoconsole >/dev/null

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
if [ "$DISTRO" = fedora44-kde ]; then
    $SSH 'cat > /tmp/provision.sh' < "$HERE/kde.sh"
    $SSH sudo sh /tmp/provision.sh "$GUEST_USER" < "$TEST_KRDP_PASSWORD_FILE"
else
    $SSH 'cat > /tmp/provision.sh' < "$HERE/provision.sh"
    $SSH 'cat > /tmp/winrm-requirements.txt' < "$HERE/winrm-requirements.txt"
    $SSH sudo sh /tmp/provision.sh "$GUEST_USER"
fi
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
echo "Test SSH host ready at $IP (on this host's libvirt network). For the suites, on this host:"
if [ "$DISTRO" = fedora44-kde ]; then echo 'KDE visual tests additionally require the wallet/display setup in docs/visual-qa.md.'; fi
echo "    export TRD_TEST_HOST=$IP TRD_TEST_USER=$GUEST_USER"
echo "From another machine, forward a port to it, for example:"
echo "    ssh -N -L 127.0.0.1:2222:$IP:22 $(id -un)@$(hostname)"
echo "    export TRD_TEST_HOST=127.0.0.1 TRD_TEST_PORT=2222 TRD_TEST_USER=$GUEST_USER"
