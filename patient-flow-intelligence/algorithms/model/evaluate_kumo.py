"""Evaluate pretrained Kumo regression; no training or API changes."""

import argparse
from datetime import datetime, timezone
from hashlib import sha256
from importlib.metadata import version
import json
from pathlib import Path
import random
import time

import numpy as np
import pandas as pd
from sklearn.model_selection import KFold, train_test_split

from .config import CATEGORICAL_FEATURES, FEATURES, SEED, TARGET
from .data import validate_features
from .evaluation import detailed_metrics, summarize_folds

ROOT = Path(__file__).resolve().parents[1]
EXTRA_CATEGORIES = ["specialty", "admission_weekday", "time_period"]
KUMO_FEATURES = FEATURES + EXTRA_CATEGORIES


def positive_integer(value):
    number = int(value)
    if number < 1:
        raise argparse.ArgumentTypeError("Must be a positive integer.")
    return number


def parse_arguments():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data", type=Path, default=ROOT / "datasetgenerator/ml_hospital_consumption_27k.csv")
    parser.add_argument("--output-dir", type=Path)
    parser.add_argument("--size", choices=("small", "medium", "large"), default="small")
    parser.add_argument("--device", choices=("cuda", "cpu"), default="cuda")
    parser.add_argument("--estimators", type=positive_integer, default=1)
    parser.add_argument("--batch-size", type=positive_integer, default=256)
    parser.add_argument("--context-rows", type=positive_integer, help="Optional seeded context subset; default: entire training fold.")
    return parser.parse_args()


def load_data(path):
    frame = pd.read_csv(path, encoding="utf-8-sig", dtype=str)
    expected = set(KUMO_FEATURES + [TARGET])
    if set(frame.columns) != expected:
        raise ValueError(f"CSV schema mismatch. Missing: {sorted(expected - set(frame.columns))}; unexpected: {sorted(set(frame.columns) - expected)}")
    features = validate_features(frame)
    for column in EXTRA_CATEGORIES:
        values = frame[column].str.strip()
        if values.isna().any() or values.eq("").any():
            raise ValueError(f"{column} contains missing or empty values.")
        features[column] = values
    target = pd.to_numeric(frame[TARGET], errors="raise").astype(float)
    if not np.isfinite(target).all() or (target < 0).any():
        raise ValueError("los_days must contain finite, nonnegative values.")
    if len(frame) < 20:
        raise ValueError("At least 20 rows are required for five-fold CV and a holdout.")
    return features, target


def write_json(path, value):
    path.write_text(json.dumps(value, indent=2, ensure_ascii=False, allow_nan=False), encoding="utf-8")


