# Sourced after HERE, WORK, NAME and V are set. All credential-bearing local files live in one private workspace.
case "$NAME" in ''|*[!A-Za-z0-9-]*) echo 'VM name must contain only letters, digits and hyphens' >&2; exit 2;; esac
[ ${#NAME} -le 63 ] || { echo 'VM name is too long' >&2; exit 2; }
umask 077
# Shell locals do not need to be inherited by curl, libvirt or the renderer process.
private_test_password=$TEST_PASSWORD
private_admin_password=$ADMIN_PASSWORD
unset TEST_PASSWORD ADMIN_PASSWORD
TEST_PASSWORD=$private_test_password
ADMIN_PASSWORD=$private_admin_password
unset private_test_password private_admin_password
PRIVATE_WORK=$(mktemp -d "$WORK/provision.XXXXXX")
CFG="$PRIVATE_WORK/config"
mkdir "$CFG"
CONFIG_UPLOADED=
cleanup_config() {
    status=$?
    trap - EXIT HUP INT TERM
    if [ -n "$CONFIG_UPLOADED" ]; then
        # Eject only this run's config disc. On failure the VM may need provisioning restarted with fresh media.
        $V change-media "$NAME" sdc --eject --config >/dev/null 2>&1 || true
        $V change-media "$NAME" sdc --eject --live >/dev/null 2>&1 || true
        $V vol-delete --pool "$NAME" config.iso >/dev/null 2>&1 || \
            echo "Remove the credential disc manually: $V vol-delete --pool $NAME config.iso" >&2
    fi
    rm -rf -- "$PRIVATE_WORK"
    exit "$status"
}
trap cleanup_config EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM
