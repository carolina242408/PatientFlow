"""Load saved pipelines for offline inference, including the selected candidate."""

import argparse
import json
from pathlib import Path

from .config import DEFAULT_OUTPUT, FEATURES, MODEL_NAMES


class LOSPredictor:
    """Only load trusted local artifacts; joblib files contain executable Python objects."""

    def __init__(self, directory: Path, device="cpu"):
        import joblib

        if device not in ("cpu", "cuda"):
            raise ValueError("device must be cpu or cuda.")
        directory = Path(directory).resolve()
        metadata = json.loads((directory / "artifact.json").read_text(encoding="utf-8"))
        self.name = metadata["model"]
        if self.name not in MODEL_NAMES or metadata["features"] != FEATURES:
            raise ValueError("Unsupported model artifact or incompatible input schema.")
        if metadata["target_transform"] != "none" or metadata["prediction_transform"] != "none":
            raise ValueError("This predictor expects untransformed los_days predictions.")
        if self.name == "ft_transformer":
            from .ft_transformer import FTTransformerRegressor

            self.model = FTTransformerRegressor.load(directory, device=device)
        else:
            self.model = joblib.load(directory / "model.joblib")
            if self.name == "xgboost":
                self.model.named_steps["regressor"].set_params(device="cuda:0" if device == "cuda" else "cpu")
            elif self.name == "catboost":
                self.catboost_device = "GPU" if device == "cuda" else "CPU"
            elif device != "cpu":
                raise ValueError("Random Forest inference is CPU-only.")

    @classmethod
    def best(cls, output=DEFAULT_OUTPUT, device="cpu"):
        output = Path(output).resolve()
        leaderboard = json.loads((output / "leaderboard.json").read_text(encoding="utf-8"))
        if not leaderboard["all_four_complete"]:
            raise ValueError("All four model runs must complete before loading the selected model.")
        selected = json.loads((output / "best_model.json").read_text(encoding="utf-8"))
        if selected["model"] not in MODEL_NAMES or selected["artifact_directory"] != selected["model"]:
            raise ValueError("Invalid selected-model manifest.")
        return cls(output / selected["artifact_directory"], device=device)

    def predict(self, features):
        import numpy as np

        from .data import validate_features

        validated = validate_features(features)
        if self.name == "catboost":
            values = self.model.predict(validated, task_type=self.catboost_device)
        else:
            values = self.model.predict(validated)
        result = np.asarray(values, dtype=float).reshape(-1)
        if len(result) != len(validated) or not np.isfinite(result).all():
            raise ValueError("The model returned invalid predictions.")
        return result


def main():
    parser = argparse.ArgumentParser(description="Predict LOS from a CSV using a trusted saved model. No training occurs.")
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--artifact-dir", type=Path, help="A specific model directory; otherwise use the selected best model.")
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT, help="Experiment directory containing best_model.json.")
    parser.add_argument("--device", choices=("cpu", "cuda"), default="cpu")
    arguments = parser.parse_args()
    import pandas as pd

    if arguments.output.exists():
        parser.error("The output file already exists; choose a new path.")
    predictor = LOSPredictor(arguments.artifact_dir, arguments.device) if arguments.artifact_dir else LOSPredictor.best(
        arguments.output_dir, arguments.device)
    frame = pd.read_csv(arguments.input, encoding="utf-8-sig", dtype=str)
    predictions = predictor.predict(frame)
    # Export only a row reference and prediction; do not duplicate any patient identifiers.
    result = pd.DataFrame({"row_index": range(len(frame)), "predicted_los_days": predictions})
    arguments.output.parent.mkdir(parents=True, exist_ok=True)
    result.to_csv(arguments.output, index=False)


if __name__ == "__main__":
    main()
