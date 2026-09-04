from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from apps.launcher.single_instance import SingleInstanceLock


class SingleInstanceLockTests(unittest.TestCase):
    def test_allows_only_one_launcher_for_the_same_installation(self) -> None:
        with tempfile.TemporaryDirectory(prefix="lyra-launcher-instance-") as temporary:
            lock_path = Path(temporary) / "launcher-instance.lock"
            first = SingleInstanceLock(lock_path)
            second = SingleInstanceLock(lock_path)
            try:
                self.assertTrue(first.acquire())
                self.assertFalse(second.acquire())
                first.release()
                self.assertTrue(second.acquire())
            finally:
                first.release()
                second.release()


if __name__ == "__main__":
    unittest.main()
