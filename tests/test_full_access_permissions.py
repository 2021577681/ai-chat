import os
import tempfile
import unittest
from unittest import mock

from server import config
from server.sandbox import check_path_or_error, command_workspace_violation, is_inside_workspace


class FullAccessPermissionTests(unittest.TestCase):
    def _with_workspace(self, root):
        return mock.patch.multiple(
            config,
            WORKSPACE_ROOT=os.path.realpath(root),
            current_cwd=os.path.realpath(root),
        )

    def test_sandbox_blocks_outside_path_without_full_access(self):
        with tempfile.TemporaryDirectory() as root, tempfile.TemporaryDirectory() as outside, self._with_workspace(root):
            outside_file = os.path.join(outside, 'note.txt')

            self.assertFalse(is_inside_workspace(outside_file))
            _, err = check_path_or_error(outside_file)

            self.assertIsNotNone(err)

    def test_full_access_request_allows_outside_path(self):
        with tempfile.TemporaryDirectory() as root, tempfile.TemporaryDirectory() as outside, self._with_workspace(root):
            outside_file = os.path.join(outside, 'note.txt')
            token = config.bind_request_full_access(True)
            try:
                self.assertTrue(is_inside_workspace(outside_file))
                path, err = check_path_or_error(outside_file)
                self.assertEqual(os.path.realpath(outside_file), os.path.realpath(path))
                self.assertIsNone(err)
            finally:
                config.reset_request_full_access(token)

            self.assertFalse(is_inside_workspace(outside_file))

    def test_full_access_request_disables_shell_workspace_boundary_only(self):
        with tempfile.TemporaryDirectory() as root, self._with_workspace(root):
            violation, _ = command_workspace_violation('type C:\\outside\\secret.txt')
            self.assertTrue(violation)

            token = config.bind_request_full_access(True)
            try:
                violation, reason = command_workspace_violation('type C:\\outside\\secret.txt')
                self.assertFalse(violation)
                self.assertEqual('', reason)
            finally:
                config.reset_request_full_access(token)


if __name__ == '__main__':
    unittest.main()
