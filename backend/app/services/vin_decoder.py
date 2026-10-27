"""VIN decoding with pluggable providers.

* ``nhtsa``   – US DOT vPIC API (free, no key, covers all US-market VINs since 1981)
* ``offline`` – local ISO-3779 decoder: checksum, WMI → manufacturer, model-year char.

Any commercial decoder (DataOne, VinAudit, CarAPI …) can be added by implementing
``Provider.decode`` and registering it in ``PROVIDERS``. Results are cached in
``vin_cache`` so repeat scans are instant and never re-billed.
"""
from __future__ import annotations

import json
import re
import sqlite3
import urllib.request
from typing import Any, Protocol

from ..config import settings
from ..db import fetch_one

VIN_RE = re.compile(r"^[A-HJ-NPR-Z0-9]{17}$")
_TRANSLIT = {**{str(i): i for i in range(10)}, **dict(zip("ABCDEFGH", range(1, 9))),
             **dict(zip("JKLMN", range(1, 6))), "P": 7, "R": 9, **dict(zip("STUVWXYZ", range(2, 10)))}
_WEIGHTS = (8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2)
_YEAR_CODES = "ABCDEFGHJKLMNPRSTVWXY123456789"  # 30-year cycle

WMI = {
    "1FA": "Ford", "1FT": "Ford", "1FM": "Ford", "3FA": "Ford", "1G1": "Chevrolet", "1GC": "Chevrolet",
    "1GN": "Chevrolet", "3GN": "Chevrolet", "1GT": "GMC", "1GY": "Cadillac", "1C4": "Jeep", "1C6": "Ram",
    "2T1": "Toyota", "4T1": "Toyota", "5TD": "Toyota", "JTD": "Toyota", "JTM": "Toyota", "5TF": "Toyota",
    "JTH": "Lexus", "2T2": "Lexus", "1HG": "Honda", "2HG": "Honda", "5J6": "Honda", "JHM": "Honda",
    "19X": "Honda", "5FN": "Honda", "1N4": "Nissan", "JN1": "Nissan", "5N1": "Nissan", "JN8": "Nissan",
    "KNA": "Kia", "KND": "Kia", "5XY": "Kia", "KMH": "Hyundai", "5NP": "Hyundai", "KM8": "Hyundai",
    "WBA": "BMW", "5UX": "BMW", "WBS": "BMW", "WDD": "Mercedes-Benz", "W1K": "Mercedes-Benz",
    "4JG": "Mercedes-Benz", "W1N": "Mercedes-Benz", "WAU": "Audi", "WA1": "Audi", "WVW": "Volkswagen",
    "3VW": "Volkswagen", "1V2": "Volkswagen", "WP0": "Porsche", "WP1": "Porsche", "5YJ": "Tesla",
    "7SA": "Tesla", "JF1": "Subaru", "JF2": "Subaru", "4S4": "Subaru", "JM1": "Mazda", "JM3": "Mazda",
    "YV1": "Volvo", "YV4": "Volvo", "SAL": "Land Rover", "SAJ": "Jaguar", "ZFF": "Ferrari", "7FC": "Rivian",
}
COUNTRY = {"1": "United States", "4": "United States", "5": "United States", "2": "Canada", "3": "Mexico",
           "J": "Japan", "K": "South Korea", "W": "Germany", "S": "United Kingdom", "Y": "Sweden",
           "Z": "Italy", "V": "France", "L": "China", "7": "United States"}


class VinError(ValueError):
    pass


def normalise(vin: str) -> str:
    vin = vin.strip().upper().replace(" ", "")
    if not VIN_RE.match(vin):
        raise VinError("VIN must be 17 characters (letters I, O and Q are not allowed).")
    return vin


def check_digit_valid(vin: str) -> bool:
    total = sum(_TRANSLIT[c] * w for c, w in zip(vin, _WEIGHTS))
    expected = "X" if total % 11 == 10 else str(total % 11)
    return vin[8] == expected


def model_year(vin: str) -> int | None:
    code = vin[9]
    if code not in _YEAR_CODES:
        return None
    idx = _YEAR_CODES.index(code)
    # Position 7 numeric => 1980-2009 cycle, alpha => 2010-2039 cycle (NA convention)
    base = 2010 if vin[6].isalpha() else 1980
    return base + idx


class Provider(Protocol):
    name: str

    def decode(self, vin: str) -> dict[str, Any]: ...


class OfflineProvider:
    name = "offline"

    def decode(self, vin: str) -> dict[str, Any]:
        return {
            "make": WMI.get(vin[:3]) or WMI.get(vin[:2] + "X"),
            "model": None,
            "year": model_year(vin),
            "manufacturer_country": COUNTRY.get(vin[0]),
            "plant_code": vin[10],
            "serial": vin[11:],
        }


