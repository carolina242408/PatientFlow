"""Run against a started service by setting ALGORITHMS_TEST_URL; uses only stdlib."""
import json
import os
import unittest
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

BASE = os.environ.get("ALGORITHMS_TEST_URL")


@unittest.skipUnless(BASE, "Set ALGORITHMS_TEST_URL for HTTP integration tests")
class HttpContractTest(unittest.TestCase):
    def setUp(self):
        self.contract = json.loads((Path(__file__).parent / "fixtures/rules-v1.json").read_text(encoding="utf-8"))

    def post(self, path, payload):
        request = Request(BASE + path, json.dumps(payload).encode(), {"Content-Type": "application/json"})
        with urlopen(request, timeout=3) as response:
            return json.load(response)

    def test_http_ranking_and_forecast_match_contract(self):
        self.assertEqual(self.contract["rankOutput"], self.post("/v1/bed-ranking", self.contract["rankInput"]))
        self.assertEqual(self.contract["forecastOutput"], self.post("/v1/occupancy-forecast", self.contract["forecastInput"]))

    def test_rejects_invalid_counts_duplicate_ids_and_unknown_fields(self):
        duplicate = self.contract["rankInput"]
        duplicate["candidates"].append(duplicate["candidates"][0])
        invalid = self.contract["forecastInput"]
        invalid["services"][0]["occupied"] = -1
        for path, body in [("/v1/bed-ranking", duplicate), ("/v1/occupancy-forecast", invalid),
                           ("/v1/bed-ranking", {"limit": 5, "candidates": [], "sns": "forbidden"})]:
            with self.subTest(path=path), self.assertRaises(HTTPError) as error:
                self.post(path, body)
            self.assertEqual(422, error.exception.code)


if __name__ == "__main__":
    unittest.main()
