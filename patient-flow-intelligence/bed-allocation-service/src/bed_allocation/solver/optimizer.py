from ortools.sat.python import cp_model

from bed_allocation.config import settings
from bed_allocation.schemas.allocation import AllocationResult, AllocationSuggestion
from bed_allocation.schemas.bed_flat import BedFlat
from bed_allocation.schemas.patient_waiting import PatientWaiting

from .id_mapper import IdMapper
from .precompute import build_pair_flags


def optimize(patients: list[PatientWaiting], beds: list[BedFlat]) -> AllocationResult:
    if not patients or not beds:
        return AllocationResult()
    id_mapper = IdMapper()
    for patient in patients:
        id_mapper.to_int(patient.encounter_id)
    for bed in beds:
        id_mapper.to_int(bed.bed_id)
    flags = build_pair_flags(patients, beds)
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
            score = (
                weights.get("W_PRIORITY", 100) * priority
                + weights.get("W_SERVICE_MATCH", 50) * pair["service_match"]
                + weights.get("W_SAME_ULS", 10) * pair["same_uls"]
                + weights.get("W_SAME_UNIT", 5) * pair["same_unit"]
                + weights.get("W_SAME_FLOOR", 2) * pair["same_floor"]
            )
            objective.append(score * variables[p, b])
    model.maximize(sum(objective))
    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = settings.solver_time_limit_seconds
    status = solver.solve(model)
    suggestions = []
    for p, patient in enumerate(patients):
        for b, bed in enumerate(beds):
            if solver.value(variables[p, b]):
                pair = flags[(patient.encounter_id, bed.bed_id)]
                score = solver.objective_value
                reasons = ["cama disponível"]
                if pair["service_match"] and patient.service_id:
                    reasons.insert(0, f"serviço compatível ({bed.service_name})")
                if pair["same_floor"]:
                    reasons.append("mesmo piso")
                suggestions.append(
                    AllocationSuggestion(
                        encounter_id=patient.encounter_id,
                        bed_id=bed.bed_id,
                        score=score,
                        justification="; ".join(reasons).capitalize() + ".",
                    )
                )
    return AllocationResult(suggestions=suggestions, solver_status=solver.status_name(status))