class NHTSAProvider:
    name = "nhtsa"
    URL = "https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/{vin}?format=json"

    def decode(self, vin: str) -> dict[str, Any]:
        with urllib.request.urlopen(self.URL.format(vin=vin), timeout=5) as resp:  # noqa: S310
            r = json.loads(resp.read())["Results"][0]

        def g(key: str) -> str | None:
            v = (r.get(key) or "").strip()
            return v or None

        def num(key: str) -> float | None:
            try:
                return float(g(key)) if g(key) else None
            except ValueError:
                return None

        displacement = num("DisplacementL")
        cyl = g("EngineCylinders")
        engine = " ".join(x for x in [f"{displacement:.1f}L" if displacement else None,
                                      f"{cyl}-cyl" if cyl else None, g("EngineConfiguration")] if x) or None
        options = [k for k, label in {
            "AdaptiveCruiseControl": "Adaptive Cruise Control", "BlindSpotMon": "Blind Spot Monitoring",
            "LaneKeepSystem": "Lane Keep Assist", "ForwardCollisionWarning": "Forward Collision Warning",
            "ParkAssist": "Park Assist", "RearVisibilitySystem": "Backup Camera", "KeylessIgnition": "Keyless Ignition",
            "AdaptiveHeadlights": "Adaptive Headlights", "DaytimeRunningLight": "LED Daytime Running Lights",
        }.items() if (g(k) or "").lower() in {"standard", "optional"}]
        return {
            "make": (g("Make") or "").title() or None,
            "model": g("Model"),
            "year": int(num("ModelYear")) if num("ModelYear") else model_year(vin),
            "trim": g("Trim") or g("Series"),
            "body_class": g("BodyClass"),
            "engine": engine,
            "horsepower": int(num("EngineHP")) if num("EngineHP") else None,
            "fuel_type": g("FuelTypePrimary"),
            "transmission": g("TransmissionStyle"),
            "drive_type": g("DriveType"),
            "doors": int(num("Doors")) if num("Doors") else None,
            "seats": int(num("Seats")) if num("Seats") else None,
            "manufacturer": g("Manufacturer"),
            "manufacturer_country": g("PlantCountry") or COUNTRY.get(vin[0]),
            "factory_options": [label for label in options],
            "error_text": g("ErrorText"),
        }


PROVIDERS: dict[str, Provider] = {"nhtsa": NHTSAProvider(), "offline": OfflineProvider()}

# Map raw provider vocab → our controlled vocab
_BODY = [("pickup", "pickup"), ("sport utility", "suv"), ("crossover", "suv"), ("coupe", "coupe"),
         ("convertible", "convertible"), ("hatchback", "hatchback"), ("wagon", "wagon"), ("van", "van"),
         ("sedan", "sedan")]
_FUEL = [("plug-in", "plugin_hybrid"), ("electric", "electric"), ("hybrid", "hybrid"), ("diesel", "diesel"),
         ("gasoline", "gasoline"), ("flexible", "gasoline")]
_DRIVE = [("4x4", "4wd"), ("4wd", "4wd"), ("awd", "awd"), ("all", "awd"), ("rwd", "rwd"), ("rear", "rwd"),
          ("fwd", "fwd"), ("front", "fwd")]


def _map(value: str | None, table: list[tuple[str, str]]) -> str | None:
    v = (value or "").lower()
    return next((out for needle, out in table if needle in v), None)


def decode_vin(conn: sqlite3.Connection, raw_vin: str) -> dict[str, Any]:
    vin = normalise(raw_vin)
    cached = fetch_one(conn, "SELECT provider, payload FROM vin_cache WHERE vin = ?", (vin,))
    if cached:
        data, provider = json.loads(cached["payload"]), cached["provider"]
    else:
        provider = settings.vin_provider
        try:
            data = PROVIDERS[provider].decode(vin)
        except Exception:
            provider, data = "offline", PROVIDERS["offline"].decode(vin)
        if data.get("make"):
            conn.execute("INSERT OR REPLACE INTO vin_cache (vin, provider, payload) VALUES (?,?,?)",
                         (vin, provider, json.dumps(data)))

    trans = (data.get("transmission") or "").lower()
    return {
        "vin": vin,
        "provider": provider,
        "check_digit_valid": check_digit_valid(vin),
        "raw": data,
        # Suggested values ready to auto-populate the inventory form
        "suggested": {
            "year": data.get("year"),
            "make": data.get("make"),
            "model": data.get("model"),
            "trim": data.get("trim"),
            "body_style": _map(data.get("body_class"), _BODY),
            "fuel_type": _map(data.get("fuel_type"), _FUEL) or ("gasoline" if data.get("fuel_type") else None),
            "drivetrain": _map(data.get("drive_type"), _DRIVE),
            "transmission": "cvt" if "cvt" in trans or "continuously" in trans
                            else "dct" if "dual" in trans
                            else "manual" if "manual" in trans
                            else "automatic" if trans else None,
            "engine": data.get("engine"),
            "horsepower": data.get("horsepower"),
            "doors": data.get("doors"),
            "seats": data.get("seats"),
            "features": data.get("factory_options") or [],
        },
    }
