import unittest
from pathlib import Path
from unittest import mock

from server.exec import (
    ExecMixin,
    _apply_git_proxy_env,
    _command_invokes_git,
    _coerce_execute_timeout,
    _git_proxy_bat_lines,
    _normalize_local_git_proxy_url,
    _remote_terminal_ssh_args,
)
from server.handler import Handler
from server.routes import (
    ACTION_ROUTE_BY_NAME,
    ACTION_ROUTES,
    GET_EXACT_ROUTES,
    GET_PREFIX_ROUTES,
    POST_PREFIX_ROUTES,
)
from server.web import WebMixin


ROOT = Path(__file__).resolve().parents[1]


class ServerRouteTests(unittest.TestCase):
    def test_all_route_handlers_exist(self):
        routes = (
            list(GET_EXACT_ROUTES)
            + list(GET_PREFIX_ROUTES)
            + list(POST_PREFIX_ROUTES)
            + list(ACTION_ROUTES)
        )
        missing = [route.handler for route in routes if not hasattr(Handler, route.handler)]
        self.assertEqual([], missing)

    def test_action_names_are_unique(self):
        actions = [route.action for route in ACTION_ROUTES]
        duplicates = sorted({action for action in actions if actions.count(action) > 1})
        self.assertEqual([], duplicates)

    def test_action_index_matches_declared_routes(self):
        indexed_actions = set(ACTION_ROUTE_BY_NAME)
        declared_actions = {route.action for route in ACTION_ROUTES}
        self.assertEqual(declared_actions, indexed_actions)


class WebProxyTests(unittest.TestCase):
    def setUp(self):
        self.web = WebMixin()

    def test_local_proxy_urls_are_normalized_like_git_proxy(self):
        cases = {
            'http://localhost:7890': 'http://127.0.0.1:7890',
            'https://127.0.0.1:7890': 'http://127.0.0.1:7890',
            'socks5://localhost:7890': 'socks5h://127.0.0.1:7890',
            'socks5h://127.0.0.1:7890': 'socks5h://127.0.0.1:7890',
        }
        for raw, expected in cases.items():
            with self.subTest(raw=raw):
                normalized, error = self.web._normalize_local_web_proxy_url(raw)
                self.assertIsNone(error)
                self.assertEqual(expected, normalized)

    def test_non_local_proxy_urls_are_rejected(self):
        normalized, error = self.web._normalize_local_web_proxy_url('http://proxy.example.com:7890')

        self.assertEqual('', normalized)
        self.assertIn('local proxy', error)

    def test_proxy_flag_honors_explicit_false(self):
        proxies, proxy_url, error = self.web._web_proxy_config({
            'proxy_enabled': False,
            'use_proxy': True,
            'proxy_url': 'http://127.0.0.1:7890',
        })

        self.assertIsNone(error)
        self.assertIsNone(proxies)
        self.assertEqual('', proxy_url)

    def test_request_error_mentions_proxy_diagnostics(self):
        message = self.web._format_web_request_error(
            'google',
            ConnectionError('Connection refused'),
            'http://127.0.0.1:7890',
        )

        self.assertIn('google: ConnectionError', message)
        self.assertIn('proxy=http://127.0.0.1:7890', message)
        self.assertIn('local proxy is running', message)


class ExecGitProxyTests(unittest.TestCase):
    def test_local_git_proxy_urls_are_normalized(self):
        cases = {
            'http://localhost:7890': 'http://127.0.0.1:7890',
            'https://127.0.0.1:7890': 'http://127.0.0.1:7890',
            'socks5://localhost:7890': 'socks5h://127.0.0.1:7890',
            'socks5h://127.0.0.1:7890': 'socks5h://127.0.0.1:7890',
        }
        for raw, expected in cases.items():
            with self.subTest(raw=raw):
                self.assertEqual(expected, _normalize_local_git_proxy_url(raw))

    def test_non_local_git_proxy_urls_are_not_exported(self):
        self.assertEqual('', _normalize_local_git_proxy_url('http://proxy.example.com:7890'))
        self.assertEqual('', _normalize_local_git_proxy_url('http://127.0.0.1:70000'))

    def test_execute_proxy_env_only_targets_git_commands(self):
        self.assertTrue(_command_invokes_git('git fetch origin'))
        self.assertTrue(_command_invokes_git('npm test && git pull'))
        self.assertTrue(_command_invokes_git('cmd /c git fetch'))
        self.assertTrue(_command_invokes_git('powershell -Command "git fetch"'))
        self.assertFalse(_command_invokes_git('echo git'))
        self.assertFalse(_command_invokes_git('python script.py'))

        env = _apply_git_proxy_env({}, 'http://127.0.0.1:7890')
        for key in ('HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy'):
            self.assertEqual('http://127.0.0.1:7890', env[key])

    def test_new_window_bat_exports_git_proxy(self):
        lines = _git_proxy_bat_lines('socks5h://127.0.0.1:7890')

        self.assertIn('set "HTTP_PROXY=socks5h://127.0.0.1:7890"', lines)
        self.assertIn('set "all_proxy=socks5h://127.0.0.1:7890"', lines)

    def test_execute_reads_git_proxy_from_config(self):
        mixin = ExecMixin()
        completed = mock.Mock(returncode=0, stdout=b'socks5://localhost:7890\n')

        with mock.patch('server.exec.subprocess.run', return_value=completed) as run:
            proxy_url, proxy_error = mixin._git_proxy_url_for_execute('git fetch origin', str(ROOT))

        self.assertEqual('socks5h://127.0.0.1:7890', proxy_url)
        self.assertEqual('', proxy_error)
        run.assert_called_once()

    def test_execute_does_not_read_git_config_for_non_git_command(self):
        mixin = ExecMixin()

        with mock.patch('server.exec.subprocess.run') as run:
            proxy_url, proxy_error = mixin._git_proxy_url_for_execute('python script.py', str(ROOT))

        self.assertEqual('', proxy_url)
        self.assertEqual('', proxy_error)
        run.assert_not_called()

    def test_execute_timeout_is_clamped(self):
        self.assertEqual(60, _coerce_execute_timeout(None, default=60))
        self.assertEqual(1, _coerce_execute_timeout(-5, default=60))
        self.assertEqual(300, _coerce_execute_timeout(999, default=60))
        self.assertEqual(120, _coerce_execute_timeout('120', default=60))
        self.assertEqual(60, _coerce_execute_timeout('bad', default=60))

    def test_remote_terminal_builds_ssh_cd_command(self):
        args = _remote_terminal_ssh_args('ssh -p 2222 user@example.com', '~/project dir')

        self.assertEqual(['ssh', '-p', '2222', '-t', 'user@example.com'], args[:5])
        self.assertIn('cd "$HOME"/', args[-1])
        self.assertIn('project dir', args[-1])
        self.assertIn('exec "${SHELL:-/bin/sh}" -l', args[-1])

    def test_remote_terminal_exports_git_proxy(self):
        args = _remote_terminal_ssh_args(
            'ssh user@example.com',
            '~/project',
            proxy_url='http://127.0.0.1:7890',
        )

        self.assertIn('export HTTP_PROXY=http://127.0.0.1:7890', args[-1])
        self.assertIn('https_proxy=http://127.0.0.1:7890', args[-1])
        self.assertIn('exec "${SHELL:-/bin/sh}" -l', args[-1])


if __name__ == '__main__':
    unittest.main()
