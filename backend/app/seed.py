"""Demo data generator for Meridian DMS.

Usage:  python -m app.seed            # seeds only if the database is empty
        python -m app.seed --reset    # wipes the database and media, then seeds

Demo accounts (password for all staff: ``meridian123``; customer: ``customer123``):
    admin@meridian.demo   – Admin
    sarah@meridian.demo   – Sales
    marcus@meridian.demo  – Sales
    priya@meridian.demo   – Sales
    diego@meridian.demo   – Service advisor
    customer@meridian.demo – Portal customer (Emma Clarke)
"""
from __future__ import annotations

import json
import random
import shutil
import string
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

from .config import BASE_DIR, settings
from .db import closing_conn, init_db, insert
from .security import hash_password
from .services import pricing
from .services.vin_decoder import _TRANSLIT, _WEIGHTS, _YEAR_CODES

rng = random.Random(42)
NOW = datetime.now(timezone.utc).replace(microsecond=0)
ASSETS = BASE_DIR / "seed_assets"


def iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def ago(days: float = 0, hours: float = 0) -> datetime:
    return NOW - timedelta(days=days, hours=hours)


def business_slot(day_offset: int, hour: int | None = None) -> datetime:
    """A local-time-ish business hour slot (stored in UTC; CST ≈ UTC-5/6)."""
    d = (NOW + timedelta(days=day_offset)).replace(minute=0, second=0)
    h = hour if hour is not None else rng.choice([9, 10, 11, 13, 14, 15, 16, 17])
    return d.replace(hour=(h + 5) % 24, minute=rng.choice([0, 30]))


# ---------------------------------------------------------------------------
# Catalog
# ---------------------------------------------------------------------------
# (make, model, trims, body, fuel, transmission, drivetrain, engine, hp, base_msrp_usd, wmi, doors, seats)
CATALOG = [
    ("Toyota", "Camry", ["LE", "SE", "XSE"], "sedan", "hybrid", "cvt", "fwd", "2.5L 4-cyl Hybrid", 225, 29500, "4T1", 4, 5),
    ("Toyota", "RAV4", ["LE", "XLE", "Limited"], "suv", "hybrid", "cvt", "awd", "2.5L 4-cyl Hybrid", 219, 33500, "2T3", 4, 5),
    ("Toyota", "Tacoma", ["SR5", "TRD Off-Road"], "pickup", "gasoline", "automatic", "4wd", "2.4L Turbo 4-cyl", 278, 38900, "3TM", 4, 5),
    ("Honda", "Civic", ["Sport", "EX", "Touring"], "hatchback", "gasoline", "cvt", "fwd", "2.0L 4-cyl", 158, 26500, "19X", 4, 5),
    ("Honda", "CR-V", ["EX", "EX-L", "Sport Touring"], "suv", "hybrid", "cvt", "awd", "2.0L 4-cyl Hybrid", 204, 34800, "5J6", 4, 5),
    ("Honda", "Odyssey", ["EX-L", "Touring", "Elite"], "van", "gasoline", "automatic", "fwd", "3.5L V6", 280, 41500, "5FN", 4, 8),
    ("Ford", "F-150", ["XLT", "Lariat", "Platinum"], "pickup", "gasoline", "automatic", "4wd", "3.5L EcoBoost V6", 400, 52900, "1FT", 4, 6),
    ("Ford", "Mustang", ["EcoBoost", "GT"], "coupe", "gasoline", "manual", "rwd", "5.0L V8", 480, 39500, "1FA", 2, 4),
    ("Ford", "Mustang Mach-E", ["Select", "Premium", "GT"], "suv", "electric", "automatic", "awd", "Dual Motor", 346, 46900, "3FM", 4, 5),
    ("Chevrolet", "Silverado 1500", ["LT", "RST", "High Country"], "pickup", "gasoline", "automatic", "4wd", "5.3L V8", 355, 49800, "1GC", 4, 6),
    ("Chevrolet", "Equinox", ["LS", "LT", "RS"], "suv", "gasoline", "automatic", "fwd", "1.5L Turbo 4-cyl", 175, 28900, "3GN", 4, 5),
    ("Tesla", "Model 3", ["Long Range", "Performance"], "sedan", "electric", "automatic", "awd", "Dual Motor", 425, 45900, "5YJ", 4, 5),
    ("Tesla", "Model Y", ["Long Range", "Performance"], "suv", "electric", "automatic", "awd", "Dual Motor", 384, 49900, "7SA", 4, 5),
    ("BMW", "3 Series", ["330i", "M340i"], "sedan", "gasoline", "automatic", "rwd", "2.0L Turbo 4-cyl", 255, 46900, "WBA", 4, 5),
    ("BMW", "X5", ["xDrive40i", "M60i"], "suv", "gasoline", "automatic", "awd", "3.0L Turbo I6", 375, 67600, "5UX", 4, 5),
    ("BMW", "Z4", ["sDrive30i", "M40i"], "convertible", "gasoline", "automatic", "rwd", "3.0L Turbo I6", 382, 54800, "WBA", 2, 2),
    ("Mercedes-Benz", "C-Class", ["C 300", "C 300 4MATIC"], "sedan", "gasoline", "automatic", "awd", "2.0L Turbo 4-cyl", 255, 48600, "W1K", 4, 5),
    ("Mercedes-Benz", "GLE", ["GLE 350", "GLE 450"], "suv", "gasoline", "automatic", "awd", "3.0L Turbo I6 Mild Hybrid", 375, 62650, "4JG", 4, 5),
    ("Audi", "Q5", ["Premium", "Premium Plus", "Prestige"], "suv", "gasoline", "dct", "awd", "2.0L Turbo 4-cyl", 261, 46900, "WA1", 4, 5),
    ("Porsche", "911", ["Carrera", "Carrera S"], "coupe", "gasoline", "dct", "rwd", "3.0L Twin-Turbo Flat-6", 443, 116000, "WP0", 2, 4),
    ("Hyundai", "Ioniq 5", ["SE", "SEL", "Limited"], "suv", "electric", "automatic", "awd", "Dual Motor", 320, 45500, "KM8", 4, 5),
    ("Kia", "Telluride", ["S", "EX", "SX"], "suv", "gasoline", "automatic", "awd", "3.8L V6", 291, 37900, "5XY", 4, 8),
    ("Mazda", "Mazda3", ["Select", "Preferred", "Turbo"], "hatchback", "gasoline", "automatic", "fwd", "2.5L 4-cyl", 191, 25900, "JM1", 4, 5),
    ("Mazda", "MX-5 Miata", ["Sport", "Club", "Grand Touring"], "convertible", "gasoline", "manual", "rwd", "2.0L 4-cyl", 181, 30500, "JM1", 2, 2),
    ("Subaru", "Outback", ["Premium", "Limited", "Touring XT"], "wagon", "gasoline", "cvt", "awd", "2.5L Flat-4", 182, 31900, "4S4", 4, 5),
    ("Volkswagen", "Golf GTI", ["S", "SE", "Autobahn"], "hatchback", "gasoline", "dct", "fwd", "2.0L Turbo 4-cyl", 241, 32500, "3VW", 4, 5),
    ("Lexus", "RX", ["RX 350", "RX 450h+"], "suv", "plugin_hybrid", "cvt", "awd", "2.5L 4-cyl Plug-in Hybrid", 304, 50900, "2T2", 4, 5),
    ("Rivian", "R1S", ["Adventure"], "suv", "electric", "automatic", "awd", "Quad Motor", 835, 78000, "7FC", 4, 7),
]
COLORS = ["Obsidian Black", "Pearl White", "Graphite Grey", "Lunar Silver", "Deep Ocean Blue", "Ruby Red",
          "Forest Green", "Sunset Orange", "Desert Sand", "Midnight Blue"]
