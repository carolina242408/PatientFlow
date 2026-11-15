# Length-of-stay regression

Offline training for CatBoost, XGBoost, Random Forest, and a compact FT-Transformer.
The target is **`los_days` directly**. There is no logarithm, target scaling,
rounding, prediction clipping, or removal of valid long stays. Predictions remain
continuous day estimates. Reports include negative-prediction counts so that raw
regression outputs can be inspected before application deployment.

Importing modules, starting FastAPI, displaying CLI help, or running
`--validate-only` does not train a model. The application API is unchanged.

## NVIDIA setup (Windows / PowerShell)

Run all commands below from `patient-flow-intelligence/algorithms`.
Use Python 3.12 or 3.13 and an up-to-date NVIDIA driver.
The separate environment keeps training dependencies out of the current
FastAPI requirements and Docker build.

```powershell
python -m venv model/.venv
./model/.venv/Scripts/python.exe -m pip install torch==2.14.1 --index-url https://download.pytorch.org/whl/cu126
./model/.venv/Scripts/python.exe -m pip install -r model/requirements.txt
```

Install the CUDA PyTorch wheel **before** the other requirements. The CUDA 12.6
build supports the RTX 2060; pip supplies its CUDA runtime, so a separate CUDA
Toolkit installation is not needed for these prebuilt packages. See the
[official PyTorch installation commands](https://pytorch.org/get-started/previous-versions/).
For a CPU deployment machine, use the CPU PyTorch index instead:
`https://download.pytorch.org/whl/cpu`.

CatBoost and XGBoost use their own GPU implementations; FT-Transformer uses
PyTorch CUDA. All three default to CUDA and reject unavailable GPU support.
XGBoost's selected device is also checked after each fit to catch CPU fallback.
scikit-learn Random Forest is **CPU-only**, even on an NVIDIA-equipped machine.

Validate the dataset, splits, installed dependencies, and GPU without training
or creating model artifacts:

```powershell
./model/.venv/Scripts/python.exe -m model.train --model catboost --validate-only
./model/.venv/Scripts/python.exe -m model.train --model xgboost --validate-only
./model/.venv/Scripts/python.exe -m model.train --model random_forest --validate-only
./model/.venv/Scripts/python.exe -m model.train --model ft_transformer --validate-only
```

## Training commands

Run these separately and sequentially to avoid GPU resource contention:

```powershell
./model/.venv/Scripts/python.exe -m model.train --model catboost --device cuda --trials 100 --output-dir model/artifacts/catboost_27k
./model/.venv/Scripts/python.exe -m model.train --model xgboost --device cuda --trials 100
./model/.venv/Scripts/python.exe -m model.train --model random_forest --device cpu --trials 60
./model/.venv/Scripts/python.exe -m model.train --model ft_transformer --device cuda --trials 50
```

CatBoost now defaults to `datasetgenerator/ml_hospital_consumption_27k.csv`
(27,465 rows) and uses eight predictors: the five listed below plus `specialty`,
`admission_weekday`, and `time_period`, all three categorical. The target remains
`los_days`. Its default 80/20 split contains 21,972 training rows and 5,493 test
rows, with five-fold CV and seed 8228, matching the Kumo evaluation's row splits.
The command above saves the CatBoost model and report under
`model/artifacts/catboost_27k/catboost/`. Choose a new output directory for a repeat.
It trains only CatBoost; its model and report are available without training the
other models. Use `--artifact-dir model/artifacts/catboost_27k/catboost` for prediction.

The other models retain their existing dataset and five-feature defaults. Their
runs cannot be combined with this CatBoost run in the automatic four-model
selection because the datasets and schemas differ.

Change `--trials` to adjust the search budget. Use `--workers 6`, for example,
to give Random Forest more CPU threads. Default CPU threads: one. Optuna trials
always run sequentially, which preserves the seeded suggestion order.
For FT-Transformer, `--max-epochs 200 --patience 20` controls inner early stopping.
Its search uses 1-2 blocks, token widths 32/64, batches 32/64/128, and tunes
attention heads, dropout, learning rate, and weight decay. Early stopping
determines an epoch count on an inner split, followed by a fresh fit on the
entire outer training fold. The final fit uses the median winning-fold epoch
count and all rows in the 80% training partition.

Use `--device cpu` explicitly for CPU training of the other three models.
GPU training and CPU inference use the same learned weights; retraining is not
required to move a model to a weaker PC.

Existing model directories are never overwritten. To repeat an experiment, give
**all four commands** the same new directory, for example
`--output-dir model/artifacts/experiment_02`. Failed runs keep their study and
status for diagnosis; automatic study resumption is not implemented. These
subdirectories and default artifacts are ignored by Git. Custom output paths
outside `model/artifacts` must be managed separately.

## Data and evaluation protocol

The default CSV is `datasetgenerator/ml_hospital_consumption_27k.csv` for
CatBoost and `datasetgenerator/ml_hospital_consumption.csv` for the other models,
resolved relative to the package rather than the current working directory.
Override it with `--data path/to/data.csv`; the CSV must match that model's schema.

Expected training schema:

| Column | Use |
| --- | --- |
| `age` | Numeric admission-time feature; standardized only for FT-Transformer |
| `gender` | Categorical feature |
| `diagnosis_code` | Categorical feature; must be known at prediction time |
| `month` | Integer 1-12, treated as a category |
| `season` | Categorical feature |
| `specialty` | CatBoost only: categorical feature, known at prediction time |
| `admission_weekday` | CatBoost only: categorical feature |
| `time_period` | CatBoost only: categorical feature |
| `los_days` | Finite, nonnegative target, including zero-day stays |

Missing/invalid values and unexpected columns cause explicit errors. Target
values are never used as input features. No patient identifiers or dates are
inferred from the feature values. For future datasets with repeated admissions,
retain a patient identifier and pass `--group-column patient_id` to **all four
commands**. It is excluded from predictors. Holdout and CV splits then keep each
patient together; the 80/20 proportion applies to patient groups and may differ
by row count. The current dataset has no patient identifier, so the default
row-based split cannot guarantee separation of repeated patients. A temporal
validation would require admission dates, which are also absent from this CSV.

1. Reserve 20% of the rows as the final test set (5,493 for CatBoost; 403 for the original CSV).
2. Use shuffled five-fold CV splits inside the remaining 80% (21,972 for CatBoost; 1,609 for the original CSV). Identical datasets and settings produce identical splits.
3. Tune every model with Optuna TPE, minimizing mean validation **MAE in days**.
   CatBoost uses MAE loss, XGBoost uses absolute-error loss, FT-Transformer uses
   L1 loss, and Random Forest uses its default squared-error splitting criterion.
   The comparison metric is MAE for every model regardless of its fitting loss.
4. Fit encoders/scalers on each training fold only. CatBoost handles categories
   natively; XGBoost/Random Forest use one-hot encoding with unseen values ignored.
   FT-Transformer uses categorical embeddings with a reserved unknown-category
   index and standardizes input age. It never scales the target.
5. Report fold MAE, RMSE, R-squared, mean/std across folds, and pooled out-of-fold
   metrics. R-squared is null for constant targets or subgroups with one row.
6. Refit the best settings on the complete 80% training partition, then evaluate
   the final test set. Save errors by diagnosis and for long stays, defined here
   solely for reporting as LOS at/above the training partition's 90th percentile.
   This subgroup does not filter data or change training weights.
7. After **all four** runs complete, choose the application candidate using
   **CV MAE only**. Test scores do not influence selection. An exact CV MAE tie
   is resolved alphabetically by model name. The artifact remains fitted on the
   training partition; the test set is not incorporated afterward.

Seed **8228** is used for splits, Optuna, estimators, and Python/NumPy/PyTorch
randomness. PyTorch requests deterministic operations, with CUDA cuBLAS configured
before initialization. Reproducibility still depends on the software/hardware
environment. In particular, [CatBoost GPU training is nondeterministic](https://catboost.ai/docs/en/features/training-on-gpu)
because of floating-point reductions even with a fixed seed. Package versions,
GPU details, source/dataset hashes, and actual split indices are recorded.
CV scores are tuning results, not unbiased estimates after hyperparameter search;
the untouched test set provides the final evaluation.

## Outputs and selected model

Each `model/artifacts/<model>/` contains:

- `study.sqlite3`, `trials.csv`, and `best_parameters.json`: Optuna search results.
- `protocol.json`: dataset/source fingerprints and train/test/CV assignments.
- `report.json`: CV/test metrics, environment, settings, and training duration.
- `cv_predictions.csv` and `test_predictions.csv`: original CSV row references,
  observed LOS, predictions, and CV fold where applicable.
- `model.joblib` for trees, or `weights.pt` plus `preprocessor.joblib` for FT-Transformer.
- `artifact.json` and `status.json`: model metadata and run state.

The experiment root receives `leaderboard.json` after every completed run.
`best_model.json` is created only when all four comparable artifacts exist.
Runs with different data, code, seeds, schema, or splits cannot be combined.
To regenerate selection without training:

```powershell
./model/.venv/Scripts/python.exe -m model.select
```

For application integration, load the candidate once in the backend process:

```python
from model.predict import LOSPredictor

predictor = LOSPredictor.best(device="cpu")
predictions_in_days = predictor.predict(admission_features_dataframe)
```

The input DataFrame must contain the feature columns recorded in the artifact:
eight for the updated CatBoost model, five for the other models and legacy
CatBoost artifacts. To predict from
a CSV on CPU after training:

```powershell
./model/.venv/Scripts/python.exe -m model.predict --input new_admissions.csv --output predictions.csv
```

Use `--artifact-dir model/artifacts/catboost` to load a specific candidate.
Only load trusted local artifacts because joblib deserialization executes Python
objects. Copy the selected model directory, its preprocessing, `best_model.json`,
`leaderboard.json`, and the model package to the deployment environment with
compatible dependencies.
The saved training datasets and Optuna studies are not required for inference.

FT-Transformer uses the authors' [rtdl-revisiting-models implementation](https://github.com/yandex-research/rtdl-revisiting-models/tree/main/package).
No pretrained text model, external model API, or uploaded patient data is involved.
