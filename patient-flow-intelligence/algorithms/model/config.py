"""Shared experiment defaults; paths do not depend on the working directory."""

from pathlib import Path

SEED = 8228
TARGET = "los_days"
NUMERIC_FEATURES = ["age"]
CATEGORICAL_FEATURES = ["gender", "diagnosis_code", "month", "season"]
FEATURES = NUMERIC_FEATURES + CATEGORICAL_FEATURES
CATBOOST_CATEGORICAL_FEATURES = CATEGORICAL_FEATURES + ["specialty", "admission_weekday", "time_period"]
CATBOOST_FEATURES = NUMERIC_FEATURES + CATBOOST_CATEGORICAL_FEATURES
MODEL_NAMES = ("catboost", "xgboost", "random_forest", "ft_transformer")
DEFAULT_TRIALS = dict(zip(MODEL_NAMES, (100, 100, 60, 50)))
DEFAULT_DATASET = Path(__file__).resolve().parents[1] / "datasetgenerator" / "ml_hospital_consumption.csv"
CATBOOST_DATASET = DEFAULT_DATASET.with_name("ml_hospital_consumption_87k.csv")
DEFAULT_OUTPUT = Path(__file__).resolve().parent / "artifacts"
PROTOCOL_VERSION = 1
