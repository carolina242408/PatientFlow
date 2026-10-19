import argparse
import importlib.util
import json
import sys
from pathlib import Path
from typing import Any


TEST_DIR = Path(__file__).resolve().parent
CONVERTER_DIR = TEST_DIR.parent


def load_converter():
    path = CONVERTER_DIR / "main.py"
    spec = importlib.util.spec_from_file_location("converter_main", path)
    if spec is None or spec.loader is None:
        raise ImportError(f"Could not load {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def get_path(value: Any, path: str) -> Any:
    for part in path.split("."):
        if isinstance(value, list):
            value = value[int(part)]
        elif isinstance(value, dict):
            value = value[part]
        else:
            raise KeyError(path)
    return value


def resources_by_type(bundle: dict[str, Any], resource_type: str) -> list[dict[str, Any]]:
    return [
        entry["resource"]
        for entry in bundle.get("entry", [])
        if entry.get("resource", {}).get("resourceType") == resource_type
    ]


IGNORED_REFERENCE_FIELDS = {"id", "meta", "fullUrl", "reference", "timestamp"}


def stable_leaf_values(value: Any, path: str = "") -> dict[str, Any]:
    if isinstance(value, dict):
        result: dict[str, Any] = {}
        for key, child in value.items():
            if key in IGNORED_REFERENCE_FIELDS or key == "resourceType":
                continue
            child_path = f"{path}.{key}" if path else key
            result.update(stable_leaf_values(child, child_path))
        return result
    if isinstance(value, list):
        result = {}
        for index, child in enumerate(value):
            result.update(stable_leaf_values(child, f"{path}.{index}"))
        return result
    return {path: value}


def contract_from_bundle(reference: dict[str, Any]) -> dict[str, Any]:
    resources: dict[str, dict[str, Any]] = {}
    for entry in reference.get("entry", []):
        resource = entry.get("resource", {})
        resource_type = resource.get("resourceType")
        if not resource_type:
            continue
        expectation = resources.setdefault(resource_type, {"count": 0, "required": {}})
        expectation["count"] += 1
        leaves = stable_leaf_values(resource)
        for path, value in leaves.items():
            if path not in expectation["required"]:
                expectation["required"][path] = value
    return {"bundle": {"type": reference.get("type")}, "resources": resources}


def scenario_files(scenario: str | None) -> tuple[Path, Path]:
    if not scenario:
        candidates = [
            (TEST_DIR / "reference_message.hl7", TEST_DIR / "reference_contract.json"),
            (TEST_DIR / "compare_1" / "reference_message.hl7", TEST_DIR / "compare_1" / "reference_contract.json"),
        ]
        for message_path, contract_path in candidates:
            if message_path.exists() and contract_path.exists():
                return message_path, contract_path
        raise FileNotFoundError("No default reference scenario files were found")

    scenario_dir = Path(scenario)
    if not scenario_dir.is_absolute():
        scenario_dir = TEST_DIR / scenario_dir
    scenario_dir = scenario_dir.resolve()
    if not scenario_dir.is_dir():
        raise FileNotFoundError(f"Scenario folder not found: {scenario_dir}")

    scenario_name = scenario_dir.name
    message_path = scenario_dir / f"{scenario_name}.hl7"
    contract_path = scenario_dir / f"{scenario_name}_contract.json"
    if not message_path.exists():
        message_path = scenario_dir / "reference_message.hl7"
    if not contract_path.exists():
        contract_path = scenario_dir / "reference_contract.json"
    if not message_path.exists():
        raise FileNotFoundError(f"Scenario message not found: {message_path}")
    if not contract_path.exists():
        raise FileNotFoundError(f"Scenario contract not found: {contract_path}")
    return message_path, contract_path


def compare(bundle: dict[str, Any], contract: dict[str, Any]) -> tuple[list[str], list[str], list[str]]:
    matches: list[str] = []
    missing: list[str] = []
    different: list[str] = []

    expected_bundle_type = contract["bundle"]["type"]
    if bundle.get("type") == expected_bundle_type:
        matches.append(f"Bundle.type = {expected_bundle_type}")
    else:
        different.append(f"Bundle.type: expected {expected_bundle_type!r}, got {bundle.get('type')!r}")

    for resource_type, expectation in contract["resources"].items():
        resources = resources_by_type(bundle, resource_type)
        expected_count = expectation["count"]
        if len(resources) == expected_count:
            matches.append(f"{resource_type} count = {expected_count}")
        else:
            missing.append(f"{resource_type} count: expected {expected_count}, got {len(resources)}")

        for path, expected in expectation.get("required", {}).items():
            try:
                actual = get_path(resources if path[:1].isdigit() else resources[0], path)
            except (IndexError, KeyError, TypeError, ValueError):
                missing.append(f"{resource_type}.{path}: missing")
                continue
            if actual == expected:
                matches.append(f"{resource_type}.{path}")
            else:
                different.append(f"{resource_type}.{path}: expected {expected!r}, got {actual!r}")

    return matches, missing, different


def main() -> int:
    parser = argparse.ArgumentParser(description="Compare one HL7 scenario with its FHIR contract")
    parser.add_argument(
        "scenario",
        nargs="?",
        help="Scenario folder; expects <folder-name>.hl7 and <folder-name>_contract.json",
    )
    args = parser.parse_args()

    converter = load_converter()
    message_path, contract_path = scenario_files(args.scenario)
    message = message_path.read_text(encoding="utf-8")
    contract = json.loads(contract_path.read_text(encoding="utf-8"))
    if "bundle" not in contract and contract.get("resourceType") == "Bundle":
        contract = contract_from_bundle(contract)
    bundle = converter.convert_hl7_to_fhir(message).model_dump(
        by_alias=True, exclude_none=True, mode="json"
    )
    matches, missing, different = compare(bundle, contract)

    print(f"FHIR comparison: {len(matches)} matching checks")
    print(f"FHIR comparison: {len(missing)} missing sections")
    print(f"FHIR comparison: {len(different)} different sections")
    for title, values in (("MISSING", missing), ("DIFFERENT", different)):
        if values:
            print(f"\n{title}:")
            for value in values:
                print(f"- {value}")

    if not missing and not different:
        print("\nPASS: converter matches the reference contract")
        return 0
    print("\nFAIL: converter does not yet match the reference contract")
    return 1


if __name__ == "__main__":
    sys.exit(main())
