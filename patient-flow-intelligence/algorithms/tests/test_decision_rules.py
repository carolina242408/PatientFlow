import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from decision_rules import rank_beds, forecast_occupancy


class DecisionRulesTest(unittest.TestCase):
    def setUp(self):
        self.contract = json.loads((ROOT / "tests/fixtures/rules-v1.json").read_text(encoding="utf-8"))

    def test_shared_ranking_contract(self):
        self.assertEqual(self.contract["rankOutput"], rank_beds(self.contract["rankInput"]))

    def test_shared_forecast_contract(self):
        self.assertEqual(self.contract["forecastOutput"], forecast_occupancy(self.contract["forecastInput"]))

    def test_ranking_has_stable_tie_break_and_limit(self):
        candidate = self.contract["rankInput"]["candidates"][0]
        second = {**candidate, "bedId": "00000000-0000-0000-0000-000000000002"}
        result = rank_beds({"limit": 1, "candidates": [second, candidate]})
        self.assertEqual(candidate["bedId"], result["recommendations"][0]["bedId"])

    def test_no_candidates(self):
        self.assertEqual([], rank_beds({"limit": 5, "candidates": []})["recommendations"])

    def test_discharges_cannot_release_more_than_current_occupancy(self):
        data = self.contract["forecastInput"]
        service = {**data["services"][0], "historicalUnscheduledAdmissions": 0,
                   "knownAdmissions24h": 0, "knownAdmissions48h": 0, "historicalDischarges": 1000}
        horizons = forecast_occupancy({"historyDays": 10, "services": [service]})["services"][0]["horizons"]
        for horizon in horizons:
            self.assertEqual(8.0, horizon["expectedDischarges"])
            self.assertEqual(0.0, horizon["projectedOccupied"])


if __name__ == "__main__":
    unittest.main()
