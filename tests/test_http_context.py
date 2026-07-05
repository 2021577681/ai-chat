import io
import json
import unittest
from pathlib import Path

from server.http_context import RequestContext, ResponseWriter


ROOT = Path(__file__).resolve().parents[1]


class FakeHandler:
    def __init__(self):
        self.headers = {'Origin': 'http://localhost:8765'}
        self.wfile = io.BytesIO()
        self.status = None
        self.sent_headers = []
        self.ended = False

    def send_response(self, code):
        self.status = code

    def send_header(self, name, value):
        self.sent_headers.append((name, value))

    def end_headers(self):
        self.ended = True


class HttpContextTests(unittest.TestCase):
    def test_response_writer_json_adds_context_data(self):
        handler = FakeHandler()
        context = RequestContext(
            method='GET',
            path='/health',
            headers=handler.headers,
            cwd='C:/work/project',
            workspace='C:/work',
        )

        ResponseWriter(handler, context).json(200, {'ok': True})

        payload = json.loads(handler.wfile.getvalue().decode('utf-8'))
        self.assertEqual(200, handler.status)
        self.assertTrue(handler.ended)
        self.assertEqual('C:/work', payload['workspace'])
        self.assertEqual('C:/work/project', payload['cwd'])
        self.assertIn(('Access-Control-Allow-Origin', 'http://localhost:8765'), handler.sent_headers)
        self.assertIn(('Content-Type', 'application/json; charset=utf-8'), handler.sent_headers)

    def test_response_writer_exposes_streaming_primitives(self):
        handler = FakeHandler()
        writer = ResponseWriter(handler, RequestContext(method='GET', path='/music-file', headers=handler.headers))

        writer.status(206)
        writer.cors_headers()
        writer.header('Content-Length', 4)
        writer.end()
        writer.write(b'test')

        self.assertEqual(206, handler.status)
        self.assertTrue(handler.ended)
        self.assertEqual(b'test', handler.wfile.getvalue())
        self.assertIn(('Content-Length', '4'), handler.sent_headers)

    def test_request_context_exposes_query_and_headers(self):
        context = RequestContext(
            method='GET',
            path='/preview-file?path=docs/readme.md',
            headers={'Range': 'bytes=0-10'},
        )

        self.assertEqual('bytes=0-10', context.header('Range'))
        self.assertEqual(['docs/readme.md'], context.query['path'])

    def test_request_context_reads_json_body(self):
        body = io.BytesIO('{"ok": true}'.encode('utf-8'))
        context = RequestContext(
            method='POST',
            path='/action',
            headers={'Content-Length': str(len(body.getvalue()))},
            body_reader=body,
        )

        self.assertEqual({'ok': True}, context.read_json())

    def test_migrated_mixins_do_not_use_private_json_sender(self):
        for relative_path in (
            'server/workspace.py',
            'server/mcp_skills.py',
            'server/ppt_core.py',
            'server/music.py',
            'server/web.py',
            'server/files.py',
            'server/exec.py',
            'server/git_ops.py',
            'server/proxy.py',
            'server/preview.py',
            'server/remote.py',
            'server/screenshot.py',
            'server/wechat_bridge.py',
        ):
            text = (ROOT / relative_path).read_text(encoding='utf-8')
            self.assertNotIn('_send_json', text, relative_path)
            for implicit_attr in (
                'self.headers',
                'self.path',
                'self.send_response',
                'self.send_header',
                'self.end_headers',
                'self.wfile',
                'self.rfile',
                'self.session_id',
            ):
                self.assertNotIn(implicit_attr, text, f'{relative_path}: {implicit_attr}')


if __name__ == '__main__':
    unittest.main()