INTERIORS = ["Black Leather", "Saddle Brown", "Ivory", "Charcoal Cloth", "Red Pepper", "Graphite"]
FEATURES = ["Apple CarPlay", "Android Auto", "Heated Seats", "Ventilated Seats", "Panoramic Sunroof",
            "Adaptive Cruise Control", "Blind Spot Monitoring", "Lane Keep Assist", "360° Camera",
            "Premium Audio", "Wireless Charging", "Head-Up Display", "Power Liftgate", "Heated Steering Wheel",
            "Remote Start", "Navigation", "Third Row Seating", "Tow Package", "LED Headlights", "Keyless Entry"]
FIRST = ["Emma", "Liam", "Olivia", "Noah", "Ava", "Ethan", "Sophia", "Mason", "Isabella", "Lucas", "Mia", "James",
         "Charlotte", "Benjamin", "Amelia", "Elijah", "Harper", "Daniel", "Evelyn", "Henry", "Abigail", "Jack",
         "Camila", "Sebastian", "Luna", "Mateo", "Grace", "Leo", "Chloe", "Owen", "Zoe", "Wyatt", "Nora", "Caleb",
         "Aria", "Julian", "Layla", "Isaac", "Riley", "Gabriel", "Hannah", "Adrian", "Valentina", "Ryan", "Stella"]
LAST = ["Clarke", "Nguyen", "Patel", "Johnson", "Garcia", "Kim", "Martinez", "Brown", "Walker", "Lopez", "Chen",
        "Robinson", "Hernandez", "Wright", "Foster", "Reyes", "Bennett", "Murphy", "Rivera", "Cooper", "Hughes",
        "Torres", "Price", "Sanders", "Ross", "Ortiz", "Bailey", "Brooks", "Morales", "Ward", "Sullivan", "Perry"]
CITIES = ["Austin", "Round Rock", "Cedar Park", "Pflugerville", "Georgetown", "San Marcos", "Buda", "Lakeway"]
STREETS = ["Congress Ave", "Barton Springs Rd", "Riverside Dr", "Burnet Rd", "Lamar Blvd", "Guadalupe St",
           "Manchaca Rd", "Oltorf St", "Slaughter Ln", "Parmer Ln"]
