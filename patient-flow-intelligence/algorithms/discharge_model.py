"""Local Kumo Small regression with a single cached in-context estimator."""

import os

# Set before importing libraries that can contact Hugging Face. Never allow a
# missing local artifact to trigger a download in the serving process.
for name in ("HF_HUB_OFFLINE", "HF_HUB_DISABLE_TELEMETRY", "HF_HUB_DISABLE_IMPLICIT_TOKEN",
             "TRANSFORMERS_OFFLINE", "DO_NOT_TRACK"):
    os.environ[name] = "1"
os.environ["WANDB_MODE"] = "disabled"

from hashlib import file_digest
import math
from pathlib import Path
from threading import Lock

import pandas as pd
import sdm
import torch

from kumo_assets import DEFAULT_MODEL_DIR, REVISION, verify_checkpoint

FEATURES = ["gender", "specialty", "diagnosis_code", "age", "month",
            "admission_weekday", "time_period", "season"]
TARGET = "los_days"
STYPES = {name: "numerical" if name == "age" else "categorical" for name in FEATURES}
SEED = 8228


class DischargeModel:
    def __init__(self):
        self._lock = Lock()
        self.device = os.environ.get("KUMO_DEVICE", "cpu")
        if self.device not in ("cpu", "cuda"):
            raise ValueError("KUMO_DEVICE must be cpu or cuda")
        if self.device == "cuda" and not torch.cuda.is_available():
            raise RuntimeError("KUMO_DEVICE=cuda but CUDA is unavailable")
        model_dir = Path(os.environ.get("KUMO_MODEL_DIR", str(DEFAULT_MODEL_DIR)))
        checkpoint = model_dir / "regressor.pt"
        verify_checkpoint(checkpoint)
        if not (model_dir / "LICENSE").is_file():
            raise ValueError("The model license must accompany its checkpoint")

        dataset = Path(os.environ.get("KUMO_DATASET", str(
            Path(__file__).resolve().parent / "datasetgenerator/ml_hospital_consumption_87k.csv")))
        with dataset.open("rb") as source:
            dataset_hash = file_digest(source, "sha256").hexdigest()
        frame = pd.read_csv(dataset, dtype=str, encoding="utf-8-sig")
        if set(frame.columns) != set(FEATURES + [TARGET]) or len(frame) < 2:
            raise ValueError("Invalid discharge context CSV schema or row count")
        if frame.isna().any().any():
            raise ValueError("Discharge context CSV contains missing values")
        for name in FEATURES + [TARGET]:
            frame[name] = frame[name].str.strip()
            if frame[name].eq("").any():
                raise ValueError("Discharge context CSV contains empty values")
        for name in ("age", "month", TARGET):
            frame[name] = pd.to_numeric(frame[name], errors="raise")
            if not frame[name].map(math.isfinite).all():
                raise ValueError("Discharge context CSV contains nonfinite values")
        if not frame.age.between(0, 130).all() or not frame.age.mod(1).eq(0).all():
            raise ValueError("Invalid age in discharge context CSV")
        if not frame.month.between(1, 12).all() or not frame.month.mod(1).eq(0).all():
            raise ValueError("Invalid month in discharge context CSV")
        if frame[TARGET].lt(0).any():
            raise ValueError("Negative length of stay in discharge context CSV")
        frame["month"] = frame.month.astype(int).astype(str)
        limit = int(os.environ.get("KUMO_CONTEXT_ROWS", "4096"))
        if limit < 0 or limit == 1:
            raise ValueError("KUMO_CONTEXT_ROWS must be 0 (all rows) or at least 2")
        if limit and limit < len(frame):
            frame = frame.sample(n=limit, random_state=SEED)
        self.context_rows = len(frame)
        self.version = f"kumo-small-{REVISION[:12]}-q500-context{len(frame)}-seed{SEED}-data{dataset_hash[:12]}-v1"

        # pretrained=False bypasses the library's automatic Hub resolver entirely.
        self.model = sdm.models.KumoTabular(task="regression", size="small", pretrained=False, device=self.device)
        self.model.models[sdm.Task.regression].load_state_dict(
            torch.load(checkpoint, map_location=self.device, weights_only=True))
        self.model.eval()
        context = sdm.TableTensor.from_pandas(
            frame[FEATURES + [TARGET]], stypes={**STYPES, TARGET: "numerical"}, device=self.device)
        with torch.inference_mode(), self._autocast():
            # fit builds the context/KV cache once; it does not train the weights.
            self.model.fit(context.drop_columns(TARGET), context[:, TARGET],
                           num_estimators=1, estimator_batch_size=1,
                           generator=torch.Generator(device=self.device).manual_seed(SEED))

    def _autocast(self):
        return torch.amp.autocast(self.device, dtype=torch.float16, enabled=self.device == "cuda")

    def predict_days(self, features: dict) -> float:
        features = {**features, "month": str(features["month"])}
        # Avoid concurrent GPU allocations and concurrent use of mutable model cache.
        if not self._lock.acquire(blocking=False):
            raise BlockingIOError("Discharge predictor is busy")
        try:
            with torch.inference_mode(), self._autocast():
                query = sdm.TableTensor.from_pandas(pd.DataFrame([features], columns=FEATURES),
                                                  stypes=STYPES, device=self.device)
                days = self.model.predict(query)[:, "q500"].numerical.item()
            if not math.isfinite(days) or days < 0:
                raise RuntimeError("Invalid predicted length of stay")
            return days
        finally:
            self._lock.release()

    def close(self):
        self.model.clear()
