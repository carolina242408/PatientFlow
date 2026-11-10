"""Write reports and select a candidate using comparable CV results only."""

from datetime import datetime, timezone
import json
import math
from pathlib import Path

from .config import MODEL_NAMES


def write_json(path: Path, value):
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    temporary.replace(path)


def select_best(output: Path):
    reports = []
    for name in MODEL_NAMES:
        path = output / name / "report.json"
        if path.is_file():
            report = json.loads(path.read_text(encoding="utf-8"))
            if report["model"] != name:
                raise ValueError(f"Model/report mismatch: {path}")
            if not math.isfinite(report["cv"]["mae_days"]["mean"]):
                raise ValueError(f"Invalid CV MAE: {path}")
            artifact = output / name / "artifact.json"
            if not artifact.is_file():
                raise ValueError(f"Missing model artifact metadata: {artifact}")
            metadata = json.loads(artifact.read_text(encoding="utf-8"))
            if metadata["model"] != name or not metadata["files"]:
                raise ValueError(f"Invalid model artifact metadata: {artifact}")
            if any(not (artifact.parent / filename).is_file() for filename in metadata["files"]):
                raise ValueError(f"Incomplete model artifact: {artifact.parent}")
            status = json.loads((artifact.parent / "status.json").read_text(encoding="utf-8"))
            if status["status"] != "completed":
                raise ValueError(f"Model run has not completed: {artifact.parent}")
            reports.append(report)
    if not reports:
        raise ValueError(f"No completed model reports found under {output}.")
    if any(report["protocol"] != reports[0]["protocol"] for report in reports[1:]):
        raise ValueError("Cannot compare runs with different datasets, source code, features, seeds, or splits.")
    ranked = sorted(reports, key=lambda report: (report["cv"]["mae_days"]["mean"], report["model"]))
    complete = len(ranked) == len(MODEL_NAMES)
    leaderboard = {
        "selection_metric": "cv_mae_mean",
        "all_four_complete": complete,
        "missing_models": [name for name in MODEL_NAMES if name not in {r["model"] for r in ranked}],
        "ranking": [{
            "model": report["model"],
            "cv_mae_days": report["cv"]["mae_days"]["mean"],
            "cv_mae_std_days": report["cv"]["mae_days"]["std"],
            "cv_rmse_days": report["cv"]["rmse_days"]["mean"],
            "test_mae_days": report["test"]["mae_days"],
            "artifact_directory": report["model"],
        } for report in ranked],
    }
    write_json(output / "leaderboard.json", leaderboard)
    if not complete and (output / "best_model.json").exists():
        raise ValueError("The previous selection is stale: restore all four runs before selecting or loading a model.")
    if complete:
        winner = ranked[0]
        write_json(output / "best_model.json", {
            "model": winner["model"],
            "artifact_directory": winner["model"],
            "selection_metric": "cv_mae_mean",
            "cv_mae_days": winner["cv"]["mae_days"]["mean"],
            "protocol": winner["protocol"],
            "selected_at_utc": datetime.now(timezone.utc).isoformat(),
        })
    return leaderboard