SOURCES = ["website", "walk_in", "phone", "referral", "whatsapp", "autotrader", "facebook"]
COMPLAINTS = [
    ("Scheduled 30k mile maintenance", "Performed 30k service: oil & filter, cabin + engine air filter, tire rotation, multipoint inspection."),
    ("Check engine light on, rough idle", "Replaced ignition coil cyl #3 and spark plugs. Cleared codes, road tested OK."),
    ("Brakes squealing when stopping", "Replaced front pads and resurfaced rotors. Brake fluid flush."),
    ("A/C blowing warm air", "Found leak at condenser. Replaced condenser, evacuated and recharged system."),
    ("Oil change and tire rotation", "Full synthetic oil change, rotated tires, topped off fluids."),
    ("Vibration at highway speed", "Balanced all four wheels, replaced bent front left wheel weight. Alignment performed."),
    ("Battery warning, slow crank", "Load tested battery — failed. Replaced 12V battery, tested charging system OK."),
    ("Infotainment screen freezing", "Applied software update to head unit per TSB. Verified operation."),
    ("Windshield chip repair + wipers", "Resin repair on chip, replaced wiper blades."),
    ("Pre-purchase inspection", "Completed 160-point inspection, report provided to customer."),
]
PARTS = [
    ("OIL-0W20-5Q", "Full Synthetic 0W-20 (5 qt)", "Fluids", 2200, 4499), ("OIL-5W30-5Q", "Synthetic Blend 5W-30 (5 qt)", "Fluids", 1800, 3699),
    ("FLT-OIL-T01", "Oil Filter — Toyota/Lexus", "Filters", 450, 1299), ("FLT-OIL-H01", "Oil Filter — Honda", "Filters", 420, 1199),
    ("FLT-OIL-F01", "Oil Filter — Ford", "Filters", 480, 1299), ("FLT-AIR-U01", "Engine Air Filter (universal fit)", "Filters", 900, 2899),
    ("FLT-CAB-U01", "Cabin Air Filter — Carbon", "Filters", 1100, 3499), ("BRK-PAD-F01", "Ceramic Brake Pads — Front", "Brakes", 3800, 8999),
    ("BRK-PAD-R01", "Ceramic Brake Pads — Rear", "Brakes", 3400, 7999), ("BRK-ROT-F01", "Brake Rotor — Front", "Brakes", 5200, 12999),
    ("BRK-FLD-DOT4", "Brake Fluid DOT 4 (1L)", "Fluids", 900, 2499), ("IGN-SPK-IR4", "Iridium Spark Plug", "Ignition", 850, 2299),
    ("IGN-COIL-T1", "Ignition Coil — Toyota", "Ignition", 4200, 10999), ("BAT-H6-AGM", "AGM Battery H6", "Electrical", 13500, 24999),
    ("BAT-H7-AGM", "AGM Battery H7", "Electrical", 14500, 26999), ("WPR-22", "Wiper Blade 22\"", "Exterior", 900, 2499),
    ("WPR-26", "Wiper Blade 26\"", "Exterior", 950, 2699), ("AC-CND-H01", "A/C Condenser — Honda", "HVAC", 18500, 38999),
    ("AC-R1234", "Refrigerant R-1234yf (lb)", "HVAC", 4500, 11999), ("TIR-VLV-TPMS", "TPMS Sensor", "Tires", 3200, 7999),
    ("TIR-AS-235", "All-Season Tire 235/55R18", "Tires", 11500, 18999), ("CLN-DEF", "Coolant 50/50 (1 gal)", "Fluids", 1300, 2999),
    ("BLT-SERP-U1", "Serpentine Belt", "Engine", 2600, 6499), ("HDL-LED-H11", "LED Headlight Bulb H11 (pair)", "Electrical", 3000, 7999),
]


def vin_for(wmi: str, year: int) -> str:
    alphabet = "ABCDEFGHJKLMNPRSTUVWXYZ0123456789"
    letters = "ABCDEFGHJKLMNPRSTUVWXYZ"
    vds = "".join(rng.choice(alphabet) for _ in range(3)) + rng.choice(letters) + rng.choice(alphabet)
    # position 7 (index 6) alpha → 2010+ year cycle
    vds = vds[:3] + rng.choice(letters) + vds[4]
    year_code = _YEAR_CODES[(year - 2010) % 30]
    tail = rng.choice(letters) + "".join(rng.choice(string.digits) for _ in range(6))
    partial = wmi + vds + "0" + year_code + tail
    total = sum(_TRANSLIT[c] * w for c, w in zip(partial, _WEIGHTS))
    check = "X" if total % 11 == 10 else str(total % 11)
    return partial[:8] + check + partial[9:]


def phone() -> str:
    return f"+1 512 555 {rng.randint(1000, 9999)}"


