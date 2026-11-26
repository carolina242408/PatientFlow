"""Local Kumo Small regression with a single cached in-context estimator."""

import os

# Set before importing libraries that can contact Hugging Face. Never allow a
# missing local artifact to trigger a download in the serving process.
for name in ("HF_HUB_OFFLINE", "HF_HUB_DISABLE_TELEMETRY", "HF_HUB_DISABLE_IMPLICIT_TOKEN",
             "TRANSFORMERS_OFFLINE", "DO_NOT_TRACK"):
    os.environ[name] = "1"
os.environ["WANDB_MODE"] = "disabled"

import ctypes
from hashlib import file_digest
import logging
import math
from pathlib import Path
from threading import Lock

import pandas as pd
import sdm
# Same estimator sdm.models.kumo.tabular.batching uses for its public batch-size
# helpers; structured-data-models is pinned in requirements.txt.
from sdm.models.kumo.tabular.batching import _row_bytes
import torch

from kumo_assets import DEFAULT_MODEL_DIR, REVISION, verify_checkpoint

FEATURES = ["gender", "specialty", "diagnosis_code", "age", "month",
            "admission_weekday", "time_period", "season"]
TARGET = "los_days"
STYPES = {name: "numerical" if name == "age" else "categorical" for name in FEATURES}
SEED = 8228
# Default context cap on CPU, where startup time grows faster than linearly with
# rows; CUDA has no default cap. KUMO_CONTEXT_ROWS overrides both.
CPU_CONTEXT_ROWS = 100_000
# Fraction of context rows kept after a startup attempt that runs out of memory.
OOM_SHRINK = 0.75
# Share of the VRAM free at startup that PyTorch may allocate. The rest is
# headroom for allocations outside PyTorch, such as other processes.
CUDA_FREE_FRACTION = 0.9

log = logging.getLogger(__name__)


def select_device() -> str:
    requested = os.environ.get("KUMO_DEVICE") or "auto"
    if requested not in ("auto", "cpu", "cuda"):
        raise ValueError("KUMO_DEVICE must be auto, cpu or cuda")
    if requested == "cuda" and not torch.cuda.is_available():
        raise RuntimeError("KUMO_DEVICE=cuda but CUDA is unavailable")
    if requested != "auto":
        return requested
    if torch.cuda.is_available():
        return "cuda"
    log.warning("CUDA is unavailable; discharge model falls back to CPU")
    return "cpu"


def memory_budget(device: str) -> int | None:
    """Bytes to size the context for: KUMO_MEMORY_BUDGET_MB when set, else free
    RAM on CPU. None on CUDA, which starts with every row and relies on the
    out-of-memory retry, since a failed CUDA allocation is recoverable."""
    override = os.environ.get("KUMO_MEMORY_BUDGET_MB")
    if override:
        megabytes = int(override)
        if megabytes < 1:
            raise ValueError("KUMO_MEMORY_BUDGET_MB must be a positive integer")
        return megabytes * 2**20
    if device == "cuda":
        return None
    # Exhausting RAM can kill the process instead of raising, so CPU is sized
    # up front.
    if os.name == "nt":
        return _windows_available_ram()
    if Path("/proc/meminfo").is_file():
        return _linux_available_ram()
    raise RuntimeError("Cannot determine available RAM; set KUMO_MEMORY_BUDGET_MB")


def _windows_available_ram() -> int:
    class MemoryStatus(ctypes.Structure):
        _fields_ = [("dwLength", ctypes.c_ulong), ("dwMemoryLoad", ctypes.c_ulong),
                    ("ullTotalPhys", ctypes.c_ulonglong), ("ullAvailPhys", ctypes.c_ulonglong),
                    ("ullTotalPageFile", ctypes.c_ulonglong), ("ullAvailPageFile", ctypes.c_ulonglong),
                    ("ullTotalVirtual", ctypes.c_ulonglong), ("ullAvailVirtual", ctypes.c_ulonglong),
                    ("ullAvailExtendedVirtual", ctypes.c_ulonglong)]

    status = MemoryStatus(dwLength=ctypes.sizeof(MemoryStatus))
    if not ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(status)):
        raise ctypes.WinError()
    return status.ullAvailPhys


def _linux_available_ram() -> int:
    available = None
    with open("/proc/meminfo", encoding="ascii") as meminfo:
        for line in meminfo:
            if line.startswith("MemAvailable:"):
                available = int(line.split()[1]) * 1024
    if available is None:
        raise RuntimeError("Cannot determine available RAM; set KUMO_MEMORY_BUDGET_MB")
    # /proc/meminfo reports the host; a container memory limit is in its cgroup.
    for limit_file, usage_file in (("/sys/fs/cgroup/memory.max", "/sys/fs/cgroup/memory.current"),
                                   ("/sys/fs/cgroup/memory/memory.limit_in_bytes",
                                    "/sys/fs/cgroup/memory/memory.usage_in_bytes")):
        try:
            limit = Path(limit_file).read_text(encoding="ascii").strip()
            usage = int(Path(usage_file).read_text(encoding="ascii"))
        except OSError:
            continue
        if limit != "max":
            available = min(available, max(0, int(limit) - usage))
        break
    return available


