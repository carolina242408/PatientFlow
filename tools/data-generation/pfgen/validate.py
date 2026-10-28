"""Independent integrity checks on the produced HL7 stream.

The validator only looks at the HL7 text (not at the generator's internal
state), exactly like the consuming application would, and verifies:

1. MSH-10 is a valid UUID and unique across all messages.
2. PID-3 NS always comes with the same PID-5 name, birth date, sex, SNS,
   PID-18 processo and NIF; a processo / SNS never belongs to two NS.
3. Episodes (PV1-19) belong to a single NS, start with A01 and nothing
   follows the A03.
4. Bed replay in stream order: no bed ever holds two patients, every A02's
   prior location (PV1-6) is where the patient actually was, every A03
   leaves the bed the patient was in.
5. MSH-7 is non-decreasing in the stream.
6. (optional) each message converts with tools/hl7-fhir-converter and the
   resulting Patient/Encounter carry the same identifiers.
"""

from __future__ import annotations

import importlib.util
import re
import uuid
from collections import Counter
from pathlib import Path
from typing import Any

CONVERTER = Path(__file__).resolve().parents[2] / "hl7-fhir-converter" / "main.py"


def _segments(text: str) -> dict[str, list[list[str]]]:
    segs: dict[str, list[list[str]]] = {}
    for line in re.split(r"\r\n|\r|\n", text):
        if line.strip():
            fields = line.split("|")
            segs.setdefault(fields[0], []).append(fields)
    return segs


def _f(fields: list[str], i: int) -> str:
    return fields[i] if i < len(fields) else ""


def _comps(value: str) -> list[str]:
    return value.split("^")


def _loc_key(value: str) -> str:
    c = _comps(value)
    return "^".join(c[:3]) if len(c) >= 3 else ""


def _pid3(value: str) -> dict[str, str]:
    ids = {}
    for rep in value.split("~"):
        c = _comps(rep)
        if len(c) >= 5:
            ids[c[4]] = c[0]
    return ids


class Report:
    def __init__(self) -> None:
        self.errors: Counter[str] = Counter()
        self.examples: dict[str, list[str]] = {}

    def error(self, kind: str, detail: str) -> None:
        self.errors[kind] += 1
        self.examples.setdefault(kind, [])
        if len(self.examples[kind]) < 5:
            self.examples[kind].append(detail)


