"""Deterministic operational baselines, with no trained models or clinical inference."""

from math import floor

VERSION = "rules-v1"


def rounded(value: float) -> float:
    # Match the non-negative Java baseline; rounding is for reporting only.
    return floor(value * 100 + 0.5) / 100


def rank_beds(data: dict) -> dict:
    def score(candidate: dict) -> int:
        return 100 + (20 if candidate["preferredWard"] else 0) - min(candidate["occupiedInRoom"], 10) * 5

    candidates = sorted(
        data["candidates"],
        key=lambda c: (-score(c), c["wardCode"], c["roomCode"], c["bedCode"], c["bedId"]),
    )[: data["limit"]]
    recommendations = []
    for candidate in candidates:
        reasons = ["SERVICE_MATCH", "AVAILABLE"]
        if candidate["preferredWard"]:
            reasons.append("PREFERRED_WARD")
        reasons.append("EMPTY_ROOM" if candidate["occupiedInRoom"] == 0 else "ROOM_OCCUPANCY_PENALTY")
        recommendations.append({"bedId": candidate["bedId"], "score": score(candidate), "reasons": reasons})
    return {"algorithmVersion": VERSION, "recommendations": recommendations}


def forecast_occupancy(data: dict) -> dict:
    services = []
    for service in data["services"]:
        horizons = []
        for hours in (24, 48):
            known = service[f"knownAdmissions{hours}h"]
            planned = service[f"plannedDischarges{hours}h"]
            admissions = known + service["historicalUnscheduledAdmissions"] * hours / (data["historyDays"] * 24.0)
            discharges = min(
                service["occupied"],
                max(planned, service["historicalDischarges"] * hours / (data["historyDays"] * 24.0)),
            )
            demand = max(0, service["occupied"] + admissions - discharges)
            occupied = min(service["capacity"], demand)
            horizons.append({
                "hours": hours,
                "expectedAdmissions": rounded(admissions),
                "expectedDischarges": rounded(discharges),
                "projectedOccupied": rounded(occupied),
                "occupancyPercent": None if service["capacity"] == 0 else rounded(occupied * 100.0 / service["capacity"]),
                "unmetDemand": rounded(max(0, demand - service["capacity"])),
            })
        services.append({"serviceId": service["serviceId"], "horizons": horizons})
    return {"algorithmVersion": VERSION, "services": services}
