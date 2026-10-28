"""Tests for PatientFlow REST API endpoints."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BASE_DIR))

from fastapi.testclient import TestClient

from pfgen.server import app, state


class TestPatientFlowAPI(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.client = TestClient(app)

    def test_01_root_and_health(self) -> None:
        res = self.client.get("/")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertIn("endpoints", data)
        self.assertEqual(data["version"], "1.0.0")

        res_health = self.client.get("/health")
        self.assertEqual(res_health.status_code, 200)
        self.assertEqual(res_health.json()["status"], "ok")

    def test_02_generate_data(self) -> None:
        payload = {
            "days": 2,
            "warmup_days": 1,
            "seed": 123,
            "no_synthea": True,
            "population": "30",
            "validate": True,
        }
        res = self.client.post("/api/generate", json=payload)
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertIn("simulation", data)
        self.assertIn("validation", data)
        self.assertTrue(data["validation"]["passed"])
        self.assertGreater(data["simulation"]["total_messages"], 0)

    def test_03_query_hl7_messages(self) -> None:
        res = self.client.get("/api/hl7/messages?limit=10&offset=0")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertGreaterEqual(data["total"], 1)
        self.assertLessEqual(len(data["messages"]), 10)

        # First message structure
        first_msg = data["messages"][0]
        self.assertIn("control_id", first_msg)
        self.assertIn("trigger", first_msg)
        self.assertIn("hl7", first_msg)
        self.assertTrue(first_msg["hl7"].startswith("MSH|^~\\&|"))

        # Test filter by trigger
        res_a01 = self.client.get("/api/hl7/messages?trigger=A01")
        self.assertEqual(res_a01.status_code, 200)
        for m in res_a01.json()["messages"]:
            self.assertEqual(m["trigger"], "A01")

        # Test single message lookup
        cid = first_msg["control_id"]
        res_single = self.client.get(f"/api/hl7/messages/{cid}")
        self.assertEqual(res_single.status_code, 200)
        self.assertEqual(res_single.json()["control_id"], cid)

    def test_04_stream_endpoint(self) -> None:
        res = self.client.get("/api/hl7/stream")
        self.assertEqual(res.status_code, 200)
        self.assertIn("MSH|^~\\&|", res.text)

    def test_05_fhir_endpoints(self) -> None:
        res_loc = self.client.get("/api/fhir/hospital-locations")
        self.assertEqual(res_loc.status_code, 200)
        bundle = res_loc.json()
        self.assertEqual(bundle["resourceType"], "Bundle")
        self.assertGreater(len(bundle["entry"]), 0)

        # List patients
        res_pts = self.client.get("/api/fhir/patients")
        self.assertEqual(res_pts.status_code, 200)
        pt_list = res_pts.json()["patient_ns"]
        self.assertGreater(len(pt_list), 0)

        # Get first patient bundle
        first_ns = pt_list[0]
        res_pt = self.client.get(f"/api/fhir/patients/{first_ns}")
        self.assertEqual(res_pt.status_code, 200)
        pt_bundle = res_pt.json()
        self.assertEqual(pt_bundle["resourceType"], "Bundle")

    def test_06_subscriptions_crud(self) -> None:
        # Register a subscription
        sub_payload = {
            "url": "http://example.com/api/hl7-webhook",
            "triggers": ["A01", "A02"],
            "format": "json",
        }
        res_create = self.client.post("/api/subscriptions", json=sub_payload)
        self.assertEqual(res_create.status_code, 200)
        sub = res_create.json()
        sub_id = sub["id"]
        self.assertTrue(sub_id.startswith("sub_"))
        self.assertEqual(sub["url"], "http://example.com/api/hl7-webhook")

        # List subscriptions
        res_list = self.client.get("/api/subscriptions")
        self.assertEqual(res_list.status_code, 200)
        ids = [s["id"] for s in res_list.json()]
        self.assertIn(sub_id, ids)

        # Delete subscription
        res_del = self.client.delete(f"/api/subscriptions/{sub_id}")
        self.assertEqual(res_del.status_code, 200)
        self.assertEqual(res_del.json()["status"], "deleted")


if __name__ == "__main__":
    unittest.main()
