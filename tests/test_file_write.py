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

    def test_file_upload_chunk_assembles_binary_file(self):
        payload = b'chunk-one-\x00\x01chunk-two-\xff'
        first = payload[:11]
        second = payload[11:]

        with tempfile.TemporaryDirectory() as root, self._with_workspace(root), mock.patch('builtins.print'):
            handler = FileWriteHandler()
            handler.handle_file_upload_chunk({
                'path': 'uploads/chunked.bin',
                'upload_id': 'upload-test',
                'content': base64.b64encode(first).decode('ascii'),
                'encoding': 'base64',
                'offset': 0,
                'chunk_index': 0,
                'total_chunks': 2,
                'total_size': len(payload),
                'done': False
            })
            target = os.path.join(root, 'uploads', 'chunked.bin')
            self.assertEqual(200, handler.response.code)
            self.assertTrue(handler.response.data['ok'])
            self.assertFalse(os.path.exists(target))
            checkpoint_id = handler.response.data['checkpoint_id']

            handler = FileWriteHandler()
            handler.handle_file_upload_chunk({
                'path': 'uploads/chunked.bin',
                'upload_id': 'upload-test',
                'content': base64.b64encode(second).decode('ascii'),
                'encoding': 'base64',
                'offset': len(first),
                'chunk_index': 1,
                'total_chunks': 2,
                'total_size': len(payload),
                'done': True,
                'checkpoint_id': checkpoint_id
            })

            self.assertEqual(200, handler.response.code)
            self.assertTrue(handler.response.data['ok'])
            self.assertTrue(handler.response.data['complete'])
            self.assertEqual(len(payload), handler.response.data['bytes_received'])
            with open(target, 'rb') as f:
                self.assertEqual(payload, f.read())

    def test_file_upload_chunk_rejects_offset_mismatch(self):
        payload = b'first'

        with tempfile.TemporaryDirectory() as root, self._with_workspace(root), mock.patch('builtins.print'):
            handler = FileWriteHandler()
            handler.handle_file_upload_chunk({
                'path': 'uploads/chunked.bin',
                'upload_id': 'upload-test',
                'content': base64.b64encode(payload).decode('ascii'),
                'encoding': 'base64',
                'offset': 0,
                'chunk_index': 0,
                'total_chunks': 2,
                'total_size': 10,
                'done': False
            })
            self.assertTrue(handler.response.data['ok'])

            handler = FileWriteHandler()
            handler.handle_file_upload_chunk({
                'path': 'uploads/chunked.bin',
                'upload_id': 'upload-test',
                'content': base64.b64encode(b'second').decode('ascii'),
                'encoding': 'base64',
                'offset': 1,
                'chunk_index': 1,
                'total_chunks': 2,
                'total_size': 11,
                'done': True
            })

            self.assertEqual(200, handler.response.code)
            self.assertFalse(handler.response.data['ok'])
            self.assertIn('expected_offset', handler.response.data)


if __name__ == '__main__':
    unittest.main()
