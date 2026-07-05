import unittest

from server.handler import Handler
from server.routes import (
    ACTION_ROUTE_BY_NAME,
    ACTION_ROUTES,
    GET_EXACT_ROUTES,
    GET_PREFIX_ROUTES,
    POST_PREFIX_ROUTES,
)
from server.web import WebMixin


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


if __name__ == '__main__':
    unittest.main()
