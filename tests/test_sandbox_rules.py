import tempfile
import unittest
from unittest.mock import patch

from server import config
from server.sandbox import command_workspace_violation


class CommandWorkspaceViolationTests(unittest.TestCase):
    def test_dev_null_redirection_is_allowed_on_posix_shells(self):
        command = (
            "du -sh bge-large-en-v1.5 Qwen3-Embedding-0.6B "
            "Qwen3-Embedding-4B 2>/dev/null || true"
        )

        with tempfile.TemporaryDirectory() as root:
            with patch.object(config, "WORKSPACE_ROOT", root), patch("server.sandbox.os.name", "posix"):
                violates, reason = command_workspace_violation(command)

        self.assertFalse(violates, reason)

    def test_other_posix_absolute_paths_are_still_rejected(self):
        with tempfile.TemporaryDirectory() as root:
            with patch.object(config, "WORKSPACE_ROOT", root), patch("server.sandbox.os.name", "posix"):
                violates, reason = command_workspace_violation("cat /etc/passwd")

        self.assertTrue(violates)
        self.assertIn("/etc/passwd", reason)


if __name__ == "__main__":
    unittest.main()
