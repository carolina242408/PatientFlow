"""Regenerate the comparison and selected-model manifest without fitting models."""

import argparse
import json
from pathlib import Path

from .artifacts import select_best
from .config import DEFAULT_OUTPUT


def main():
    parser = argparse.ArgumentParser(description="Select the best of all four LOS models by cross-validation MAE.")
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT)
    arguments = parser.parse_args()
    leaderboard = select_best(arguments.output_dir.resolve())
    print(json.dumps(leaderboard, indent=2))
    if not leaderboard["all_four_complete"]:
        parser.exit(1, "All four completed runs are required before best_model.json can be created.\n")


if __name__ == "__main__":
    main()
