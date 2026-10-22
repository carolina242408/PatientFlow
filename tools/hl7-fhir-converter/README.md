# HL7 v2 to FHIR R4 Converter

This tool parses HL7 v2 ADT messages and creates a FHIR R4 `Bundle` serialized as JSON.

## Requirements

Use the project virtual environment, which must have the dependencies from the repository installed:

```powershell
.\venv\Scripts\Activate.ps1
```

The converter uses Python 3.10+ and Pydantic v2.

## Structure

```text
hl7-fhir-converter/
|-- main.py                         CLI and conversion pipeline
|-- models/
|   |-- hl7-segments.py             HL7 segment models and parsers
|   |-- fhir-resources.py           FHIR R4 models
|-- messages/                       HL7 input fixtures
|   |-- admission.hl7
|   |-- bed-movement.hl7
|   |-- service-movement.hl7
|   |-- discharge.hl7
|-- tests/
|   |-- compare_reference.py        Contract comparison test
|   |-- compare_1/                  Example test scenario
```

## Running the Converter

From the repository root:

```powershell
python tools\hl7-fhir-converter\main.py messages\admission.hl7
```

From this directory:

```powershell
python main.py messages\admission.hl7
```

The converter also resolves relative message paths against the `hl7-fhir-converter` directory. Therefore, `messages\admission.hl7` works whether the command is run from the repository root or from this directory.

By default, the generated FHIR JSON is printed to the terminal. To write it to a file:

```powershell
.\venv\Scripts\python.exe tools\hl7-fhir-converter\main.py `
  messages\admission.hl7 `
  --output admission.json
```

The output is a FHIR `Bundle` with `type: collection`.

## Conversion Mapping

| HL7 v2 segment | FHIR R4 output |
|---|---|
| `MSH`, `EVN` | `MessageHeader` |
| `PID` | `Patient` |
| `PV1`, `PV2` | `Encounter`, `Location` |
| `ROL` | `Practitioner` |
| `NK1`, `GT1` | `RelatedPerson` |
| `AL1` | `AllergyIntolerance` |
| `OBX` | `Observation` |
| `DG1` | `Condition` |
| `PR1` | `Procedure` |
| `IN1` | `Coverage`, `Organization` |

`IN2` and `ACC` are parsed into HL7 segment models, but they are not currently converted into dedicated FHIR resources. Unknown HL7 segments are ignored by the parser.

Composite HL7 fields are split where needed. HL7 repetitions use `~`, components use `^`, subcomponents use `&`, and common HL7 escape sequences are decoded.

## Running the Tests

The comparison test uses a reference HL7 message and a JSON contract. A contract
can either be the compact `bundle`/`resources` format below or a complete
reference FHIR Bundle. Complete reference Bundles are compared resource by
resource; additional resources emitted by the converter are allowed, while all
fields present in the reference must match.

Dynamic `id`, `fullUrl`, `meta`, and `timestamp` fields are ignored. References
to those IDs are checked relationally, so a reference such as
`Patient/<reference-id>` is matched against the ID of the corresponding actual
Patient resource.

From the repository root:

```powershell
.\venv\Scripts\python.exe tools\hl7-fhir-converter\tests\compare_reference.py
```

To select a scenario explicitly:

```powershell
.\venv\Scripts\python.exe tools\hl7-fhir-converter\tests\compare_reference.py compare_1
```

From the converter directory:

```powershell
python tests\compare_reference.py compare_1
```

The test prints:

- Matching checks
- Missing resources or fields
- Different values
- A final `PASS` or `FAIL` result

A scenario folder can be created with this naming convention:

```text
tests/
|-- admission/
|   |-- admission.hl7
|   |-- admission_contract.json
```

Run it with:

```powershell
python tests\compare_reference.py admission
```

The contract uses this structure:

```json
{
  "bundle": {
    "type": "collection"
  },
  "resources": {
    "Patient": {
      "count": 1,
      "required": {
        "birthDate": "1961-06-15"
      }
    }
  }
}
```

Paths in `required` use dot notation. List indexes are numeric, for example `name.0.family` or `telecom.1.value`.

The test exits with code `0` when the contract matches and code `1` when sections are missing or values differ.

### Results

The tests are being matched with the converstion from the online tool: 
https://majware.com/tools/hl7-to-fhir-converter

## Direct Python Usage

The conversion functions can also be imported dynamically because the model filenames contain hyphens:

```python
from main import convert_hl7_to_fhir

bundle = convert_hl7_to_fhir(message)
json_data = bundle.model_dump(by_alias=True, exclude_none=True, mode="json")
```

The normal recommended entry point is still the CLI in `main.py`.
