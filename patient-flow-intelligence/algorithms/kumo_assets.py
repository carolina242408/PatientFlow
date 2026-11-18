"""Public model artifacts only; this module never reads patient data."""

import argparse
from hashlib import file_digest
from pathlib import Path
import shutil

REVISION = "3c3e10bbdb590ace29e7026847f92db3c603096d"  # upstream v1.0.1
CHECKPOINT_SHA256 = "fc672f536501d64356036050ac2acea7e46927f7b9ad38366abe048f88e7d423"
DEFAULT_MODEL_DIR = Path(__file__).resolve().parent / "models" / "kumo-small"


def verify_checkpoint(path: Path) -> None:
    with path.open("rb") as checkpoint:
        if file_digest(checkpoint, "sha256").hexdigest() != CHECKPOINT_SHA256:
            raise ValueError("Kumo Small checkpoint checksum mismatch")


def download(destination: Path) -> None:
    import os

    os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"
    os.environ["HF_HUB_DISABLE_IMPLICIT_TOKEN"] = "1"
    os.environ["DO_NOT_TRACK"] = "1"
    from huggingface_hub import hf_hub_download

    destination.mkdir(parents=True, exist_ok=True)
    for name in ("small/regressor.pt", "LICENSE", "config.json"):
        source = hf_hub_download("nvidia/Kumo-Tabular", name, revision=REVISION, token=False)
        shutil.copyfile(source, destination / Path(name).name)
    verify_checkpoint(destination / "regressor.pt")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=DEFAULT_MODEL_DIR)
    download(parser.parse_args().output)
