"""Optuna search spaces and tree pipelines. Optional libraries are loaded on demand."""

from sklearn.compose import ColumnTransformer
from sklearn.ensemble import RandomForestRegressor
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder

from .config import CATEGORICAL_FEATURES, NUMERIC_FEATURES, SEED


def suggest_parameters(name, trial):
    if name == "catboost":
        return {
            "iterations": trial.suggest_int("iterations", 200, 1200, step=100),
            "depth": trial.suggest_int("depth", 3, 7),
            "learning_rate": trial.suggest_float("learning_rate", 0.01, 0.2, log=True),
            "l2_leaf_reg": trial.suggest_float("l2_leaf_reg", 1.0, 30.0, log=True),
            "border_count": trial.suggest_categorical("border_count", [32, 64, 128]),
            "bagging_temperature": trial.suggest_float("bagging_temperature", 0.0, 3.0),
        }
    if name == "xgboost":
        return {
            "n_estimators": trial.suggest_int("n_estimators", 200, 1200, step=100),
            "max_depth": trial.suggest_int("max_depth", 2, 6),
            "learning_rate": trial.suggest_float("learning_rate", 0.01, 0.2, log=True),
            "min_child_weight": trial.suggest_float("min_child_weight", 1.0, 20.0, log=True),
            "subsample": trial.suggest_float("subsample", 0.6, 1.0),
            "colsample_bytree": trial.suggest_float("colsample_bytree", 0.6, 1.0),
            "reg_alpha": trial.suggest_float("reg_alpha", 1e-8, 10.0, log=True),
            "reg_lambda": trial.suggest_float("reg_lambda", 1e-4, 30.0, log=True),
        }
    if name == "random_forest":
        parameters = {
            "n_estimators": trial.suggest_int("n_estimators", 200, 800, step=200),
            "max_depth": trial.suggest_int("max_depth", 3, 20),
            "min_samples_leaf": trial.suggest_int("min_samples_leaf", 2, 30),
            "min_samples_split": trial.suggest_int("min_samples_split", 2, 20),
            "max_features": trial.suggest_float("max_features", 0.5, 1.0),
            "bootstrap": trial.suggest_categorical("bootstrap", [True, False]),
        }
        if parameters["bootstrap"]:
            parameters["max_samples"] = trial.suggest_float("max_samples", 0.6, 1.0)
        return parameters
    if name == "ft_transformer":
        return {
            "n_blocks": trial.suggest_int("n_blocks", 1, 2),
            "d_block": trial.suggest_categorical("d_block", [32, 64]),
            "attention_n_heads": trial.suggest_categorical("attention_n_heads", [4, 8]),
            "attention_dropout": trial.suggest_float("attention_dropout", 0.0, 0.3),
            "ffn_dropout": trial.suggest_float("ffn_dropout", 0.0, 0.3),
            "ffn_d_hidden_multiplier": trial.suggest_categorical("ffn_d_hidden_multiplier", [4 / 3, 2.0]),
            "learning_rate": trial.suggest_float("learning_rate", 1e-4, 3e-3, log=True),
            "weight_decay": trial.suggest_float("weight_decay", 1e-6, 1e-2, log=True),
            "batch_size": trial.suggest_categorical("batch_size", [32, 64, 128]),
        }
    raise ValueError(f"Unsupported model: {name}")


def make_tree_model(name, parameters, device, workers):
    if name == "catboost":
        from catboost import CatBoostRegressor

        return CatBoostRegressor(
            **parameters,
            cat_features=CATEGORICAL_FEATURES,
            loss_function="MAE",
            bootstrap_type="Bayesian",
            random_seed=SEED,
            task_type="GPU" if device == "cuda" else "CPU",
            devices="0" if device == "cuda" else None,
            thread_count=workers,
            allow_writing_files=False,
            verbose=False,
        )
    if name == "xgboost":
        from xgboost import XGBRegressor

        estimator = XGBRegressor(
            **parameters,
            objective="reg:absoluteerror",
            eval_metric="mae",
            tree_method="hist",
            device="cuda:0" if device == "cuda" else "cpu",
            random_state=SEED,
            n_jobs=workers,
            verbosity=1,
        )
    elif name == "random_forest":
        estimator = RandomForestRegressor(**parameters, random_state=SEED, n_jobs=workers)
    else:
        raise ValueError(f"Not a tree model: {name}")
    preprocessor = ColumnTransformer([
        ("numeric", "passthrough", NUMERIC_FEATURES),
        ("categorical", OneHotEncoder(handle_unknown="ignore", sparse_output=False), CATEGORICAL_FEATURES),
    ])
    return Pipeline([("preprocessor", preprocessor), ("regressor", estimator)])


def verify_xgboost_device(model, requested_device):
    """XGBoost may fall back to CPU with a warning; reject an unexpected fallback."""
    if requested_device == "cuda":
        import json

        config = json.loads(model.named_steps["regressor"].get_booster().save_config())
        actual = config["learner"]["generic_param"]["device"]
        if not actual.startswith("cuda"):
            raise RuntimeError(f"XGBoost used {actual} despite a CUDA request; check the GPU installation.")
