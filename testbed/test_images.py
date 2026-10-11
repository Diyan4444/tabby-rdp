"""Verify the installation-media guard without downloading or booting a VM."""
import hashlib
import os
import pathlib
import subprocess
import tempfile
import unittest

VERIFY = pathlib.Path(__file__).resolve().parent / "verify-image.sh"


class Images(unittest.TestCase):
    def test_every_libvirt_profile_verifies_media_before_provisioning(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            image = root / "reviewed image.qcow2"
            image.write_bytes(b"test cloud image")
            digest = hashlib.sha256(image.read_bytes()).hexdigest()
            key = root / "test.pub"
            key.write_text("ssh-ed25519 test-fixture\n")
            password = root / "password"
            password.write_text("disposable-test-only\n")
            # Stop at the first provisioning step; no real hypervisor commands can run.
            for name, body in {"virsh": "exit 1", "virt-install": "exit 99", "cloud-localds": "exit 23"}.items():
                stub = root / name
                stub.write_text("#!/bin/sh\n" + body + "\n")
                stub.chmod(0o755)
            for distro in ("ubuntu2404", "debian13", "fedora44", "fedora44-kde", "rocky9"):
                for supplied, expected in ((digest, (23,)), ("0" * 64, (1,)), ("", (1, 2))):
                    with self.subTest(distro=distro, valid=supplied == digest):
                        env = dict(os.environ, PATH=str(root) + os.pathsep + os.environ["PATH"],
                                   TEST_DISTRO=distro, TEST_IMAGE=str(image), TEST_IMAGE_SHA256=supplied,
                                   TESTBED_DIR=str(root / "work"), TEST_XRDP_PASSWORD_FILE=str(password),
                                   TEST_KRDP_PASSWORD_FILE=str(password), UBUNTU_IMAGE_SHA256="")
                        result = subprocess.run(["sh", str(VERIFY.parent / "linux/libvirt.sh"), "qa-test", str(key)],
                                                env=env, capture_output=True)
                        self.assertIn(result.returncode, expected, result.stderr)

    def test_accepts_only_matching_complete_digest(self):
        with tempfile.TemporaryDirectory() as directory:
            image = pathlib.Path(directory) / "media with spaces.img"
            image.write_bytes(b"small test image")
            digest = hashlib.sha256(image.read_bytes()).hexdigest()
            for value, expected in ((digest, 0), (digest.upper(), 0), ("0" * 64, 1), ("", 2), ("x" * 64, 2), (digest[:-1], 2)):
                with self.subTest(value=value):
                    result = subprocess.run(["sh", str(VERIFY), str(image), value], capture_output=True)
                    self.assertEqual(result.returncode, expected, result.stderr)
            image.write_bytes(b"different image!")
            result = subprocess.run(["sh", str(VERIFY), str(image), digest], capture_output=True)
            self.assertEqual(result.returncode, 1)
            image.unlink()
            result = subprocess.run(["sh", str(VERIFY), str(image), digest], capture_output=True)
            self.assertEqual(result.returncode, 2)


if __name__ == "__main__":
    unittest.main()
