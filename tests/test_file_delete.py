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


class FileDeleteHandler(FilesMixin):
    def __init__(self):
        self.response = CaptureResponse()
        self.request_context = SimpleNamespace(session_id='test-file-delete')


class FileDeleteTests(unittest.TestCase):
    def _with_workspace(self, root):
        return mock.patch.multiple(
            config,
            WORKSPACE_ROOT=os.path.realpath(root),
            current_cwd=os.path.realpath(root),
        )

    def test_non_recursive_delete_rejects_non_empty_directory(self):
        with tempfile.TemporaryDirectory() as root, self._with_workspace(root), mock.patch('builtins.print'):
            os.makedirs(os.path.join(root, 'folder', 'child'))
            with open(os.path.join(root, 'folder', 'child', 'note.txt'), 'w', encoding='utf-8') as f:
                f.write('content')

            handler = FileDeleteHandler()
            handler.handle_delete_file({'path': 'folder'})

            self.assertEqual(200, handler.response.code)
            self.assertFalse(handler.response.data['ok'])
            self.assertTrue(os.path.isdir(os.path.join(root, 'folder')))

    def test_recursive_delete_removes_non_empty_directory(self):
        with tempfile.TemporaryDirectory() as root, self._with_workspace(root), mock.patch('builtins.print'):
            os.makedirs(os.path.join(root, 'folder', 'child'))
            with open(os.path.join(root, 'folder', 'child', 'note.txt'), 'w', encoding='utf-8') as f:
                f.write('content')

            handler = FileDeleteHandler()
            handler.handle_delete_file({'path': 'folder', 'recursive': True})

            self.assertEqual(200, handler.response.code)
            self.assertTrue(handler.response.data['ok'])
            self.assertEqual('dir', handler.response.data['type'])
            self.assertTrue(handler.response.data['recursive'])
            self.assertFalse(os.path.exists(os.path.join(root, 'folder')))

    def test_recursive_delete_rejects_workspace_root(self):
        with tempfile.TemporaryDirectory() as root, self._with_workspace(root), mock.patch('builtins.print'):
            with open(os.path.join(root, 'note.txt'), 'w', encoding='utf-8') as f:
                f.write('content')

            handler = FileDeleteHandler()
            handler.handle_delete_file({'path': '.', 'recursive': True})

            self.assertEqual(200, handler.response.code)
            self.assertFalse(handler.response.data['ok'])
            self.assertTrue(os.path.isdir(root))
            self.assertTrue(os.path.exists(os.path.join(root, 'note.txt')))


if __name__ == '__main__':
    unittest.main()
