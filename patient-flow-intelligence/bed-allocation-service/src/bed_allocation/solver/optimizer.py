from ortools.sat.python import cp_model

from bed_allocation.config import is_isolation_bed, settings
from bed_allocation.schemas.allocation import (
    AllocationResult,
    AllocationSuggestion,
    BedComparison,
    DebugEntry,
    ReallocationWarning,
    ReallocationSuggestion,
    RoomEvictionEntry,
)
from bed_allocation.schemas.bed_flat import BedFlat
from bed_allocation.schemas.patient_waiting import PatientWaiting

from .id_mapper import IdMapper
from .precompute import build_pair_flags


def bed_label(bed: BedFlat) -> str:
    return f"{bed.ward_name} · {bed.room_code} · Cama {bed.bed_code}"


def reallocation_suggestions(
    new_patient: PatientWaiting,
    available_beds: list[BedFlat],
    allocations: list[dict],
    imminent_beds: dict | None = None,
    direct_score: float | None = None,
) -> list[ReallocationSuggestion]:
    if not new_patient.isolation:
        return []
    flags = build_pair_flags([new_patient], available_beds, imminent_beds)
    ranked = room_eviction_ranking(allocations, available_beds, imminent_beds)
    if not ranked:
        return []
    selected_room_id = ranked[0].room_id
    room_allocations = [
        allocation for allocation in allocations
        if allocation["current_room_id"] == selected_room_id
    ]
    occupant_scores = []
    for allocation in room_allocations:
        current_bed = next(
            (
                bed
                for bed in available_beds
                if bed.bed_id == allocation["current_bed_id"]
            ),
            None,
        )
        if current_bed is None:
            current_bed = BedFlat(
                bed_id=allocation["current_bed_id"],
                bed_code=allocation["current_bed_code"],
                room_id=allocation["current_room_id"],
                room_code=allocation["current_room_code"],
                ward_id=allocation["current_ward_id"],
                ward_code=allocation["current_ward_code"],
                ward_name=allocation["current_ward_name"],
                service_id=allocation["current_service_id"],
                service_code=allocation["current_service_code"],
                service_name=allocation["current_service_name"],
                floor_id=allocation["current_floor_id"],
                floor_name=allocation["current_floor_name"],
                unit_id=allocation["current_unit_id"],
                unit_name=allocation["current_unit_name"],
                uls_id=allocation["current_uls_id"],
                uls_name=allocation["current_uls_name"],
                is_isolation_room=(
                    is_isolation_bed(
                        allocation["current_bed_id"], allocation["current_room_id"]
                    )
                ),
            )
        if not current_bed.is_isolation_room:
            continue
        displaced = PatientWaiting(
            encounter_id=allocation["encounter_id"],
            service_id=allocation["service_id"],
            patient_id=allocation["patient_id"],
            full_name=allocation["full_name"],
            birth_date=allocation["birth_date"],
            gender=allocation["gender"],
            isolation=allocation["isolation"],
            expected_discharge_at=allocation["expected_discharge_at"],
        )
        displaced_flags = build_pair_flags([displaced], available_beds, imminent_beds)
        current_pair = build_pair_flags([displaced], [current_bed], imminent_beds)[
            (displaced.encounter_id, current_bed.bed_id)
        ]
        occupant_scores.append((
            allocation,
            current_bed,
            displaced,
            sum(score_breakdown(displaced, current_bed, current_pair).values()),
        ))
    if not occupant_scores:
        return []
    occupant_scores.sort(key=lambda item: (item[3], item[0]["encounter_id"]))
    allocation, current_bed, displaced, displaced_original_score = occupant_scores[0]
    target_candidates = []
    for target in available_beds:
        if target.room_id == selected_room_id:
            continue
        target_pair = displaced_flags[(displaced.encounter_id, target.bed_id)]
        if target_pair["isolation_ok"] and target_pair["sex_ok"]:
            target_candidates.append((target, target_pair))
    target_candidates.sort(key=lambda item: item[0].bed_id)
    new_pair = build_pair_flags([new_patient], [current_bed], imminent_beds)[
        (new_patient.encounter_id, current_bed.bed_id)
    ]
    new_score = sum(score_breakdown(new_patient, current_bed, new_pair).values())
    room_score = ranked[0].eviction_score
    target = max(
        target_candidates,
        key=lambda item: (
            item[0].ward_id == current_bed.ward_id,
            settings.weights.get("W_REALLOCATION_FRICTION", 0.5)
            * sum(score_breakdown(displaced, item[0], item[1]).values()),
            -item[0].bed_id.int,
        ),
        default=None,
    )
    warning = None
    target_is_ward_transfer = False
    if target is None:
        affected = [entry[2].full_name for entry in occupant_scores[:2]]
        next_name = affected[1] if len(affected) > 1 else displaced.full_name
        warning = ReallocationWarning(
            code="NO_BED_AVAILABLE",
            message=(
                f"No free bed is available for {displaced.full_name}. "
                f"If the isolation patient is admitted, {displaced.full_name} "
                f"(priority {allocation['patient_priority']}, score {displaced_original_score:g}) "
                f"may be left without a bed. The next lowest priority patient "
                f"in {ranked[0].room_label} is {next_name}."
            ),
            affected_patients=affected,
        )
        combined = new_score - settings.weights.get("W_DISPLACEMENT_PENALTY", 50)
        target_bed = None
        if direct_score is not None and combined < direct_score:
            return []
    else:
        target_bed, target_pair = target
        target_is_ward_transfer = target_bed.ward_id != current_bed.ward_id
        target_score = sum(score_breakdown(displaced, target_bed, target_pair).values())
        combined = (
            new_score
            + settings.weights.get("W_REALLOCATION_FRICTION", 0.5) * target_score
            - settings.weights.get("W_DISPLACEMENT_PENALTY", 50)
            - settings.weights.get("W_DISRUPTION", 10) * allocation["patient_priority"]
        )
        if direct_score is not None and combined < direct_score:
            return []
        if target_is_ward_transfer:
            warning = ReallocationWarning(
                code="WARD_TRANSFER",
                message=(
                    f"No free bed is available in {current_bed.ward_name}. "
                    f"{displaced.full_name} would be moved to {target_bed.ward_name} "
                    f"({bed_label(target_bed)}). Confirm ward transfer."
                ),
                affected_patients=[displaced.full_name],
            )
    return [ReallocationSuggestion(
        new_patient_encounter_id=new_patient.encounter_id,
        from_bed_id=current_bed.bed_id,
        from_bed_label=bed_label(current_bed),
        displaced_encounter_id=displaced.encounter_id,
        displaced_patient_name=displaced.full_name,
        to_bed_id=target_bed.bed_id if target_bed else None,
        to_bed_label=bed_label(target_bed) if target_bed else None,
        target_is_ward_transfer=target_is_ward_transfer,
        score_combined=combined,
        justification=(
            f"Isolation bed freed by moving {displaced.full_name}; "
            "the target bed satisfies the displaced patient's isolation and sex rules."
        ),
        room_eviction_score=room_score,
        displaced_priority=allocation["patient_priority"],
        displaced_original_score=displaced_original_score,
        warning=warning,
    )]


