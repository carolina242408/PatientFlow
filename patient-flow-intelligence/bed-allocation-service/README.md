# Bed Allocation Service

Standalone Python 3.11+ FastAPI service that reads hospital hierarchy, encounters,
patients, beds, and open allocations, then stores human-reviewable CP-SAT suggestions.
It never writes to `beds` or `location_allocations`.

## Run without PostgreSQL (Excel)

Create `data/beds.xlsx` and `data/patients.xlsx` using the columns represented by
`BedFlat` and `PatientWaiting`, then:

```bash
python -m venv .venv && . .venv/bin/activate
pip install -e '.[dev]'
USE_EXCEL=true uvicorn bed_allocation.main:app --app-dir src --reload
```

Excel mode validates the solver and does not persist suggestions.

## Run with PostgreSQL

```bash
cp .env.example .env
pip install -e '.[dev]'
alembic upgrade head
uvicorn bed_allocation.main:app --app-dir src
```

The migration creates the only table owned by this service: `sugestoes_alocacao`.
The existing hospital tables are read-only mirrors. The API is available at
`/api/v1/health`, `/api/v1/sugerir-alocacao`, and `/api/v1/sugestoes`.

## PatientFlow integration

The root Docker Compose stack starts this service as `bed-allocation-service` on
port 8001 and connects it to the same PostgreSQL database as the Spring Boot
backend. The frontend exposes it through the same-origin `/allocation-api`
proxy, avoiding browser CORS issues. Open **Bed allocation** in the frontend to
generate suggestions and accept or reject them; accepting a suggestion only
updates `sugestoes_alocacao` and never assigns a bed directly.

For local frontend development, run the service on port 8001 and use the Vite
proxy configured in `frontend/vite.config.ts`.

### Seed synthetic patients

With the Docker stack running, seed three waiting patients and three available
beds for local testing:

```bash
docker compose exec -T postgresql psql -U pfi -d patientflow \
  < bed-allocation-service/scripts/seed_demo.sql
```

The script is repeatable and uses clearly synthetic `DEMO-*` identifiers. It
does not create bed assignments. Refresh `/bed-allocation`, select the patients,
and generate suggestions.

## Known data gaps

The hospital schema has no priority, room-sex restriction, or bed-isolation columns.
`PRIORITY_BY_ENCOUNTER`, `ROOM_SEX_RULES`, and `BED_ISOLATION` are therefore explicit
configuration placeholders, optionally loaded from `CONFIG_JSON_PATH`. Priority
defaults to 1; the other maps default to empty.
