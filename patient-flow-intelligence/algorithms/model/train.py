"""Explicit CLI entry point. Nothing is trained on import or with --validate-only."""

import argparse
from datetime import datetime, timezone
from hashlib import sha256
from importlib.metadata import version
import logging
import os
from pathlib import Path
import platform
import random
import statistics
import sys
import time

from .config import (
    CATBOOST_CATEGORICAL_FEATURES, CATBOOST_DATASET, CATEGORICAL_FEATURES,
    DEFAULT_DATASET, DEFAULT_OUTPUT, DEFAULT_TRIALS, MODEL_NAMES, SEED,
)

LOGGER = logging.getLogger(__name__)


def positive_integer(value):
    number = int(value)
    if number < 1:
        raise argparse.ArgumentTypeError("Must be a positive integer.")
    return number


def parse_arguments():
    parser = argparse.ArgumentParser(description="Tune and train one LOS model; the target is untransformed los_days.")
    parser.add_argument("--model", required=True, choices=MODEL_NAMES)
    parser.add_argument("--data", type=Path, help="Default: ml_hospital_consumption_27k.csv for CatBoost; ml_hospital_consumption.csv for the other models.")
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--trials", type=positive_integer, help="Default: CatBoost/XGBoost 100, Random Forest 60, FT-Transformer 50.")
    parser.add_argument("--test-size", type=float, default=0.2)
    parser.add_argument("--folds", type=positive_integer, default=5)
    parser.add_argument("--device", choices=("cuda", "cpu"), help="Default: CUDA, except Random Forest (CPU only).")
    parser.add_argument("--workers", type=positive_integer, default=1, help="CPU threads; Optuna trials run sequentially.")
    parser.add_argument("--group-column", help="Optional patient identifier, excluded from features and used to keep patients together.")
    parser.add_argument("--max-epochs", type=positive_integer, default=200, help="FT-Transformer inner early-stopping epoch limit.")
    parser.add_argument("--patience", type=positive_integer, default=20, help="FT-Transformer early-stopping patience.")
    parser.add_argument("--validate-only", action="store_true", help="Validate dataset, splits, dependencies, and hardware without fitting or writing artifacts.")
    arguments = parser.parse_args()
    if arguments.data is None:
        arguments.data = CATBOOST_DATASET if arguments.model == "catboost" else DEFAULT_DATASET
    if not 0 < arguments.test_size < 1:
        parser.error("--test-size must be between zero and one.")
    if arguments.folds < 2:
        parser.error("--folds must be at least two.")
    if arguments.patience > arguments.max_epochs:
        parser.error("--patience cannot exceed --max-epochs.")
    arguments.device = arguments.device or ("cpu" if arguments.model == "random_forest" else "cuda")
    if arguments.model == "random_forest" and arguments.device != "cpu":
        parser.error("scikit-learn Random Forest is CPU-only; use --device cpu.")
    arguments.trials = arguments.trials or DEFAULT_TRIALS[arguments.model]
    return arguments


def runtime_information(arguments):
    packages = ["numpy", "pandas", "scikit-learn", "optuna", "joblib"]
    selected = {
        "catboost": ["catboost"], "xgboost": ["xgboost"],
        "random_forest": [], "ft_transformer": ["torch", "rtdl-revisiting-models"],
    }
    packages.extend(selected[arguments.model])
    information = {
        "python": sys.version,
        "platform": platform.platform(),
        "device": arguments.device,
        "workers": arguments.workers,
        "packages": {package: version(package) for package in packages},
    }
    if arguments.model == "catboost":
        import catboost

        if arguments.device == "cuda":
            from catboost.utils import get_gpu_device_count

            if get_gpu_device_count() < 1:
                raise RuntimeError("CatBoost cannot find an NVIDIA GPU. Check the driver and CUDA support.")
    elif arguments.model == "xgboost":
        import xgboost

        if arguments.device == "cuda" and xgboost.build_info().get("USE_CUDA") not in (True, "ON", 1):
            raise RuntimeError("This XGBoost build has no CUDA support; install the full xgboost package.")
    if arguments.device == "cuda" or arguments.model == "ft_transformer":
        import torch

        information["packages"]["torch"] = version("torch")
        information["torch_cuda_version"] = torch.version.cuda
        if arguments.device == "cuda":
            if not torch.cuda.is_available():
                raise RuntimeError(
                    "CUDA is unavailable. Install the CUDA build of PyTorch described in model/README.md "
                    "and check the NVIDIA driver. No automatic CPU fallback is performed."
                )
            information["gpu"] = torch.cuda.get_device_name(0)
            information["gpu_memory_bytes"] = torch.cuda.get_device_properties(0).total_memory
    if arguments.model == "ft_transformer":
        # Import the authors' implementation now, so validation also checks its dependencies.
        from .ft_transformer import FTTransformerRegressor

    return information


