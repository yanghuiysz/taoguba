import unittest

from scripts.serve_custom_boards import mutate_high_dividend_config


class ServiceTests(unittest.TestCase):
    def test_watchlist_add_remove_are_idempotent(self):
        config = {"version": 1, "watchlist": [], "poolOverrides": {}, "keep": 7}
        first = mutate_high_dividend_config(config, {"action": "add", "code": "600036"})
        second = mutate_high_dividend_config(first, {"action": "add", "code": "600036"})
        self.assertEqual(second["watchlist"], ["600036"])
        self.assertEqual(second["keep"], 7)
        self.assertEqual(mutate_high_dividend_config(second, {"action": "remove", "code": "600036"})["watchlist"], [])

    def test_pool_override_validation(self):
        config = {"watchlist": [], "poolOverrides": {}}
        changed = mutate_high_dividend_config(config, {"action": "set-pool", "code": "600036", "pool": "stable"})
        self.assertEqual(changed["poolOverrides"]["600036"], "stable")
        with self.assertRaises(ValueError):
            mutate_high_dividend_config(config, {"action": "set-pool", "code": "600036", "pool": "growth"})
        with self.assertRaises(ValueError):
            mutate_high_dividend_config(config, {"action": "add", "code": "abc"})
        for invalid in ["1", "1234567", "200001", "900001"]:
            with self.assertRaises(ValueError):
                mutate_high_dividend_config(config, {"action": "add", "code": invalid})


if __name__ == "__main__":
    unittest.main()
