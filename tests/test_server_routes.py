import unittest

from server.handler import Handler
from server.routes import (
    ACTION_ROUTE_BY_NAME,
    ACTION_ROUTES,
    GET_EXACT_ROUTES,
    GET_PREFIX_ROUTES,
    POST_PREFIX_ROUTES,
)


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


if __name__ == '__main__':
    unittest.main()
