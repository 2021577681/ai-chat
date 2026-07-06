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


class FileMoveHandler(FilesMixin):
    def __init__(self):
        self.response = CaptureResponse()
        self.request_context = SimpleNamespace(session_id='test-file-move')


class FileMoveTests(unittest.TestCase):
    def _with_workspace(self, root):
        return mock.patch.multiple(
            config,
            WORKSPACE_ROOT=os.path.realpath(root),
            current_cwd=os.path.realpath(root),
        )

    def test_move_file_to_target_directory(self):
        with tempfile.TemporaryDirectory() as root, self._with_workspace(root), mock.patch('builtins.print'):
            os.makedirs(os.path.join(root, 'dest'))
            with open(os.path.join(root, 'note.txt'), 'w', encoding='utf-8') as f:
                f.write('content')

            handler = FileMoveHandler()
            handler.handle_move_file({'path': 'note.txt', 'target_dir': 'dest', 'dedupe': True})

            moved = os.path.join(root, 'dest', 'note.txt')
            self.assertEqual(200, handler.response.code)
            self.assertTrue(handler.response.data['ok'])
            self.assertEqual('file', handler.response.data['type'])
            self.assertFalse(os.path.exists(os.path.join(root, 'note.txt')))
            self.assertTrue(os.path.isfile(moved))
            with open(moved, 'r', encoding='utf-8') as f:
                self.assertEqual('content', f.read())

    def test_move_file_dedupes_conflicting_target(self):
        with tempfile.TemporaryDirectory() as root, self._with_workspace(root), mock.patch('builtins.print'):
            os.makedirs(os.path.join(root, 'dest'))
            with open(os.path.join(root, 'note.txt'), 'w', encoding='utf-8') as f:
                f.write('source')
            with open(os.path.join(root, 'dest', 'note.txt'), 'w', encoding='utf-8') as f:
                f.write('existing')

            handler = FileMoveHandler()
            handler.handle_move_file({'path': 'note.txt', 'target_dir': 'dest', 'dedupe': True})

            moved = os.path.join(root, 'dest', 'note - 副本.txt')
            self.assertEqual(200, handler.response.code)
            self.assertTrue(handler.response.data['ok'])
            self.assertFalse(os.path.exists(os.path.join(root, 'note.txt')))
            self.assertTrue(os.path.isfile(moved))
            with open(os.path.join(root, 'dest', 'note.txt'), 'r', encoding='utf-8') as f:
                self.assertEqual('existing', f.read())

    def test_move_directory_rejects_move_into_itself(self):
        with tempfile.TemporaryDirectory() as root, self._with_workspace(root), mock.patch('builtins.print'):
            os.makedirs(os.path.join(root, 'folder', 'child'))

            handler = FileMoveHandler()
            handler.handle_move_file({'path': 'folder', 'target_dir': 'folder/child', 'dedupe': True})

            self.assertEqual(200, handler.response.code)
            self.assertFalse(handler.response.data['ok'])
            self.assertIn('自身内部', handler.response.data['error'])
            self.assertTrue(os.path.isdir(os.path.join(root, 'folder', 'child')))


if __name__ == '__main__':
    unittest.main()
