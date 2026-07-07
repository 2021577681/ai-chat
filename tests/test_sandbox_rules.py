import tempfile
import unittest
from unittest.mock import patch

from server import config
from server.sandbox import command_workspace_violation, is_dangerous_command


class CommandWorkspaceViolationTests(unittest.TestCase):
    def test_safe_workspace_rm_rf_targets_are_allowed(self):
        command = (
            "rm -rf TIGER-official-repro.zip TIGER-official-repro-src && "
            "env -u http_proxy -u https_proxy -u HTTP_PROXY -u HTTPS_PROXY "
            "wget -O TIGER-official-repro.zip https://github.com/XiaoLongtaoo/TIGER/archive/refs/heads/main.zip"
        )

        with tempfile.TemporaryDirectory() as root:
            with patch.object(config, "WORKSPACE_ROOT", root):
                dangerous, reason = is_dangerous_command(command, cwd=root)

        self.assertFalse(dangerous, reason)

    def test_rm_rf_root_and_globs_are_still_blocked(self):
        with tempfile.TemporaryDirectory() as root:
            with patch.object(config, "WORKSPACE_ROOT", root):
                for command in ("rm -rf /", "rm -rf *", "rm -rf .."):
                    dangerous, reason = is_dangerous_command(command, cwd=root)
                    self.assertTrue(dangerous, command)
                    self.assertTrue(reason)

    def test_dev_null_redirection_is_allowed_on_posix_shells(self):
        command = (
            "du -sh bge-large-en-v1.5 Qwen3-Embedding-0.6B "
            "Qwen3-Embedding-4B 2>/dev/null || true"
        )

        with tempfile.TemporaryDirectory() as root:
            with patch.object(config, "WORKSPACE_ROOT", root), patch("server.sandbox.os.name", "posix"):
                violates, reason = command_workspace_violation(command)

        self.assertFalse(violates, reason)

    def test_shell_variable_path_joins_do_not_look_like_root(self):
        command = (
            'backup_dir=$(ls -td saved/cache_backup_* | head -1)\n'
            'if [ -f "$f" ]; then mv "$f" "$backup_dir"/; fi\n'
            'echo "log=$PWD/$log"\n'
            'if ps -p $(cat logs_run/yelp_nlgcl.pid) > /dev/null; then echo running; fi'
        )

        with tempfile.TemporaryDirectory() as root:
            with patch.object(config, "WORKSPACE_ROOT", root), patch("server.sandbox.os.name", "posix"):
                violates, reason = command_workspace_violation(command)

        self.assertFalse(violates, reason)

    def test_parent_path_after_cd_is_allowed_when_still_in_workspace(self):
        command = (
            "cd NLGCL && ../conda_envs/nlgcl/bin/python - <<'PY'\n"
            "import main\n"
            "print('NLGCL main import OK')\n"
            "PY"
        )

        with tempfile.TemporaryDirectory() as root:
            with patch.object(config, "WORKSPACE_ROOT", root), patch("server.sandbox.os.name", "posix"):
                violates, reason = command_workspace_violation(command, cwd=root)

        self.assertFalse(violates, reason)

    def test_parent_path_after_cd_is_rejected_when_outside_workspace(self):
        command = "cd NLGCL && ../../outside/bin/python main.py"

        with tempfile.TemporaryDirectory() as root:
            with patch.object(config, "WORKSPACE_ROOT", root), patch("server.sandbox.os.name", "posix"):
                violates, reason = command_workspace_violation(command, cwd=root)

        self.assertTrue(violates)
        self.assertIn("..", reason)

    def test_other_posix_absolute_paths_are_still_rejected(self):
        with tempfile.TemporaryDirectory() as root:
            with patch.object(config, "WORKSPACE_ROOT", root), patch("server.sandbox.os.name", "posix"):
                violates, reason = command_workspace_violation("cat /etc/passwd")

        self.assertTrue(violates)
        self.assertIn("/etc/passwd", reason)


if __name__ == "__main__":
    unittest.main()