class DischargeModel:
    def __init__(self):
        self._lock = Lock()
        self.device = select_device()
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
        limit = int(os.environ.get("KUMO_CONTEXT_ROWS") or (0 if self.device == "cuda" else CPU_CONTEXT_ROWS))
        if limit < 0 or limit == 1:
            raise ValueError("KUMO_CONTEXT_ROWS must be 0 (all rows) or at least 2")
        requested_rows = min(limit, len(frame)) if limit else len(frame)

        if self.device == "cuda":
            # Windows drivers can spill VRAM allocations into system RAM instead
            # of failing, which makes the fit crawl and the out-of-memory retry
            # never fire. Capping PyTorch to the VRAM free now makes exhaustion
            # raise OutOfMemoryError on every driver.
            free, total = torch.cuda.mem_get_info()
            torch.cuda.set_per_process_memory_fraction(free * CUDA_FREE_FRACTION / total)

        # pretrained=False bypasses the library's automatic Hub resolver entirely.
        self.model = sdm.models.KumoTabular(task="regression", size="small", pretrained=False, device=self.device)
        self.model.models[sdm.Task.regression].load_state_dict(
            torch.load(checkpoint, map_location=self.device, weights_only=True))
        self.model.eval()

        rows = requested_rows
        # Free memory is measured after the weights are on the device, as the
        # estimator expects. Like sdm's helpers, only half of it is planned for.
        budget = memory_budget(self.device)
        if budget is not None:
            dtype = torch.float16 if self.device == "cuda" else torch.float32
            workspace, cache, member = _row_bytes(self.model, num_columns=len(FEATURES), num_classes=0, dtype=dtype)
            rows = min(rows, max(0, (budget // 2 - member) // (workspace + cache)))
            if rows < 2:
                raise RuntimeError("Insufficient memory for the discharge context")
            if rows < requested_rows:
                log.warning("Discharge context reduced from %d to %d rows to fit a %d MiB budget on %s",
                            requested_rows, rows, budget // 2**20, self.device)
        while True:
            context = frame if rows == len(frame) else frame.sample(n=rows, random_state=SEED)
            try:
                self._fit(context)
                # A warm-up prediction proves memory is left for serving, so a
                # context that only just fits is reduced now rather than
                # failing on live requests. It also absorbs first-call latency.
                self._predict(context.head(1))
                break
            except (torch.OutOfMemoryError, MemoryError):
                if int(rows * OOM_SHRINK) < 2:
                    raise
            # Outside the except block so the failed attempt's tensors are released.
            self.model.clear()
            if self.device == "cuda":
                torch.cuda.empty_cache()
            log.warning("Discharge context of %d rows ran out of memory on %s; retrying with %d",
                        rows, self.device, int(rows * OOM_SHRINK))
            rows = int(rows * OOM_SHRINK)
        self.context_rows = rows
        self.version = f"kumo-small-{REVISION[:12]}-q500-context{rows}-seed{SEED}-data{dataset_hash[:12]}-v1"

    def _fit(self, frame: pd.DataFrame) -> None:
        context = sdm.TableTensor.from_pandas(
            frame[FEATURES + [TARGET]], stypes={**STYPES, TARGET: "numerical"}, device=self.device)
        with torch.inference_mode(), self._autocast():
            # fit builds the context/KV cache once; it does not train the weights.
            self.model.fit(context.drop_columns(TARGET), context[:, TARGET],
                           num_estimators=1, estimator_batch_size=1,
                           generator=torch.Generator(device=self.device).manual_seed(SEED))

    def _predict(self, features: pd.DataFrame) -> float:
        with torch.inference_mode(), self._autocast():
            query = sdm.TableTensor.from_pandas(features[FEATURES], stypes=STYPES, device=self.device)
            return self.model.predict(query)[:, "q500"].numerical.item()

    def _autocast(self):
        return torch.amp.autocast(self.device, dtype=torch.float16, enabled=self.device == "cuda")

    def predict_days(self, features: dict) -> float:
        features = {**features, "month": str(features["month"])}
        # Avoid concurrent GPU allocations and concurrent use of mutable model cache.
        if not self._lock.acquire(blocking=False):
            raise BlockingIOError("Discharge predictor is busy")
        try:
            days = self._predict(pd.DataFrame([features], columns=FEATURES))
            if not math.isfinite(days) or days < 0:
                raise RuntimeError("Invalid predicted length of stay")
            return days
        finally:
            self._lock.release()

    def close(self):
        self.model.clear()
