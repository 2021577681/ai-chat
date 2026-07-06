import os
import tempfile
import unittest
from types import SimpleNamespace
from unittest import mock

from server import config
from server.files import FilesMixin


class CaptureResponse:
    def __init__(self):
        self.code = None
        self.data = None

    def json(self, code, data):
        self.code = code
        self.data = data


class FileCopyHandler(FilesMixin):
    def __init__(self):
        self.response = CaptureResponse()
        self.request_context = SimpleNamespace(session_id='test-file-copy')


class FileCopyTests(unittest.TestCase):
    def _with_workspace(self, root):
        return mock.patch.multiple(
            config,
            WORKSPACE_ROOT=os.path.realpath(root),
            current_cwd=os.path.realpath(root),
        )

    def test_copy_file_dedupes_target_name(self):
        with tempfile.TemporaryDirectory() as root, self._with_workspace(root), mock.patch('builtins.print'):
            with open(os.path.join(root, 'note.txt'), 'w', encoding='utf-8') as f:
                f.write('content')

            handler = FileCopyHandler()
            handler.handle_copy_file({'path': 'note.txt', 'target_dir': '.', 'dedupe': True})

            copied = os.path.join(root, 'note - 副本.txt')
            self.assertEqual(200, handler.response.code)
            self.assertTrue(handler.response.data['ok'])
            self.assertEqual('file', handler.response.data['type'])
            self.assertTrue(os.path.isfile(copied))
            with open(copied, 'r', encoding='utf-8') as f:
                self.assertEqual('content', f.read())

    def test_copy_directory_recursively(self):
        with tempfile.TemporaryDirectory() as root, self._with_workspace(root), mock.patch('builtins.print'):
            os.makedirs(os.path.join(root, 'folder', 'child'))
            with open(os.path.join(root, 'folder', 'child', 'note.txt'), 'w', encoding='utf-8') as f:
                f.write('content')

            handler = FileCopyHandler()
            handler.handle_copy_file({'path': 'folder', 'target_dir': '.', 'dedupe': True})

            copied = os.path.join(root, 'folder - 副本', 'child', 'note.txt')
            self.assertEqual(200, handler.response.code)
            self.assertTrue(handler.response.data['ok'])
            self.assertEqual('dir', handler.response.data['type'])
            self.assertTrue(os.path.isfile(copied))

    def test_copy_directory_rejects_copy_into_itself(self):
        with tempfile.TemporaryDirectory() as root, self._with_workspace(root), mock.patch('builtins.print'):
            os.makedirs(os.path.join(root, 'folder', 'child'))

            handler = FileCopyHandler()
            handler.handle_copy_file({'path': 'folder', 'target_dir': 'folder/child', 'dedupe': True})

            self.assertEqual(200, handler.response.code)
            self.assertFalse(handler.response.data['ok'])
            self.assertIn('自身内部', handler.response.data['error'])


if __name__ == '__main__':
    unittest.main()
