"""Tests for PatientFlow synthetic data generator."""

from __future__ import annotations

import random
import unittest
import uuid
import sys
from datetime import date, datetime
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BASE_DIR))

import yaml

from pfgen.clinical import classify
from pfgen.hl7 import HL7Builder, render_all
from pfgen.hospital import Hospital
from pfgen.identity import IdentityRegistry, is_valid_nif
from pfgen.simulation import Simulation, output_events
from pfgen.synthea import synthetic_pool
from pfgen.validate import validate_messages

BASE_DIR = Path(__file__).resolve().parents[1]


class TestPatientFlowGenerator(unittest.TestCase):
    def setUp(self) -> None:
        with open(BASE_DIR / "config" / "hospital.yaml", "r", encoding="utf-8") as f:
            self.hosp_cfg = yaml.safe_load(f)
        with open(BASE_DIR / "config" / "simulation.yaml", "r", encoding="utf-8") as f:
            self.sim_cfg = yaml.safe_load(f)

    def test_nif_check_digit(self) -> None:
        # Check generated NIF validity
        reg = IdentityRegistry(random.Random(42))
        for _ in range(50):
            nif = reg._alloc_nif()
            self.assertTrue(is_valid_nif(nif), f"Invalid NIF: {nif}")

    def test_identity_consistency(self) -> None:
        reg = IdentityRegistry(random.Random(42))
        ref_date = date(2026, 10, 1)

        # Create identity for patient-1
        p1 = reg.create("uuid-1", "M", date(1980, 5, 12), ref_date)
        # Re-fetch should yield same identity
        p1_again = reg.create("uuid-1", "M", date(1980, 5, 12), ref_date)

        self.assertEqual(p1.ns, p1_again.ns)
        self.assertEqual(p1.processo, p1_again.processo)
        self.assertEqual(p1.sns, p1_again.sns)
        self.assertEqual(p1.full_name, p1_again.full_name)

        # Distinct patient gets distinct NS and processo
        p2 = reg.create("uuid-2", "F", date(1990, 8, 20), ref_date)
        self.assertNotEqual(p1.ns, p2.ns)
        self.assertNotEqual(p1.processo, p2.processo)
        self.assertNotEqual(p1.sns, p2.sns)

    def test_hospital_sex_cohorting(self) -> None:
        h = Hospital(self.hosp_cfg)
        now = datetime(2026, 10, 1, 10, 0, 0)
        rng = random.Random(42)
        med_wards = h.wards_of("MED")

        # Find a bed for male
        bed_m = h.find_bed(med_wards, "M", now, rng)
        self.assertIsNotNone(bed_m)
        self.assertFalse(bed_m.is_stretcher)

    def test_clinical_classification(self) -> None:
        spec, diag = classify("233604007", "Pneumonia", from_encounter=True)
        self.assertEqual(spec, "PNE")
        self.assertEqual(diag.code, "J18.9")

        spec_car, diag_car = classify("22298006", "Myocardial infarction", from_encounter=True)
        self.assertEqual(spec_car, "CAR")
        self.assertEqual(diag_car.code, "I21.9")

    def test_simulation_and_hl7_validation(self) -> None:
        rng = random.Random(999)
        hospital = Hospital(self.hosp_cfg)
        sim_cfg = self.sim_cfg
        sim_cfg["simulation"]["days"] = 2
        sim_cfg["simulation"]["warmup_days"] = 1
        sim_start = datetime.fromisoformat(sim_cfg["simulation"]["start"])

        reg = IdentityRegistry(rng)
        pool = synthetic_pool(50, rng, sim_start, 18, 90)

        sim = Simulation(hospital, sim_cfg, pool, reg, rng)
        res = sim.run()

        events = output_events(res, "census")
        self.assertGreater(len(events), 0)

        builder = HL7Builder(hospital, sim_cfg["hl7"], rng)
        messages = render_all(events, builder, res.operators, (0, 10), 30, rng)
        self.assertEqual(len(messages), len(events))

        # Check MSH-10 uniqueness and UUID validity
        ids = [m.control_id for m in messages]
        self.assertEqual(len(ids), len(set(ids)))
        for cid in ids:
            self.assertEqual(uuid.UUID(cid).version, 4)

        # Validate message integrity
        report = validate_messages([m.text for m in messages], check_converter=False)
        self.assertTrue(report["passed"], f"Validation failed: {report['errors']}")
        self.assertGreater(report["by_trigger"].get("A01", 0), 0)


if __name__ == "__main__":
    unittest.main()
