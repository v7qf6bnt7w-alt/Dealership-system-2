"""Centralised runtime configuration (12-factor: everything overridable via env)."""
from __future__ import annotations

import os
import secrets
from dataclasses import dataclass, field
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent

try:  # optional .env support
    from dotenv import load_dotenv

    load_dotenv(BASE_DIR / ".env")
except Exception:  # pragma: no cover
    pass


def _bool(name: str, default: bool = False) -> bool:
    return os.getenv(name, str(default)).lower() in {"1", "true", "yes", "on"}


@dataclass(frozen=True)
class Settings:
    app_name: str = "Meridian DMS"
    env: str = os.getenv("APP_ENV", "development")

    # --- Persistence --------------------------------------------------------
    database_path: Path = Path(os.getenv("DATABASE_PATH", BASE_DIR / "data" / "dms.sqlite3"))
    media_dir: Path = Path(os.getenv("MEDIA_DIR", BASE_DIR / "media"))

    # --- Security -----------------------------------------------------------
    # The JWT secret is shared with the Node realtime service so it can verify sockets.
    jwt_secret: str = os.getenv("JWT_SECRET", "dev-only-change-me-" + "x" * 32)
    jwt_algorithm: str = "HS256"
    access_token_minutes: int = int(os.getenv("ACCESS_TOKEN_MINUTES", "720"))
    internal_api_key: str = os.getenv("INTERNAL_API_KEY", "dev-internal-key")
    force_https: bool = _bool("FORCE_HTTPS", False)
    cors_origins: list[str] = field(
        default_factory=lambda: os.getenv(
            "CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173"
        ).split(",")
    )

    # --- Realtime / Node performance service -------------------------------
    realtime_url: str = os.getenv("REALTIME_URL", "http://127.0.0.1:4000")

    # --- Integrations -------------------------------------------------------
    vin_provider: str = os.getenv("VIN_PROVIDER", "nhtsa")  # nhtsa | offline
    vin_provider_api_key: str = os.getenv("VIN_PROVIDER_API_KEY", "")
    smtp_host: str = os.getenv("SMTP_HOST", "")
    smtp_port: int = int(os.getenv("SMTP_PORT", "587"))
    smtp_user: str = os.getenv("SMTP_USER", "")
    smtp_password: str = os.getenv("SMTP_PASSWORD", "")
    smtp_from: str = os.getenv("SMTP_FROM", "Meridian Motors <hello@meridianmotors.example>")

    # --- Dealership profile -------------------------------------------------
    dealer_name: str = os.getenv("DEALER_NAME", "Meridian Motors")
    dealer_address: str = os.getenv("DEALER_ADDRESS", "2400 S Lamar Blvd, Austin, TX 78704")
    dealer_phone: str = os.getenv("DEALER_PHONE", "+1 (512) 555-0142")
    dealer_lat: float = float(os.getenv("DEALER_LAT", "30.2465"))
    dealer_lng: float = float(os.getenv("DEALER_LNG", "-97.7810"))
    default_tax_rate: float = float(os.getenv("DEFAULT_TAX_RATE", "0.0825"))
    currency: str = os.getenv("CURRENCY", "USD")


settings = Settings()

if settings.env == "production" and settings.jwt_secret.startswith("dev-only"):
    raise RuntimeError("JWT_SECRET must be set in production. Try: " + secrets.token_urlsafe(48))
