"""Local regression checks; no VM, real credential, or elevated process is used."""
import os
import pathlib
import subprocess
import tempfile
import unittest
import xml.etree.ElementTree as ET

ROOT = pathlib.Path(__file__).resolve().parent


class Credentials(unittest.TestCase):
    def test_xrdp_password_sources_cross_sudo_only_on_stdin(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            password = "disposable-xrdp-test-only"
            secret_file = root / "password"
            secret_file.write_text(password + "\n")
            (root / "id").write_text("#!/bin/sh\nprintf '1000\\n'\n")
            (root / "sudo").write_text("""#!/bin/sh
if [ "$1" = -v ]; then exit 0; fi
for arg in "$@"; do
    case "$arg" in *disposable-xrdp-test-only*) exit 98;; esac
done
[ "$1" = -n ] && [ "$2" = env ] || exit 97
IFS= read -r received
[ "$received" = disposable-xrdp-test-only ] || exit 96
exit 0
""")
            for name in ("id", "sudo"):
                (root / name).chmod(0o755)
            for source in ("file", "stdin", "environment"):
                with self.subTest(source=source):
                    env = dict(os.environ, PATH=str(root) + os.pathsep + os.environ["PATH"])
                    env.pop("TEST_PASSWORD", None)
                    env.pop("TEST_PASSWORD_FILE", None)
                    if source == "file": env["TEST_PASSWORD_FILE"] = str(secret_file)
                    if source == "stdin": env["TEST_PASSWORD_FILE"] = "-"
                    if source == "environment": env["TEST_PASSWORD"] = password
                    result = subprocess.run(["sh", str(ROOT / "linux/xrdp.sh"), "qa-user", "ssh-user"],
                                            input=(password + "\n").encode(), env=env, capture_output=True)
                    self.assertEqual(result.returncode, 0, result.stderr)
                    self.assertNotIn(password.encode(), result.stdout + result.stderr)

    def test_answer_files_keep_passwords_out_of_commands(self):
        administrator = "Admin<&'\"$`test1"
        password = "Test<&'\"$`%value1"
        for variant in ("windows", "windows-server"):
            with self.subTest(variant=variant), tempfile.TemporaryDirectory() as directory:
                result = subprocess.run(
                    ["python3", str(ROOT / "render-answer.py"), str(ROOT / variant / "autounattend.xml"), directory],
                    input="\0".join(("test-vm", administrator, password, "-NoGuestStart")).encode(),
                    capture_output=True,
                )
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual(result.stdout, b"")
                answer = ET.parse(pathlib.Path(directory) / "autounattend.xml")
                namespace = {"u": "urn:schemas-microsoft-com:unattend"}
                commands = answer.findall(".//u:CommandLine", namespace)
                self.assertTrue(any("-PasswordFile" in command.text for command in commands))
                for command in commands:
                    self.assertNotIn(password, command.text)
                    self.assertNotIn(administrator, command.text)
                    self.assertNotIn(" -Password ", command.text)
                self.assertEqual(answer.find(".//u:AutoLogon/u:Password/u:Value", namespace).text, administrator)
                self.assertEqual((pathlib.Path(directory) / "test-password.txt").read_text(), password)

    def test_private_workspace_cleanup_success_failure_and_signal(self):
        for ending, code in (("exit 0", 0), ("exit 23", 23), ("kill -TERM $$", 143)):
            with self.subTest(ending=ending), tempfile.TemporaryDirectory() as directory:
                environment = dict(os.environ, WORK=directory, NAME="test-vm", V="true",
                                   TEST_PASSWORD="dummy-test", ADMIN_PASSWORD="dummy-admin")
                command = '''
set -eu
. "$1"
python3 -c 'import os, sys; assert os.stat(sys.argv[1]).st_mode & 0o777 == 0o700' "$PRIVATE_WORK"
env | grep -q '^TEST_PASSWORD=' && exit 98
env | grep -q '^ADMIN_PASSWORD=' && exit 99
printf '%s' "$TEST_PASSWORD" > "$CFG/test-password.txt"
CONFIG_UPLOADED=1
''' + ending
                result = subprocess.run(["sh", "-c", command, "test", str(ROOT / "config-workspace.sh")],
                                        env=environment, capture_output=True)
                self.assertEqual(result.returncode, code, result.stderr)
                self.assertEqual(list(pathlib.Path(directory).iterdir()), [])
                self.assertNotIn(b"dummy", result.stdout + result.stderr)

    def test_invalid_vm_name_is_rejected_before_workspace_creation(self):
        with tempfile.TemporaryDirectory() as directory:
            result = subprocess.run(["sh", "-c", '. "$1"', "test", str(ROOT / "config-workspace.sh")],
                                    env=dict(os.environ, WORK=directory, NAME="../outside", V="true"), capture_output=True)
            self.assertEqual(result.returncode, 2)
            self.assertEqual(list(pathlib.Path(directory).iterdir()), [])


if __name__ == "__main__":
    unittest.main()
