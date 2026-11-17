"""Metrics in original days, without target or prediction transformations."""

import numpy as np
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score


def regression_metrics(target, prediction):
    actual = np.asarray(target, dtype=float)
    predicted = np.asarray(prediction, dtype=float).reshape(-1)
    if actual.shape != predicted.shape or not np.isfinite(predicted).all():
        raise ValueError("Predictions must be finite and match the target shape.")
    return {
        "n_rows": len(actual),
        "mae_days": float(mean_absolute_error(actual, predicted)),
        "rmse_days": float(np.sqrt(mean_squared_error(actual, predicted))),
        "r2": float(r2_score(actual, predicted)) if len(actual) > 1 and np.var(actual) > 0 else None,
        "mean_error_days": float(np.mean(predicted - actual)),
        "negative_prediction_count": int(np.sum(predicted < 0)),
    }


def detailed_metrics(target, prediction, features, long_stay_threshold):
    actual = np.asarray(target, dtype=float)
    predicted = np.asarray(prediction, dtype=float).reshape(-1)
    result = regression_metrics(actual, predicted)
    # This is an evaluation subgroup, not a clinical definition or a data filter.
    long_stays = actual >= long_stay_threshold
    result["long_stay_threshold_days"] = float(long_stay_threshold)
    result["long_stays"] = regression_metrics(actual[long_stays], predicted[long_stays]) if long_stays.any() else None
    result["by_diagnosis"] = {}
    for diagnosis in sorted(features["diagnosis_code"].unique()):
        mask = features["diagnosis_code"].to_numpy() == diagnosis
        result["by_diagnosis"][diagnosis] = regression_metrics(actual[mask], predicted[mask])
    return result


def summarize_folds(fold_metrics):
    summary = {}
    for name in ("mae_days", "rmse_days", "r2"):
        values = [fold[name] for fold in fold_metrics if fold[name] is not None]
        summary[name] = {
            "mean": float(np.mean(values)) if values else None,
            "std": float(np.std(values, ddof=1)) if len(values) > 1 else None,
        }
    return summary
