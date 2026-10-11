"""Local regression checks; no VM, real credential, or elevated process is used."""
import os
import pathlib
import subprocess
import tempfile
import unittest
import xml.etree.ElementTree as ET

ROOT = pathlib.Path(__file__).resolve().parent


class Credentials(unittest.TestCase):
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
