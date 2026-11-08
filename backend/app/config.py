"""Runtime configuration for the S.A.T.U.R.N. backend.

All secrets are read from the environment (or a local .env file) and never
returned to the browser. See ../.env.example for the full list.
"""

from __future__ import annotations

from functools import lru_cache
from typing import List

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(".env", "../.env"),
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    # --- runtime ---
    saturn_env: str = "development"
    backend_host: str = "127.0.0.1"
    backend_port: int = 8787
    log_level: str = "INFO"
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"

    # --- Vertex AI ---
    google_cloud_project: str = ""
    google_cloud_location: str = "us-central1"
    vertex_model: str = "gemini-2.5-flash"
    saturn_force_mock_llm: bool = False

    # --- auth / storage (Phase 8) ---
    # '' = auto (firebase when a project is set, else safe public demo).
    saturn_auth: str = ""
    firebase_enabled: bool = True
    firebase_project_id: str = ""
    # Firestore collection prefix so demo and real data never mix.
    firestore_prefix: str = "saturn"

    # --- rate limiting ---
    rate_limit_per_minute: int = 30
    rate_limit_burst: int = 10

    # --- providers ---
    nominatim_user_agent: str = "saturn-geoai/0.1 (+https://github.com/saturn-geoai)"
    nominatim_base_url: str = "https://nominatim.openstreetmap.org"
    nominatim_min_interval_s: float = 1.0
    firms_map_key: str = ""

    # --- agent limits ---
    agent_max_tool_calls: int = Field(default=8)
    agent_tool_timeout_s: float = 25.0
    agent_overall_timeout_s: float = 120.0

    @field_validator("cors_origins")
    @classmethod
    def _strip(cls, v: str) -> str:
        return v.strip()

    @property
    def cors_origin_list(self) -> List[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def agent_mode(self) -> str:
        """'vertex' when a project is configured and mock is not forced."""
        if self.saturn_force_mock_llm or not self.google_cloud_project:
            return "mock"
        return "vertex"


@lru_cache
def get_settings() -> Settings:
    return Settings()
