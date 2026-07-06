import base64
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


class FileWriteHandler(FilesMixin):
    def __init__(self):
        self.response = CaptureResponse()
        self.request_context = SimpleNamespace(session_id='test-file-write')


class FileWriteTests(unittest.TestCase):
    def _with_workspace(self, root):
        return mock.patch.multiple(
            config,
            WORKSPACE_ROOT=os.path.realpath(root),
            current_cwd=os.path.realpath(root),
        )

    def test_write_file_accepts_base64_binary_content(self):
        payload = b'\x00\xff\x10binary\npayload'
        data_url = 'data:application/octet-stream;base64,' + base64.b64encode(payload).decode('ascii')

        with tempfile.TemporaryDirectory() as root, self._with_workspace(root), mock.patch('builtins.print'):
            handler = FileWriteHandler()
            handler.handle_write_file({
                'path': 'uploads/payload.bin',
                'content': data_url,
                'encoding': 'base64'
            })

            target = os.path.join(root, 'uploads', 'payload.bin')
            self.assertEqual(200, handler.response.code)
            self.assertTrue(handler.response.data['ok'])
            self.assertEqual(len(payload), handler.response.data['bytes_written'])
            self.assertEqual('base64', handler.response.data['encoding'])
            with open(target, 'rb') as f:
                self.assertEqual(payload, f.read())


if __name__ == '__main__':
    unittest.main()