# ---------------------------------------------------------------------------
# Seeder
# ---------------------------------------------------------------------------
class Seeder:
    def __init__(self, conn):
        self.db = conn
        self.used_vins: set[str] = set()
        self.media = Path(settings.media_dir) / "stock"

    # -- helpers ----------------------------------------------------------
    def act(self, customer_id, summary, type="note", lead_id=None, user_id=None, at: datetime | None = None, meta=None):
        insert(self.db, "activities", {"customer_id": customer_id, "lead_id": lead_id, "user_id": user_id, "type": type,
                                       "summary": summary, "meta": json.dumps(meta) if meta else None,
                                       "created_at": iso(at or NOW)})

    def photos(self):
        self.media.mkdir(parents=True, exist_ok=True)
        for f in ASSETS.glob("*.jpg"):
            shutil.copy(f, self.media / f.name)

    def photo_for(self, body: str, fuel: str) -> str:
        key = "electric" if fuel == "electric" else body
        if key == "wagon":
            key = "suv"
        return f"/media/stock/{key}.jpg"

    # -- users ------------------------------------------------------------
    def users(self):
        staff_pw, cust_pw = hash_password("meridian123"), hash_password("customer123")
        rows = [
            ("admin@meridian.demo", "Alex Morgan", "admin", "#f26b3a"),
            ("sarah@meridian.demo", "Sarah Mitchell", "sales", "#6366f1"),
            ("marcus@meridian.demo", "Marcus Reed", "sales", "#14b8a6"),
            ("priya@meridian.demo", "Priya Shah", "sales", "#ec4899"),
            ("diego@meridian.demo", "Diego Alvarez", "service", "#eab308"),
        ]
        self.u = {}
        for email, name, role, color in rows:
            self.u[email.split("@")[0]] = insert(self.db, "users", {
                "email": email, "password_hash": staff_pw, "full_name": name, "role": role, "phone": phone(),
                "avatar_color": color, "last_login_at": iso(ago(hours=rng.randint(1, 30))), "created_at": iso(ago(400))})
        self.reps = [self.u["sarah"], self.u["marcus"], self.u["priya"]]
        self.portal_user = insert(self.db, "users", {
            "email": "customer@meridian.demo", "password_hash": cust_pw, "full_name": "Emma Clarke", "role": "customer",
            "phone": "+1 512 555 0198", "avatar_color": "#f26b3a", "created_at": iso(ago(200))})

    # -- customers --------------------------------------------------------
    def customers(self, n: int = 70):
        self.cust = []
        names = set()
        emma = self._customer("Emma", "Clarke", created=ago(200), user_id=self.portal_user, email="customer@meridian.demo",
                              phone_="+1 512 555 0198", channel="whatsapp", consents={"whatsapp": True, "marketing": True})
        self.emma = emma
        names.add(("Emma", "Clarke"))
        while len(self.cust) < n:
            f, l = rng.choice(FIRST), rng.choice(LAST)
            if (f, l) in names:
                continue
            names.add((f, l))
            self._customer(f, l, created=ago(rng.randint(1, 380)))

    def _customer(self, first, last, *, created, user_id=None, email=None, phone_=None, channel=None, consents=None):
        ph = phone_ or phone()
        ch = channel or rng.choices(["email", "whatsapp", "phone"], [5, 4, 1])[0]
        cid = insert(self.db, "customers", {
            "user_id": user_id, "first_name": first, "last_name": last,
            "email": email or f"{first.lower()}.{last.lower()}@{rng.choice(['gmail.com', 'outlook.com', 'icloud.com', 'yahoo.com'])}",
            "phone": ph, "whatsapp": ph if ch == "whatsapp" or rng.random() < .4 else None,
            "address": f"{rng.randint(100, 9800)} {rng.choice(STREETS)}", "city": rng.choice(CITIES), "preferred_channel": ch,
            "owner_id": rng.choice(self.reps), "tags": rng.sample(["vip", "fleet", "repeat", "first-time buyer", "trade-in",
                                                                     "financing", "cash buyer", "ev-curious"], rng.randint(0, 2)),
            "created_at": iso(created), "updated_at": iso(created)})
        c = {"data_processing": True, "email": True, "whatsapp": ch == "whatsapp" or rng.random() < .5,
             "phone": True, "marketing": rng.random() < .55, **(consents or {})}
        for k, v in c.items():
            insert(self.db, "consents", {"customer_id": cid, "channel": k, "granted": int(v),
                                         "source": "portal" if user_id else rng.choice(["staff", "import"]), "created_at": iso(created)})
        self.act(cid, "Customer profile created", type="system", at=created)
        self.cust.append(cid)
        return cid

    # -- inventory --------------------------------------------------------
    def _vehicle(self, *, status: str, acquired: datetime, sold_at: datetime | None = None, featured=False, condition=None):
        make, model, trims, body, fuel, trans, drive, engine, hp, msrp, wmi, doors, seats = rng.choice(CATALOG)
        cond = condition or rng.choices(["new", "used", "certified"], [5, 4, 2])[0]
        year = NOW.year + (1 if cond == "new" and rng.random() < .3 else 0) if cond == "new" else rng.randint(NOW.year - 7, NOW.year - 1)
        trim = rng.choice(trims)
        trim_bump = trims.index(trim) * 0.09
        age = NOW.year - year
        mileage = rng.randint(3, 40) if cond == "new" else rng.randint(6000, 14000) * max(age, 1)
        msrp_c = int(msrp * (1 + trim_bump) * 100)
        price = msrp_c - rng.randint(0, 12) * 10000 if cond == "new" else int(msrp_c * (0.86 ** max(age, 1)) * (0.97 if cond == "used" else 1.02))
        price = round(price / 10000) * 10000 - 100  # $xx,x99 pricing
        cost = int(price * rng.uniform(0.84, 0.92))
        while True:
            vin = vin_for(wmi, year)
            if vin not in self.used_vins:
                self.used_vins.add(vin)
                break
        feats = rng.sample(FEATURES, rng.randint(5, 11))
        color = rng.choice(COLORS)
        vid = insert(self.db, "vehicles", {
            "vin": vin, "stock_number": f"{'N' if cond == 'new' else 'U'}{vin[-6:]}", "condition": cond, "status": status,
            "year": year, "make": make, "model": model, "trim": trim, "body_style": body, "transmission": trans,
            "fuel_type": fuel, "drivetrain": drive, "engine": engine, "horsepower": hp, "doors": doors, "seats": seats,
            "exterior_color": color, "interior_color": rng.choice(INTERIORS), "mileage": mileage,
            "condition_grade": None if cond == "new" else rng.choice(["A+", "A", "A", "B+", "B"]),
            "price": price, "msrp": msrp_c if cond == "new" else None, "cost": cost, "features": feats,
            "description": (f"{'Brand-new' if cond == 'new' else 'Meticulously maintained'} {year} {make} {model} {trim} in "
                            f"{color}. {engine}, {hp} hp, {drive.upper()}. "
                            f"{'Full factory warranty.' if cond == 'new' else 'Clean history report, 160-point inspection passed.'}"
                            f"{' Certified Pre-Owned with extended powertrain coverage.' if cond == 'certified' else ''}"),
            "is_featured": int(featured), "is_published": int(status != "incoming" or rng.random() < .5),
            "acquired_at": iso(acquired), "sold_at": iso(sold_at) if sold_at else None,
            "created_at": iso(acquired), "updated_at": iso(sold_at or acquired)})
        insert(self.db, "vehicle_photos", {"vehicle_id": vid, "url": self.photo_for(body, fuel), "caption": f"{year} {make} {model}",
                                           "sort_order": 0})
        return {"id": vid, "price": price, "cost": cost, "title": f"{year} {make} {model}", "year": year, "make": make,
                "model": model}

    def inventory(self, n: int = 64):
        self.stock = []
        for i in range(n):
            status = rng.choices(["in_stock", "reserved", "in_service", "incoming"], [80, 7, 5, 8])[0]
            acquired = ago(rng.choice([rng.randint(1, 30), rng.randint(1, 60), rng.randint(20, 120)]))
            self.stock.append(self._vehicle(status=status, acquired=acquired, featured=i < 8))

    # -- sales history ----------------------------------------------------
    def deals_history(self):
        self.deals = []
        seq = 0
        for months_back in range(12, -1, -1):
            base = (NOW.replace(day=1) - timedelta(days=30 * months_back)).replace(day=1)
            count = rng.randint(7, 13) + (12 - months_back) // 3
            for _ in range(count):
                delivered = base + timedelta(days=rng.randint(0, 27), hours=rng.randint(14, 23))
                if delivered >= NOW:
                    continue
                seq += 1
                v = self._vehicle(status="sold", acquired=delivered - timedelta(days=rng.randint(8, 75)), sold_at=delivered)
                cust = rng.choice(self.cust[1:])
                self._deal(seq, v, cust, rng.choice(self.reps), "delivered", delivered)
        # Emma: owns a car (delivered 7 months ago)
        seq += 1
        v = self._vehicle(status="sold", acquired=ago(240), sold_at=ago(210), condition="new")
        self.emma_vehicle = v
        self._deal(seq, v, self.emma, self.u["sarah"], "delivered", ago(210))
        # Open pipeline deals on current stock
        for status in ["draft", "quoted", "quoted", "accepted", "invoiced", "draft", "quoted"]:
            seq += 1
            v = rng.choice([s for s in self.stock if s.get("deal") is None and s["id"]])
            v["deal"] = True
            cust = rng.choice(self.cust[1:])
            created = ago(rng.randint(0, 10))
            self._deal(seq, v, cust, rng.choice(self.reps), status, None, created=created)
            if status in ("accepted", "invoiced"):
                self.db.execute("UPDATE vehicles SET status = 'reserved' WHERE id = ?", (v["id"],))
        # Emma: open quote on a second vehicle
        seq += 1
        v = next(s for s in self.stock if s.get("deal") is None)
        v["deal"] = True
        self._deal(seq, v, self.emma, self.u["sarah"], "quoted", None, created=ago(2))
        self.emma_quote_vehicle = v

    def _deal(self, seq, v, cust, rep, status, delivered: datetime | None, created: datetime | None = None):
        created = created or (delivered - timedelta(days=rng.randint(2, 12)))
        discount = rng.choice([0, 0, 50000, 100000, 150000, 200000])
        trade = rng.choice([0, 0, 0, 800000, 1250000, 1900000])
        payoff = int(trade * rng.choice([0, 0, .4, .7])) if trade else 0
        acc = rng.sample([{"label": "All-weather floor mats", "amount": 22500, "taxable": True},
                          {"label": "Ceramic paint protection", "amount": 89500, "taxable": True},
                          {"label": "Window tint", "amount": 39900, "taxable": True},
                          {"label": "Extended warranty — 5yr/75k", "amount": 249500, "taxable": False}], rng.randint(0, 2))
        fees = pricing.DEFAULT_FEES
        b = pricing.calculate(vehicle_price=v["price"], discount=discount, trade_in_value=trade, trade_in_payoff=payoff,
                              tax_rate=settings.default_tax_rate, fees=fees, accessories=acc, deposit=0, vehicle_cost=v["cost"])
        did = insert(self.db, "deals", {
            "deal_number": f"D-{created:%y%m}-{seq:04d}", "customer_id": cust, "vehicle_id": v["id"], "sales_rep_id": rep,
            "status": status, "vehicle_price": v["price"], "discount": discount, "trade_in_value": trade, "trade_in_payoff": payoff,
            "trade_in_desc": rng.choice(["2016 Honda Accord EX, 98k mi", "2018 Ford Escape SE, 71k mi", "2015 Toyota Corolla LE, 120k mi"]) if trade else None,
            "tax_rate": settings.default_tax_rate, "fees": fees, "accessories": acc, "deposit": rng.choice([0, 50000, 100000]) if status != "draft" else 0,
            "subtotal": b["subtotal"], "tax_total": b["tax_total"], "total_otd": b["total_otd"], "gross_profit": b["gross_profit"],
            "quoted_at": iso(created + timedelta(hours=3)) if status != "draft" else None,
            "invoiced_at": iso(delivered - timedelta(days=1)) if delivered else (iso(NOW) if status == "invoiced" else None),
            "delivered_at": iso(delivered) if delivered else None, "created_at": iso(created), "updated_at": iso(delivered or created)})
        if delivered:
            self.db.execute("UPDATE customers SET lifetime_value = lifetime_value + ? WHERE id = ?", (b["total_otd"], cust))
            self.act(cust, f"Deal D-{created:%y%m}-{seq:04d} → delivered: {v['title']}", type="deal", user_id=rep, at=delivered)
            # A closed-won lead so conversion stats look right
            insert(self.db, "leads", {"customer_id": cust, "vehicle_id": v["id"], "assigned_to": rep, "stage": "won",
                                      "source": rng.choice(SOURCES), "score": rng.randint(70, 98), "budget": v["price"],
                                      "last_activity_at": iso(delivered), "created_at": iso(created - timedelta(days=rng.randint(3, 20))),
                                      "updated_at": iso(delivered)})
        else:
            self.act(cust, f"Deal opened for {v['title']}", type="deal", user_id=rep, at=created)
        self.deals.append(did)
        return did

    # -- CRM pipeline -----------------------------------------------------
    def leads(self):
        stages = (["new"] * 9 + ["contacted"] * 8 + ["qualified"] * 7 + ["test_drive"] * 6 + ["negotiation"] * 5)
        self.open_leads = []
        pool = [c for c in self.cust[1:]]
        rng.shuffle(pool)
        for i, stage in enumerate(stages):
            cust = pool[i]
            v = rng.choice(self.stock)
            rep = rng.choice(self.reps)
            created = ago(rng.uniform(0.1, 25))
            last = min(NOW, created + timedelta(days=rng.uniform(0, 6)))
            lid = insert(self.db, "leads", {
                "customer_id": cust, "vehicle_id": v["id"], "assigned_to": rep, "stage": stage, "source": rng.choice(SOURCES),
                "score": rng.randint(25, 95), "budget": round(v["price"] * rng.uniform(.85, 1.1), -5), "position": i,
                "notes": rng.choice([None, "Wants to trade in current car", "Pre-approved with credit union",
                                     "Comparing with competitor offer", "Needs third-row seating", "Interested in financing 60 mo"]),
                "last_activity_at": iso(last), "created_at": iso(created), "updated_at": iso(last)})
            self.open_leads.append({"id": lid, "customer_id": cust, "vehicle": v, "rep": rep, "stage": stage})
            self.act(cust, f"Lead created from {rng.choice(SOURCES).replace('_', ' ')} — interested in {v['title']}",
                     type="system", lead_id=lid, user_id=rep, at=created)
            path = ["new", "contacted", "qualified", "test_drive", "negotiation"]
            for j in range(1, path.index(stage) + 1):
                self.act(cust, f"Moved from {path[j - 1].replace('_', ' ').title()} to {path[j].replace('_', ' ').title()}",
                         type="stage_change", lead_id=lid, user_id=rep, at=created + (last - created) * (j / 5))
            if rng.random() < .5:
                self.act(cust, rng.choice(["Called — left voicemail", "Spoke on phone, very interested, wants weekend visit",
                                           "Sent pricing breakdown by email", "Customer asked about lease options"]),
                         type=rng.choice(["call", "note"]), lead_id=lid, user_id=rep, at=last)
        # Lost leads
        for _ in range(8):
            cust = rng.choice(pool)
            t = ago(rng.randint(2, 25))
            insert(self.db, "leads", {"customer_id": cust, "vehicle_id": rng.choice(self.stock)["id"], "assigned_to": rng.choice(self.reps),
                                      "stage": "lost", "source": rng.choice(SOURCES), "score": rng.randint(10, 40),
                                      "lost_reason": rng.choice(["Bought elsewhere", "Price too high", "Financing declined", "Went silent"]),
                                      "last_activity_at": iso(t), "created_at": iso(t - timedelta(days=10)), "updated_at": iso(t)})
        # Emma's open lead
        lid = insert(self.db, "leads", {"customer_id": self.emma, "vehicle_id": self.emma_quote_vehicle["id"], "assigned_to": self.u["sarah"],
                                        "stage": "negotiation", "source": "website", "score": 88, "budget": self.emma_quote_vehicle["price"],
                                        "last_activity_at": iso(ago(1)), "created_at": iso(ago(9)), "updated_at": iso(ago(1))})
        self.emma_lead = lid

    def tasks(self):
        templates = {"new": "First contact: call {n} within the hour", "contacted": "Follow up with {n} — qualify budget & timeline",
                     "qualified": "Offer {n} a test drive", "test_drive": "Post test-drive call with {n}",
                     "negotiation": "Check in on {n}'s quote decision"}
        for l in self.open_leads:
            name = self.db.execute("SELECT first_name || ' ' || last_name AS n FROM customers WHERE id = ?", (l["customer_id"],)).fetchone()["n"]
            due = NOW + timedelta(hours=rng.randint(-30, 72))
            insert(self.db, "tasks", {"title": templates[l["stage"]].format(n=name), "due_at": iso(due),
                                      "priority": "high" if l["stage"] in ("new", "negotiation") else "normal",
                                      "lead_id": l["id"], "customer_id": l["customer_id"], "assigned_to": l["rep"], "is_automated": 1,
                                      "automation_key": f"lead:{l['id']}:stage:{l['stage']}", "created_at": iso(due - timedelta(days=1))})
        for title in ["Prepare monthly floor-plan audit", "Order demo plates for new arrivals", "Review aged inventory (90+ days)"]:
            insert(self.db, "tasks", {"title": title, "due_at": iso(NOW + timedelta(days=rng.randint(0, 4))), "assigned_to": self.u["admin"],
                                      "priority": "normal"})

    def test_drives(self):
        candidates = [l for l in self.open_leads if l["stage"] in ("qualified", "test_drive", "negotiation")]
        for i, l in enumerate(candidates):
            if i < 4:
                when, status = business_slot(0, [10, 12, 15, 17][i]), "confirmed"
            elif i < 12:
                when, status = business_slot(rng.randint(1, 6)), rng.choice(["confirmed", "requested"])
            else:
                when, status = business_slot(-rng.randint(1, 12)), rng.choice(["completed", "completed", "no_show"])
            route = dist = None
            if status == "completed":
                lat, lng = settings.dealer_lat, settings.dealer_lng
                pts = [[lat, lng]]
                for _ in range(40):
                    lat += rng.uniform(-.004, .006); lng += rng.uniform(-.006, .004)
                    pts.append([round(lat, 5), round(lng, 5)])
                route, dist = json.dumps(pts), round(rng.uniform(8, 22), 1)
            insert(self.db, "test_drives", {"customer_id": l["customer_id"], "vehicle_id": l["vehicle"]["id"], "lead_id": l["id"],
                                            "sales_rep_id": l["rep"], "scheduled_at": iso(when), "status": status,
                                            "route": route, "distance_km": dist, "license_verified": int(status == "completed"),
                                            "feedback": rng.choice([None, "Loved the handling", "Wants to compare with trim above"]) if status == "completed" else None,
                                            "created_at": iso(when - timedelta(days=2))})
            self.act(l["customer_id"], f"Test drive scheduled: {l['vehicle']['title']}", type="test_drive", lead_id=l["id"],
                     user_id=l["rep"], at=when - timedelta(days=2))
        # Emma: upcoming test drive
        insert(self.db, "test_drives", {"customer_id": self.emma, "vehicle_id": self.emma_quote_vehicle["id"], "lead_id": self.emma_lead,
                                        "sales_rep_id": self.u["sarah"], "scheduled_at": iso(business_slot(2, 11)), "status": "confirmed",
                                        "created_at": iso(ago(1))})

    # -- service ----------------------------------------------------------
    def service(self):
        self.parts = []
        for sku, name, cat, cost, price in PARTS:
            qty = rng.randint(0, 40)
            self.parts.append({"id": insert(self.db, "parts", {"sku": sku, "name": name, "category": cat, "qty_on_hand": qty,
                                                               "reorder_level": rng.choice([4, 5, 6, 8]), "unit_cost": cost,
                                                               "unit_price": price, "bin_location": f"{rng.choice('ABCD')}-{rng.randint(1, 12):02d}"}),
                               "price": price, "qty": qty})
        seq = 0
        techs = ["J. Park", "R. Okafor", "T. Lindqvist", "M. Santos"]
        sold_vehicles = [r["id"] for r in self.db.execute("SELECT id FROM vehicles WHERE status = 'sold'").fetchall()]

        def job(status, sched: datetime, customer=None, vehicle=None, closed=None, complaint=None):
            nonlocal seq
            seq += 1
            c, work = complaint or rng.choice(COMPLAINTS)
            hours = rng.choice([0.5, 1.0, 1.5, 2.0, 2.5, 3.5])
            cust = customer or rng.choice(self.cust[1:])
            veh = vehicle if vehicle is not None else (rng.choice(sold_vehicles) if rng.random() < .6 else None)
            jid = insert(self.db, "service_jobs", {
                "ro_number": f"RO-{sched:%y}{seq:05d}", "customer_id": cust, "vehicle_id": veh,
                "customer_vehicle": None if veh else rng.choice(["2017 Honda Accord", "2019 Jeep Wrangler", "2020 Nissan Rogue", "2016 Ford Fusion"]),
                "advisor_id": self.u["diego"], "technician": rng.choice(techs) if status != "scheduled" else None,
                "bay": f"Bay {rng.randint(1, 8)}" if status in ("in_progress", "quality_check", "waiting_parts") else None,
                "status": status, "priority": rng.choices(["low", "normal", "high", "urgent"], [2, 6, 2, 1])[0], "complaint": c,
                "diagnosis": "Confirmed customer concern." if status not in ("scheduled", "checked_in") else None,
                "work_performed": work if status in ("quality_check", "ready", "closed") else None,
                "odometer_in": rng.randint(8000, 90000), "labor_hours": hours, "scheduled_at": iso(sched),
                "promised_at": iso(sched + timedelta(hours=rng.randint(3, 30))), "closed_at": iso(closed) if closed else None,
                "created_at": iso(sched - timedelta(days=2)), "updated_at": iso(closed or sched)})
            for _ in range(rng.randint(0, 3) if status not in ("scheduled",) else 0):
                p = rng.choice(self.parts)
                q = rng.randint(1, 4)
                insert(self.db, "service_job_parts", {"service_job_id": jid, "part_id": p["id"], "quantity": q, "unit_price": p["price"]})
                if status != "closed":
                    self.db.execute("UPDATE parts SET qty_reserved = MIN(qty_reserved + ?, qty_on_hand) WHERE id = ?", (q, p["id"]))
            pt = self.db.execute("SELECT COALESCE(SUM(quantity*unit_price),0) AS t FROM service_job_parts WHERE service_job_id=?", (jid,)).fetchone()["t"]
            self.db.execute("UPDATE service_jobs SET parts_total = ?, total = ? WHERE id = ?", (pt, pt + round(hours * 14500), jid))
            self.act(cust, f"Repair order opened: {c}", type="service", user_id=self.u["diego"], at=sched - timedelta(days=2))
            return jid

        for d in range(150, 0, -4):  # closed history
            for _ in range(rng.randint(1, 3)):
                s = ago(d + rng.random())
                job("closed", s, closed=s + timedelta(hours=rng.randint(4, 30)))
        for status in ["scheduled"] * 4 + ["checked_in"] * 3 + ["in_progress"] * 4 + ["waiting_parts"] * 2 + ["quality_check"] * 2 + ["ready"] * 3:
            off = rng.randint(1, 5) if status == "scheduled" else -rng.uniform(0, 2)
            job(status, NOW + timedelta(days=off))
        # Emma: one closed and one active job on her car
        job("closed", ago(90), customer=self.emma, vehicle=self.emma_vehicle["id"], closed=ago(89.7), complaint=COMPLAINTS[4])
        job("in_progress", ago(0.2), customer=self.emma, vehicle=self.emma_vehicle["id"], complaint=COMPLAINTS[2])

    # -- comms / compliance ----------------------------------------------
    def comms(self):
        out = ["Hi {f}, thanks for stopping by! Let me know if you have any questions about the {v}.",
               "Hi {f}, just following up — the {v} is still available. Want to schedule a test drive?",
               "Great news {f}, we can do the {v} with 2.9% APR for 60 months. Interested?"]
        inb = ["Yes! Is Saturday morning available?", "Can you send me the out-the-door price?", "Thanks, I'll think about it this week.",
               "Does it come with a warranty?", "What's the best you can do on price?", "Can I bring my trade-in for appraisal?"]
        for l in self.open_leads[:26]:
            f = self.db.execute("SELECT first_name, preferred_channel, email, whatsapp, phone FROM customers WHERE id = ?", (l["customer_id"],)).fetchone()
            ch = "whatsapp" if f["preferred_channel"] == "whatsapp" else "email"
            t = ago(rng.uniform(0.05, 6))
            for k in range(rng.randint(1, 4)):
                direction = "outbound" if k % 2 == 0 else "inbound"
                body = (rng.choice(out) if direction == "outbound" else rng.choice(inb)).format(f=f["first_name"], v=l["vehicle"]["title"])
                insert(self.db, "communications", {
                    "customer_id": l["customer_id"], "lead_id": l["id"], "user_id": l["rep"] if direction == "outbound" else None,
                    "channel": ch, "direction": direction, "recipient": (f["whatsapp"] or f["phone"]) if ch == "whatsapp" else f["email"],
                    "subject": f"About the {l['vehicle']['title']}" if ch == "email" and direction == "outbound" else None, "body": body,
                    "status": "read" if direction == "outbound" and ch == "whatsapp" else ("simulated" if direction == "outbound" else "received"),
                    "is_automated": 0, "created_at": iso(t)})
                t += timedelta(minutes=rng.randint(4, 300))
        insert(self.db, "communications", {"customer_id": self.emma, "lead_id": self.emma_lead, "user_id": self.u["sarah"], "channel": "whatsapp",
                                           "direction": "outbound", "recipient": "+1 512 555 0198", "template": "quote_ready", "status": "read",
                                           "body": f"Hi Emma, your personalised quote for the {self.emma_quote_vehicle['title']} is ready. Happy to walk you through it.",
                                           "created_at": iso(ago(2))})

    def compliance(self):
        for _ in range(40):
            uid = rng.choice(list(self.u.values()))
            insert(self.db, "audit_logs", {"user_id": uid, "action": "login", "entity": "user", "entity_id": uid, "details": "{}",
                                           "ip_address": f"10.0.{rng.randint(0, 3)}.{rng.randint(2, 250)}", "created_at": iso(ago(rng.uniform(0, 20)))})
        for v in rng.sample(self.stock, 10):
            insert(self.db, "audit_logs", {"user_id": rng.choice(self.reps), "action": "update", "entity": "vehicle", "entity_id": v["id"],
                                           "details": json.dumps({"changes": {"price": v["price"]}}), "ip_address": "10.0.1.24",
                                           "created_at": iso(ago(rng.uniform(0, 10)))})
        c1, c2 = rng.sample(self.cust[5:], 2)
        insert(self.db, "gdpr_requests", {"customer_id": c1, "type": "erasure", "status": "pending", "requested_by": "customer",
                                          "notes": "Moving abroad, please delete my data", "created_at": iso(ago(3))})
        insert(self.db, "gdpr_requests", {"customer_id": c2, "type": "export", "status": "completed", "requested_by": "customer",
                                          "completed_by": self.u["admin"], "completed_at": iso(ago(12)), "created_at": iso(ago(12))})
        for fav in rng.sample(self.stock, 3):
            self.db.execute("INSERT OR IGNORE INTO favorites (customer_id, vehicle_id) VALUES (?, ?)", (self.emma, fav["id"]))

    def run(self):
        self.photos()
        self.db.execute("BEGIN")
        self.users(); self.customers(); self.inventory(); self.deals_history(); self.leads(); self.tasks()
        self.test_drives(); self.service(); self.comms(); self.compliance()
        self.db.execute("COMMIT")
        self.db.execute("PRAGMA optimize")


def main(argv: list[str]) -> None:
    if "--reset" in argv:
        for suffix in ("", "-wal", "-shm"):
            p = Path(str(settings.database_path) + suffix)
            if p.exists():
                p.unlink()
        shutil.rmtree(Path(settings.media_dir) / "stock", ignore_errors=True)
    init_db()
    with closing_conn() as conn:
        if conn.execute("SELECT COUNT(*) AS n FROM users").fetchone()["n"]:
            print("Database already seeded — use --reset to rebuild.")
            return
        Seeder(conn).run()
        counts = {t: conn.execute(f"SELECT COUNT(*) AS n FROM {t}").fetchone()["n"]
                  for t in ("users", "customers", "vehicles", "leads", "deals", "test_drives", "service_jobs", "communications")}
    print("Seeded:", ", ".join(f"{k}={v}" for k, v in counts.items()))


if __name__ == "__main__":
    main(sys.argv[1:])