def room_eviction_ranking(
    allocations: list[dict],
    available_beds: list[BedFlat],
    imminent_beds: dict | None = None,
) -> list[RoomEvictionEntry]:
    beds_by_id = {bed.bed_id: bed for bed in available_beds}
    rooms: dict = {}
    for allocation in allocations:
        bed = beds_by_id.get(allocation["current_bed_id"])
        if bed is None:
            bed = BedFlat(
                bed_id=allocation["current_bed_id"],
                bed_code=allocation["current_bed_code"],
                room_id=allocation["current_room_id"],
                room_code=allocation["current_room_code"],
                ward_id=allocation["current_ward_id"],
                ward_code=allocation["current_ward_code"],
                ward_name=allocation["current_ward_name"],
                service_id=allocation["current_service_id"],
                service_code=allocation["current_service_code"],
                service_name=allocation["current_service_name"],
                floor_id=allocation["current_floor_id"],
                floor_name=allocation["current_floor_name"],
                unit_id=allocation["current_unit_id"],
                unit_name=allocation["current_unit_name"],
                uls_id=allocation["current_uls_id"],
                uls_name=allocation["current_uls_name"],
                is_isolation_room=(
                    is_isolation_bed(
                        allocation["current_bed_id"], allocation["current_room_id"]
                    )
                ),
            )
        if not bed.is_isolation_room:
            continue
        patient = PatientWaiting(
            encounter_id=allocation["encounter_id"],
            service_id=allocation["service_id"],
            patient_id=allocation["patient_id"],
            full_name=allocation["full_name"],
            birth_date=allocation["birth_date"],
            gender=allocation["gender"],
            isolation=allocation["isolation"],
            expected_discharge_at=allocation["expected_discharge_at"],
        )
        pair = build_pair_flags([patient], [bed], imminent_beds)[
            (patient.encounter_id, bed.bed_id)
        ]
        score = sum(score_breakdown(patient, bed, pair).values())
        room = rooms.setdefault(
            bed.room_id,
            {"label": f"{bed.ward_name} · {bed.room_code}", "occupants": []},
        )
        room["occupants"].append((patient.full_name, score, allocation["encounter_id"]))
    return [
        RoomEvictionEntry(
            room_id=room_id,
            room_label=room["label"],
            eviction_score=sum(item[1] for item in room["occupants"]),
            occupant_scores=[
                (item[0], item[1])
                for item in sorted(room["occupants"], key=lambda item: (item[1], item[2].int))
            ],
            is_isolation_room=True,
        )
        for room_id, room in sorted(
            rooms.items(),
            key=lambda item: (
                sum(entry[1] for entry in item[1]["occupants"]),
                item[0].int,
            ),
        )
    ]


