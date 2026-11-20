"""Validate admission-time features and construct identical splits for every model."""

from dataclasses import dataclass
from hashlib import sha256
import json
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.model_selection import GroupKFold, GroupShuffleSplit, KFold, train_test_split

from .config import CATEGORICAL_FEATURES, NUMERIC_FEATURES, PROTOCOL_VERSION, SEED, TARGET


def validate_features(frame: pd.DataFrame, *, categorical_features=CATEGORICAL_FEATURES) -> pd.DataFrame:
    feature_columns = NUMERIC_FEATURES + list(categorical_features)
    missing = set(feature_columns) - set(frame.columns)
    if missing:
        raise ValueError(f"Missing feature columns: {sorted(missing)}")
    result = frame.loc[:, feature_columns].copy()
    if result.empty:
        raise ValueError("At least one patient row is required.")
    if result.isna().any().any():
        raise ValueError("Features contain missing values; provide complete admission-time features.")
    for column in ("age", "month"):
        values = pd.to_numeric(result[column], errors="raise").astype(float)
        if not np.isfinite(values).all():
            raise ValueError(f"{column} must contain finite numbers.")
        result[column] = values
    if (result["age"] < 0).any():
        raise ValueError("age cannot be negative.")
    months = result["month"]
    if ((months < 1) | (months > 12) | (months != np.floor(months))).any():
        raise ValueError("month must be an integer between 1 and 12.")
    # Month is categorical: December and January must not imply a linear distance.
    result["month"] = months.astype(int).astype(str)
    for column in categorical_features:
        result[column] = result[column].astype(str).str.strip()
        if result[column].eq("").any():
            raise ValueError(f"{column} cannot contain empty values.")
    return result


@dataclass
class ExperimentData:
    features: pd.DataFrame
    target: pd.Series
    groups: pd.Series | None
    train_indices: np.ndarray
    test_indices: np.ndarray
    folds: list[tuple[np.ndarray, np.ndarray]]
    protocol: dict


def load_experiment(path: Path, test_size: float, n_folds: int, group_column: str | None,
                    *, categorical_features=CATEGORICAL_FEATURES) -> ExperimentData:
    feature_columns = NUMERIC_FEATURES + list(categorical_features)
    if not path.is_file():
        raise ValueError(f"Dataset not found: {path}")
    if group_column and group_column in feature_columns + [TARGET]:
        raise ValueError("The grouping column must be a separate patient identifier.")
    frame = pd.read_csv(path, encoding="utf-8-sig", dtype=str)
    expected = set(feature_columns + [TARGET] + ([group_column] if group_column else []))
    if set(frame.columns) != expected:
        raise ValueError(
            f"Dataset schema mismatch. Missing: {sorted(expected - set(frame.columns))}; "
            f"unexpected: {sorted(set(frame.columns) - expected)}. "
            "Only admission-time features, los_days, and an explicitly configured grouping column are allowed."
        )
    features = validate_features(frame, categorical_features=categorical_features)
    target = pd.to_numeric(frame[TARGET], errors="raise").astype(float)
    if not np.isfinite(target).all() or (target < 0).any():
        raise ValueError("los_days must contain finite, nonnegative numbers; zero-day stays are allowed.")
    groups = None
    indices = np.arange(len(frame))
    if group_column:
        groups = frame[group_column].str.strip()
        if groups.isna().any() or groups.eq("").any():
            raise ValueError("Patient identifiers cannot be missing or empty.")
        splitter = GroupShuffleSplit(n_splits=1, test_size=test_size, random_state=SEED)
        train, test = next(splitter.split(features, target, groups))
    else:
        train, test = train_test_split(indices, test_size=test_size, random_state=SEED, shuffle=True)
    if len(test) < 2 or len(train) < 2 * n_folds:
        raise ValueError("Insufficient records: require at least two test rows and two rows per CV fold.")
    if groups is not None:
        if groups.iloc[train].nunique() < n_folds:
            raise ValueError("The training partition needs at least one distinct patient per CV fold.")
        cv = GroupKFold(n_splits=n_folds, shuffle=True, random_state=SEED)
        folds = list(cv.split(features.iloc[train], target.iloc[train], groups.iloc[train]))
    else:
        cv = KFold(n_splits=n_folds, shuffle=True, random_state=SEED)
        folds = list(cv.split(train))
    if any(len(validation) < 2 for _, validation in folds):
        raise ValueError("Every validation fold must contain at least two rows to calculate R-squared.")
    # Local fold indices reference the 80% training partition, never the test partition.
    split_record = {
        "train_indices": train.tolist(),
        "test_indices": test.tolist(),
        "folds": [{"train": a.tolist(), "validation": b.tolist()} for a, b in folds],
    }
    protocol = {
        "version": PROTOCOL_VERSION,
        "dataset_sha256": sha256(path.read_bytes()).hexdigest(),
        "split_sha256": sha256(json.dumps(split_record, sort_keys=True).encode()).hexdigest(),
        "seed": SEED,
        "features": feature_columns,
        "categorical_features": list(categorical_features),
        "target": TARGET,
        "target_transform": "none",
        "prediction_transform": "none",
        "selection_metric": "cv_mae_mean",
        "test_size_requested": test_size,
        "n_folds": n_folds,
        "group_column": group_column,
        "n_rows": len(frame),
        "n_train": len(train),
        "n_test": len(test),
        "split": split_record,
    }
    return ExperimentData(features, target, groups, train, test, folds, protocol)