def run(arguments):
    # Must be configured before importing torch or initializing CUDA.
    os.environ.setdefault("CUBLAS_WORKSPACE_CONFIG", ":4096:8")
    import joblib
    import numpy as np
    import optuna
    import pandas as pd

    from .artifacts import select_best, write_json
    from .data import load_experiment
    from .estimators import make_tree_model, suggest_parameters, verify_xgboost_device
    from .evaluation import detailed_metrics, regression_metrics, summarize_folds

    random.seed(SEED)
    np.random.seed(SEED)
    runtime = runtime_information(arguments)
    categorical_features = CATBOOST_CATEGORICAL_FEATURES if arguments.model == "catboost" else CATEGORICAL_FEATURES
    data = load_experiment(arguments.data.resolve(), arguments.test_size, arguments.folds, arguments.group_column,
                           categorical_features=categorical_features)
    source = b"".join(
        path.name.encode() + path.read_bytes()
        for path in sorted(Path(__file__).resolve().parent.glob("*.py"))
    )
    data.protocol["source_sha256"] = sha256(source).hexdigest()
    train_features = data.features.iloc[data.train_indices].reset_index(drop=True)
    train_target = data.target.iloc[data.train_indices].reset_index(drop=True)
    train_groups = data.groups.iloc[data.train_indices].reset_index(drop=True) if data.groups is not None else None
    if arguments.model == "ft_transformer" and train_groups is not None:
        if any(train_groups.iloc[a].nunique() < 2 for a, _ in data.folds):
            raise ValueError("Every FT-Transformer training fold needs two distinct patients for inner early stopping.")
    LOGGER.info("Validated %s rows: %s train, %s test, %s folds; device=%s; seed=%s.",
                len(data.features), len(train_features), len(data.test_indices), len(data.folds), arguments.device, SEED)
    if arguments.group_column is None:
        LOGGER.info("No patient identifier configured; using row-based splits (repeated-patient separation cannot be verified).")
    if arguments.model == "catboost" and arguments.device == "cuda":
        LOGGER.info("CatBoost GPU reductions are not fully deterministic, even with random_seed=8228.")
    if arguments.validate_only:
        import json

        print(json.dumps({"status": "validated_without_training", "runtime": runtime, "protocol": {
            key: value for key, value in data.protocol.items() if key != "split"
        }}, indent=2))
        return

    output_root = arguments.output_dir.resolve()
    directory = output_root / arguments.model
    if directory.exists():
        raise ValueError(f"Output already exists: {directory}. Choose a new --output-dir to preserve previous runs.")
    # Check comparability before starting an expensive search.
    for other in MODEL_NAMES:
        existing = output_root / other / "protocol.json"
        if existing.is_file():
            import json

            if json.loads(existing.read_text(encoding="utf-8")) != data.protocol:
                raise ValueError("Existing runs use a different experiment protocol. Choose a new --output-dir for all four models.")
    directory.mkdir(parents=True)
    write_json(directory / "protocol.json", data.protocol)
    write_json(directory / "status.json", {"status": "running", "model": arguments.model})
    started = time.perf_counter()

    def build_model(parameters):
        if arguments.model == "ft_transformer":
            from .ft_transformer import FTTransformerRegressor

            return FTTransformerRegressor(parameters, arguments.device, arguments.workers,
                                          arguments.max_epochs, arguments.patience)
        return make_tree_model(arguments.model, parameters, arguments.device, arguments.workers,
                               categorical_features=categorical_features)

    def fit_model(model, features, target, groups=None, epochs=None):
        if arguments.model == "ft_transformer":
            model.fit(features, target, groups=groups, epochs=epochs)
        else:
            model.fit(features, target)
            if arguments.model == "xgboost":
                verify_xgboost_device(model, arguments.device)

    def evaluate_parameters(parameters, trial=None):
        fold_metrics, epochs = [], []
        predictions = np.full(len(train_target), np.nan)
        fold_numbers = np.full(len(train_target), -1, dtype=int)
        for number, (training, validation) in enumerate(data.folds, start=1):
            model = build_model(parameters)
            groups = train_groups.iloc[training] if train_groups is not None else None
            fit_model(model, train_features.iloc[training], train_target.iloc[training], groups=groups)
            predicted = model.predict(train_features.iloc[validation])
            metrics = regression_metrics(train_target.iloc[validation], predicted)
            fold_metrics.append(metrics)
            predictions[validation] = np.asarray(predicted).reshape(-1)
            fold_numbers[validation] = number
            if arguments.model == "ft_transformer":
                epochs.append(model.epochs_)
            LOGGER.info("Trial %s, fold %s/%s: MAE %.4f days.",
                        trial.number if trial else "best", number, len(data.folds), metrics["mae_days"])
            del model
        if trial is not None:
            trial.set_user_attr("fold_metrics", fold_metrics)
            trial.set_user_attr("fold_epochs", epochs)
        return fold_metrics, epochs, predictions, fold_numbers

    best_evaluation = None

    def objective(trial):
        nonlocal best_evaluation
        evaluation = evaluate_parameters(suggest_parameters(arguments.model, trial), trial)
        score = float(np.mean([fold["mae_days"] for fold in evaluation[0]]))
        if best_evaluation is None or score < best_evaluation[0]:
            best_evaluation = (score, evaluation)
        return score

    try:
        study = optuna.create_study(
            direction="minimize",
            sampler=optuna.samplers.TPESampler(seed=SEED),
            pruner=optuna.pruners.NopPruner(),
            storage=f"sqlite:///{(directory / 'study.sqlite3').as_posix()}",
            study_name=f"los_{arguments.model}",
        )
        study.optimize(objective, n_trials=arguments.trials, n_jobs=1)
        best = study.best_trial
        write_json(directory / "best_parameters.json", best.params)
        study.trials_dataframe().to_csv(directory / "trials.csv", index=False)
        # Retain the winning trial's actual OOF predictions, avoiding an extra stochastic GPU rerun.
        if best_evaluation is None:
            raise RuntimeError("No completed trial evaluation is available.")
        fold_metrics, fold_epochs, oof, fold_numbers = best_evaluation[1]
        cv_summary = summarize_folds(fold_metrics)
        model = build_model(best.params)
        final_epochs = max(1, round(statistics.median(fold_epochs))) if fold_epochs else None
        LOGGER.info("Refitting %s on all %s training rows; test rows remain excluded.", arguments.model, len(train_target))
        fit_model(model, train_features, train_target, groups=train_groups, epochs=final_epochs)
        test_features = data.features.iloc[data.test_indices]
        test_target = data.target.iloc[data.test_indices]
        test_predictions = model.predict(test_features)
        threshold = float(train_target.quantile(0.9))
        test_metrics = detailed_metrics(test_target, test_predictions, test_features, threshold)
        if arguments.model == "ft_transformer":
            model.save(directory)
            files = ["weights.pt", "preprocessor.joblib"]
        else:
            joblib.dump(model, directory / "model.joblib")
            files = ["model.joblib"]
        write_json(directory / "artifact.json", {
            "model": arguments.model,
            "files": files,
            "features": data.protocol["features"],
            "target": data.protocol["target"],
            "target_transform": "none",
            "prediction_transform": "none",
        })
        pd.DataFrame({"row_index": data.train_indices, "fold": fold_numbers,
                      "actual_los_days": train_target.to_numpy(), "predicted_los_days": oof}).to_csv(
            directory / "cv_predictions.csv", index=False)
        pd.DataFrame({"row_index": data.test_indices, "actual_los_days": test_target.to_numpy(),
                      "predicted_los_days": np.asarray(test_predictions).reshape(-1)}).to_csv(
            directory / "test_predictions.csv", index=False)
        report = {
            "model": arguments.model,
            "completed_at_utc": datetime.now(timezone.utc).isoformat(),
            "protocol": data.protocol,
            "runtime": runtime,
            "training_options": {"trials": arguments.trials, "max_epochs": arguments.max_epochs,
                                 "patience": arguments.patience, "final_epochs": final_epochs},
            "best_trial_number": best.number,
            "best_trial_cv_mae_days": best.value,
            "best_parameters": best.params,
            "cv": cv_summary,
            "cv_folds": fold_metrics,
            "cv_fold_epochs": fold_epochs,
            "cv_out_of_fold": detailed_metrics(train_target, oof, train_features, threshold),
            "test": test_metrics,
            "elapsed_seconds": time.perf_counter() - started,
        }
        write_json(directory / "report.json", report)
        write_json(directory / "status.json", {"status": "completed", "model": arguments.model})
    except BaseException as error:
        write_json(directory / "status.json", {"status": "failed", "error": str(error)})
        raise
    leaderboard = select_best(output_root)
    LOGGER.info("Saved %s. CV MAE: %.4f days; test MAE: %.4f days.",
                directory, cv_summary["mae_days"]["mean"], test_metrics["mae_days"])
    if leaderboard["all_four_complete"]:
        LOGGER.info("All four models complete. Selected candidate: %s (lowest CV MAE).", leaderboard["ranking"][0]["model"])
    else:
        LOGGER.info("Remaining models before final selection: %s.", ", ".join(leaderboard["missing_models"]))


def main():
    arguments = parse_arguments()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    try:
        run(arguments)
    except (ValueError, RuntimeError, ImportError, OSError) as error:
        LOGGER.error("%s", error)
        raise SystemExit(1) from error


if __name__ == "__main__":
    main()