def validate_messages(texts: list[str], check_converter: bool = False) -> dict[str, Any]:
    rep = Report()
    control_ids: set[str] = set()
    ns_identity: dict[str, tuple] = {}
    processo_owner: dict[str, str] = {}
    sns_owner: dict[str, str] = {}
    nif_owner: dict[str, str] = {}
    episode_owner: dict[str, str] = {}
    episode_state: dict[str, str] = {}          # open | closed
    episode_bed: dict[str, str] = {}
    bed_holder: dict[str, str] = {}
    last_msh = ""
    triggers: Counter[str] = Counter()

    for idx, text in enumerate(texts):
        segs = _segments(text)
        if "MSH" not in segs or "PID" not in segs or "PV1" not in segs:
            rep.error("missing_segment", f"message #{idx}")
            continue
        msh, pid, pv1 = segs["MSH"][0], segs["PID"][0], segs["PV1"][0]
        # MSH-n is fields[n-1] because MSH-1 is the separator itself
        control_id, msh_time = _f(msh, 9), _f(msh, 6)
        trigger = _comps(_f(msh, 8))[1] if len(_comps(_f(msh, 8))) > 1 else ""
        triggers[trigger] += 1

        # 1. MSH-10
        try:
            if uuid.UUID(control_id).version != 4:
                rep.error("msh10_not_uuid4", control_id)
        except ValueError:
            rep.error("msh10_not_uuid", control_id)
        if control_id in control_ids:
            rep.error("msh10_duplicate", control_id)
        control_ids.add(control_id)

        # 5. ordering
        if msh_time < last_msh:
            rep.error("msh7_out_of_order", f"{control_id} {msh_time} < {last_msh}")
        last_msh = max(last_msh, msh_time)

        # 2. identity
        ids = _pid3(_f(pid, 3))
        ns, sns = ids.get("NS", ""), ids.get("SNS", "")
        processo = _comps(_f(pid, 18))[0]
        nif = _comps(_f(pid, 21))[0]
        if not ns:
            rep.error("pid3_missing_ns", control_id)
            continue
        if not processo:
            rep.error("pid18_missing_processo", control_id)
        identity = (_f(pid, 5), _f(pid, 7), _f(pid, 8), sns, processo, nif)
        if ns in ns_identity and ns_identity[ns] != identity:
            rep.error("pid3_ns_with_different_patient_data", f"NS {ns}: {ns_identity[ns]} vs {identity}")
        ns_identity.setdefault(ns, identity)
        for owner, value, kind in ((processo_owner, processo, "processo"), (sns_owner, sns, "sns"),
                                   (nif_owner, nif, "nif")):
            if value and owner.setdefault(value, ns) != ns:
                rep.error(f"{kind}_shared_by_two_ns", f"{kind} {value}: NS {owner[value]} and {ns}")

        # 3. episode lifecycle
        episode = _comps(_f(pv1, 19))[0]
        if episode_owner.setdefault(episode, ns) != ns:
            rep.error("episode_shared_by_two_ns", f"episode {episode}")
        state = episode_state.get(episode)
        if trigger == "A01" and state is not None:
            rep.error("a01_for_existing_episode", f"episode {episode}")
        if trigger in ("A02", "A03") and state != "open":
            rep.error(f"{trigger.lower()}_without_open_episode", f"episode {episode} ({control_id})")
            continue

        # 4. bed replay
        bed = _loc_key(_f(pv1, 3))
        if trigger == "A01":
            if bed in bed_holder:
                rep.error("bed_double_booked", f"{bed} held by {bed_holder[bed]}, A01 for {episode}")
            bed_holder[bed] = episode
            episode_bed[episode] = bed
            episode_state[episode] = "open"
        elif trigger == "A02":
            prior = _loc_key(_f(pv1, 6))
            if prior != episode_bed.get(episode):
                rep.error("a02_prior_location_mismatch", f"{episode}: PV1-6 {prior} but was in {episode_bed.get(episode)}")
            if bed in bed_holder and bed_holder[bed] != episode:
                rep.error("bed_double_booked", f"{bed} held by {bed_holder[bed]}, A02 for {episode}")
            bed_holder.pop(episode_bed.get(episode, ""), None)
            bed_holder[bed] = episode
            episode_bed[episode] = bed
        elif trigger == "A03":
            if bed != episode_bed.get(episode):
                rep.error("a03_location_mismatch", f"{episode}: PV1-3 {bed} but was in {episode_bed.get(episode)}")
            bed_holder.pop(episode_bed.get(episode, ""), None)
            episode_state[episode] = "closed"

    # homonyms (ground truth for the matching logic of the app)
    by_name: dict[str, set[str]] = {}
    for ns, ident in ns_identity.items():
        by_name.setdefault(ident[0], set()).add(ns)
    homonyms = {name: sorted(v) for name, v in by_name.items() if len(v) > 1}

    result: dict[str, Any] = {
        "messages": len(texts),
        "by_trigger": dict(triggers),
        "unique_control_ids": len(control_ids),
        "patients": len(ns_identity),
        "episodes": len(episode_owner),
        "open_episodes_at_end": sum(1 for s in episode_state.values() if s == "open"),
        "homonym_groups": len(homonyms),
        "homonym_patients": sum(len(v) for v in homonyms.values()),
        "errors": dict(rep.errors),
        "error_examples": rep.examples,
    }
    if check_converter:
        result["converter"] = _converter_roundtrip(texts)
    conv_fail = result.get("converter", {}).get("failures", 0)
    result["passed"] = not rep.errors and not conv_fail
    return result


def _converter_roundtrip(texts: list[str]) -> dict[str, Any]:
    if not CONVERTER.exists():
        return {"skipped": f"converter not found at {CONVERTER}"}
    try:
        spec = importlib.util.spec_from_file_location("pf_hl7_converter", CONVERTER)
        module = importlib.util.module_from_spec(spec)  # type: ignore[arg-type]
        spec.loader.exec_module(module)  # type: ignore[union-attr]
    except Exception as exc:  # noqa: BLE001
        return {"skipped": f"could not import converter: {exc}"}

    failures, examples = 0, []
    for text in texts:
        segs = _segments(text)
        ns = _pid3(_f(segs["PID"][0], 3)).get("NS")
        episode = _comps(_f(segs["PV1"][0], 19))[0]
        try:
            bundle = module.convert_hl7_to_fhir(text).model_dump(by_alias=True, exclude_none=True, mode="json")
            res = {e["resource"]["resourceType"]: e["resource"] for e in bundle["entry"]}
            values = [i.get("value") for i in res["Patient"].get("identifier", [])]
            enc_ids = [i.get("value") for i in res["Encounter"].get("identifier", [])]
            if ns not in values or episode not in enc_ids:
                raise ValueError(f"identifiers lost: NS {ns} in {values}, episode {episode} in {enc_ids}")
        except Exception as exc:  # noqa: BLE001
            failures += 1
            if len(examples) < 5:
                examples.append(str(exc)[:300])
    return {"converted": len(texts) - failures, "failures": failures, "examples": examples}