def score_breakdown(patient: PatientWaiting, bed: BedFlat, pair: dict) -> dict[str, float]:
    priority = settings.priority_by_encounter.get(patient.encounter_id, 1)
    imminent = (
        settings.weights.get("W_IMMINENT_DISCHARGE", 30)
        * max(
            0,
            (settings.imminent_discharge_hours - (pair["hours_until_free"] or 0))
            / settings.imminent_discharge_hours,
        )
        if pair["imminent_discharge"] and priority <= 2
        else 0
    )
    return {
        "priority": float(settings.weights.get("W_PRIORITY", 100) * priority),
        "service_match": float(settings.weights.get("W_SERVICE_MATCH", 50) * pair["service_match"]),
        "same_uls": float(settings.weights.get("W_SAME_ULS", 10) * pair["same_uls"]),
        "same_unit": float(settings.weights.get("W_SAME_UNIT", 5) * pair["same_unit"]),
        "same_floor": float(settings.weights.get("W_SAME_FLOOR", 2) * pair["same_floor"]),
        "isolation_match": float(
            settings.weights.get("W_ISOLATION_MATCH", 20) * pair["isolation_match"]
        ),
        "age_cohort": float(settings.weights.get("W_AGE_COHORT", 25) * pair["age_cohort_priority"]),
        "imminent_discharge": float(imminent),
    }


def optimize(
    patients: list[PatientWaiting],
    beds: list[BedFlat],
    imminent_beds: dict | None = None,
    *,
    comparison_patients: list[PatientWaiting] | None = None,
    debug: bool = False,
    allocations: list[dict] | None = None,
) -> AllocationResult:
    ranking = room_eviction_ranking(allocations or [], beds, imminent_beds)
    if not patients or not beds:
        return AllocationResult(room_eviction_ranking=ranking)
    id_mapper = IdMapper()
    for patient in patients:
        id_mapper.to_int(patient.encounter_id)
    for bed in beds:
        id_mapper.to_int(bed.bed_id)
    flags = build_pair_flags(patients, beds, imminent_beds)
    model = cp_model.CpModel()
    variables = {}
    for p, patient in enumerate(patients):
        for b, bed in enumerate(beds):
            variable = model.new_bool_var(f"x_{p}_{b}")
            pair = flags[(patient.encounter_id, bed.bed_id)]
            if (
                (patient.service_id is not None and not pair["service_match"])
                or not pair["sex_ok"]
                or not pair["isolation_ok"]
                or (
                    pair["imminent_discharge"]
                    and settings.priority_by_encounter.get(patient.encounter_id, 1) >= 4
                )
            ):
                model.add(variable == 0)
            variables[p, b] = variable
    for p in range(len(patients)):
        model.add(sum(variables[p, b] for b in range(len(beds))) <= 1)
    for b in range(len(beds)):
        model.add(sum(variables[p, b] for p in range(len(patients))) <= 1)
    weights = settings.weights
    objective = []
    for p, patient in enumerate(patients):
        priority = settings.priority_by_encounter.get(patient.encounter_id, 1)
        for b, bed in enumerate(beds):
            pair = flags[(patient.encounter_id, bed.bed_id)]
            breakdown = score_breakdown(patient, bed, pair)
            objective.append(sum(breakdown.values()) * variables[p, b])
    model.maximize(sum(objective))
    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = settings.solver_time_limit_seconds
    status = solver.solve(model)
    suggestions = []
    for p, patient in enumerate(patients):
        for b, bed in enumerate(beds):
            if solver.value(variables[p, b]):
                pair = flags[(patient.encounter_id, bed.bed_id)]
                breakdown = score_breakdown(patient, bed, pair)
                score = sum(breakdown.values())
                reasons = ["bed available"]
                if pair["service_match"] and patient.service_id:
                    reasons.insert(0, f"compatible service ({bed.service_name})")
                if pair["same_floor"]:
                    reasons.append("same floor")
                if pair["imminent_discharge"]:
                    reasons.append(
                        f"bed of patient with discharge expected in {int(pair['hours_until_free'])}h"
                    )
                suggestions.append(
                    AllocationSuggestion(
                        encounter_id=patient.encounter_id,
                        bed_id=bed.bed_id,
                        bed_label=bed_label(bed),
                        score=score,
                        justification="; ".join(reasons).capitalize() + ".",
                    )
                )
    comparisons: list[BedComparison] = []
    if debug:
        candidates = comparison_patients or patients
        comparison_flags = build_pair_flags(candidates, beds, imminent_beds)
        for bed in beds:
            entries = []
            for candidate in candidates:
                pair = comparison_flags[(candidate.encounter_id, bed.bed_id)]
                breakdown = score_breakdown(candidate, bed, pair)
                entries.append(
                    DebugEntry(
                        encounter_id=candidate.encounter_id,
                        patient_name=candidate.full_name,
                        bed_id=bed.bed_id,
                        bed_label=bed_label(bed),
                        score_breakdown=breakdown,
                        total_score=sum(breakdown.values()) if pair["isolation_ok"] else 0,
                    )
                )
            comparisons.append(
                BedComparison(bed_id=bed.bed_id, bed_label=bed_label(bed), candidates=entries)
            )
    return AllocationResult(
        suggestions=suggestions,
        comparisons=comparisons,
        room_eviction_ranking=ranking,
        solver_status=solver.status_name(status),
    )
