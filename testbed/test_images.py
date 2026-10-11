"""Verify the installation-media guard without downloading or booting a VM."""
import hashlib
import pathlib
import subprocess
import tempfile
import unittest

VERIFY = pathlib.Path(__file__).resolve().parent / "verify-image.sh"


class Images(unittest.TestCase):
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