def predict_partition(model, features, target, context_indices, query_indices, args, seed):
    import sdm
    import torch

    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)
    categories = CATEGORICAL_FEATURES + EXTRA_CATEGORIES
    stypes = {column: "categorical" if column in categories else "numerical" for column in KUMO_FEATURES}
    context_frame = features.iloc[context_indices].copy()
    context_frame[TARGET] = target.iloc[context_indices].to_numpy()
    context = sdm.TableTensor.from_pandas(context_frame, stypes={**stypes, TARGET: "numerical"}, device=args.device)
    predictions = []
    try:
        with torch.inference_mode(), torch.amp.autocast(args.device, dtype=torch.float16, enabled=args.device == "cuda"):
            # fit caches labelled context; it does not update pretrained weights.
            model.fit(context.drop_columns(TARGET), context[:, TARGET], num_estimators=args.estimators, estimator_batch_size=1)
            for start in range(0, len(query_indices), args.batch_size):
                indices = query_indices[start:start + args.batch_size]
                query = sdm.TableTensor.from_pandas(features.iloc[indices], stypes=stypes, device=args.device)
                output = model.predict(query)
                # The conditional median is the point estimate for MAE.
                predictions.append(output[:, "q500"].numerical.detach().float().cpu().numpy().reshape(-1))
                if (start // args.batch_size + 1) % 5 == 0:
                    print(f"  Predicted {min(start + args.batch_size, len(query_indices))}/{len(query_indices)} rows", flush=True)
        return np.concatenate(predictions)
    finally:
        model.clear()


def context_subset(indices, limit, seed):
    if limit is None or limit >= len(indices):
        return indices
    return np.random.default_rng(seed).choice(indices, size=limit, replace=False)


def metric_row(label, metrics):
    r2 = "n/a" if metrics["r2"] is None else f"{metrics['r2']:.4f}"
    return f"| {label} | {metrics['mae_days']:.4f} | {metrics['rmse_days']:.4f} | {r2} |"


def run(args):
    import sdm
    import torch

    features, target = load_data(args.data)
    if args.device == "cuda" and not torch.cuda.is_available():
        raise RuntimeError("CUDA is unavailable. Install CUDA PyTorch or explicitly use --device cpu.")
    train, test = train_test_split(np.arange(len(target)), test_size=0.2, random_state=SEED, shuffle=True)
    folds = list(KFold(n_splits=5, shuffle=True, random_state=SEED).split(train))
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S_%fZ")
    output_dir = args.output_dir or ROOT / "model/artifacts" / f"kumo_{timestamp}"
    output_dir.mkdir(parents=True, exist_ok=False)
    report = {
        "status": "running", "model": "NVIDIA Kumo-Tabular", "size": args.size,
        "dataset": str(args.data.resolve()), "dataset_sha256": sha256(args.data.read_bytes()).hexdigest(),
        "seed": SEED, "features": KUMO_FEATURES, "target": TARGET, "point_prediction": "q500",
        "n_rows": len(target), "n_train": len(train), "n_test": len(test),
        "device": args.device, "estimators": args.estimators, "batch_size": args.batch_size,
        "context_rows_limit": args.context_rows, "prediction_transform": "none",
        "packages": {name: version(name) for name in ("torch", "structured-data-models", "pandas", "numpy", "scikit-learn")},
        "source_sha256": {name: sha256(Path(__file__).with_name(name).read_bytes()).hexdigest() for name in ("evaluate_kumo.py", "config.py", "data.py", "evaluation.py")},
        "folds": [],
        "split_note": "Row-based split; CSV has no patient identifiers or admission dates.",
    }
    protocol = {"train_indices": train.tolist(), "test_indices": test.tolist(), "folds": []}
    for number, (fit_local, validation_local) in enumerate(folds, 1):
        fit_indices = train[fit_local]
        protocol["folds"].append({
            "fold": number, "train_indices": fit_indices.tolist(),
            "context_indices": context_subset(fit_indices, args.context_rows, SEED + number).tolist(),
            "validation_indices": train[validation_local].tolist(),
        })
    protocol["final_context_indices"] = context_subset(train, args.context_rows, SEED + 6).tolist()
    write_json(output_dir / "protocol.json", protocol)
    write_json(output_dir / "report.json", report)
    print(f"Output: {output_dir}\nRows: {len(target)}; CV partition: {len(train)}; holdout: {len(test)}", flush=True)
    started = time.perf_counter()
    prediction_frames = []
    try:
        if args.device == "cuda":
            report["gpu"] = torch.cuda.get_device_name(0)
            torch.cuda.reset_peak_memory_stats()
        print(f"Loading Kumo-Tabular {args.size} ({args.device})...", flush=True)
        model = sdm.models.KumoTabular(task="regression", size=args.size, device=args.device)
        from huggingface_hub import hf_hub_download

        checkpoint = Path(hf_hub_download("nvidia/Kumo-Tabular", f"{args.size}/regressor.pt", revision="v1.0.1", local_files_only=True))
        report["checkpoint_sha256"] = sha256(checkpoint.read_bytes()).hexdigest()
        report["checkpoint_revision"] = "v1.0.1"
        for fold in protocol["folds"]:
            number = fold["fold"]
            context = np.asarray(fold["context_indices"])
            validation = np.asarray(fold["validation_indices"])
            print(f"Fold {number}/5: context={len(context)}, validation={len(validation)}", flush=True)
            fold_started = time.perf_counter()
            prediction = predict_partition(model, features, target, context, validation, args, SEED + number)
            threshold = float(np.quantile(target.iloc[fold["train_indices"]], 0.9))
            metrics = detailed_metrics(target.iloc[validation], prediction, features.iloc[validation], threshold)
            report["folds"].append({"fold": number, "seconds": time.perf_counter() - fold_started, **metrics})
            prediction_frames.append(pd.DataFrame({"row_index": validation, "fold": number, "actual_los_days": target.iloc[validation].to_numpy(), "predicted_los_days": prediction}))
            pd.concat(prediction_frames, ignore_index=True).to_csv(output_dir / "cv_predictions.csv", index=False)
            write_json(output_dir / "report.json", report)
            print(f"Fold {number}: MAE={metrics['mae_days']:.4f} days", flush=True)

        report["cv_summary"] = summarize_folds(report["folds"])
        cv = pd.concat(prediction_frames, ignore_index=True)
        threshold = float(np.quantile(target.iloc[train], 0.9))
        report["cv_pooled"] = detailed_metrics(cv.actual_los_days, cv.predicted_los_days, features.iloc[cv.row_index], threshold)
        print("Evaluating reserved 20% holdout...", flush=True)
        prediction = predict_partition(model, features, target, np.asarray(protocol["final_context_indices"]), test, args, SEED + 6)
        report["test"] = detailed_metrics(target.iloc[test], prediction, features.iloc[test], threshold)
        pd.DataFrame({"row_index": test, "actual_los_days": target.iloc[test].to_numpy(), "predicted_los_days": prediction}).to_csv(output_dir / "test_predictions.csv", index=False)
        report["seconds"] = time.perf_counter() - started
        if args.device == "cuda":
            report["peak_gpu_allocated_bytes"] = torch.cuda.max_memory_allocated()
        rows = [{"evaluation": "cv_mean", **{key: value["mean"] for key, value in report["cv_summary"].items()}},
                {"evaluation": "test", **{key: report["test"][key] for key in ("mae_days", "rmse_days", "r2")}}]
        pd.DataFrame(rows).to_csv(output_dir / "summary.csv", index=False)
        lines = [f"Kumo-Tabular {args.size} — {len(target)} records; {args.estimators} estimator(s)",
                 f"Context limit: {args.context_rows or 'full training partition'}; point prediction: q500; seed: {SEED}.",
                 "", "| Evaluation | MAE (days) | RMSE (days) | R² |", "|---|---:|---:|---:|"]
        lines.extend(metric_row(f"CV fold {fold['fold']}", fold) for fold in report["folds"])
        lines.extend([metric_row("CV mean", rows[0]), metric_row("Reserved test (20%)", report["test"])])
        lines.append(f"\nCV MAE standard deviation: {report['cv_summary']['mae_days']['std']:.4f} days.")
        long_stays = report["cv_pooled"]["long_stays"]
        if long_stays:
            lines.append(f"CV long stays (>= {threshold:g} days): n={long_stays['n_rows']}, MAE={long_stays['mae_days']:.4f} days, mean predicted-minus-actual error={long_stays['mean_error_days']:.4f} days.")
        lines.append("\nRow-based evaluation: repeated-patient separation and temporal generalization cannot be verified from this CSV.")
        table = "\n".join(lines) + "\n"
        (output_dir / "summary.md").write_text(table, encoding="utf-8")
        report["status"] = "complete"
        write_json(output_dir / "report.json", report)
        print(table, flush=True)
    except Exception as error:
        report.update(status="failed", error=f"{type(error).__name__}: {error}", seconds=time.perf_counter() - started)
        write_json(output_dir / "report.json", report)
        raise


if __name__ == "__main__":
    run(parse_arguments())
