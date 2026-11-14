from __future__ import annotations

import json
from pathlib import Path
from uuid import UUID

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    database_url: str = "postgresql+asyncpg://patientflow:patientflow@localhost:5432/patientflow"
    use_excel: bool = False
    config_json_path: str | None = None
    solver_time_limit_seconds: float = 10
    imminent_discharge_hours: int = 24
    weights: dict[str, int] = Field(
        default_factory=lambda: {
            "W_PRIORITY": 100,
            "W_SAME_ULS": 10,
            "W_SAME_UNIT": 5,
            "W_SAME_FLOOR": 2,
            "W_SERVICE_MATCH": 50,
            "W_IMMINENT_DISCHARGE": 30,
            "W_AGE_COHORT": 25,
        }
    )
    room_sex_rules: dict[UUID, str] = Field(default_factory=dict)
    bed_isolation: dict[UUID, bool] = Field(default_factory=dict)
    priority_by_encounter: dict[UUID, int] = Field(default_factory=dict)

    model_config = SettingsConfigDict(env_file=".env", env_prefix="", extra="ignore")

    def model_post_init(self, __context: object, /) -> None:
        if not self.config_json_path:
            return
        path = Path(self.config_json_path)
        if not path.exists():
            raise ValueError(f"CONFIG_JSON_PATH does not exist: {path}")
        values = json.loads(path.read_text())
        for field in ("weights", "room_sex_rules", "bed_isolation", "priority_by_encounter"):
            if field in values:
                parsed = values[field]
                if field != "weights":
                    parsed = {UUID(key): value for key, value in parsed.items()}
                setattr(self, field, parsed)


settings = Settings()
