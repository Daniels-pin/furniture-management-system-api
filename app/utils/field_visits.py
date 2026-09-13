from __future__ import annotations

from decimal import Decimal

from sqlalchemy.orm import Session

from app import models

PROJECT_TYPES = [
    "Residential",
    "Duplex",
    "Apartments",
    "Commercial",
    "Office",
    "Hotel",
    "School",
    "Hospital",
    "Church",
    "Government",
    "Industrial",
    "Other",
]

PROJECT_STAGES = [
    "Foundation",
    "Block Work",
    "Roofing",
    "Finishing",
    "Ready for Furniture",
]

FURNITURE_CATEGORIES = [
    "Kitchen Cabinets",
    "Wardrobes",
    "TV Console",
    "Office Tables",
    "Executive Tables",
    "Workstations",
    "Reception Desk",
    "Dining Table",
    "Dining Chairs",
    "Coffee Table",
    "Bed Frame",
    "Side Drawers",
    "Shoe Rack",
    "Bookshelf",
    "Shelves",
    "Bar Unit",
    "Conference Table",
    "Office Chairs",
    "Filing Cabinets",
    "Hotel Furniture",
    "School Furniture",
    "Hospital Furniture",
    "Custom Furniture",
    "Other",
]

VISIT_OUTCOMES = [
    "Information Gathered",
    "Client Interested",
    "Measurements Taken",
    "BOQ Collected",
    "Appointment Scheduled",
    "Site Inaccessible",
    "Other",
]

BOQ_OPTIONS = ["Yes", "No"]

MAX_FIELD_VISIT_PHOTOS = 10


def next_field_visit_number(db: Session) -> str:
    """Next FV-###### suffix; deleted rows never recycle numbers."""
    max_seq = 0
    for (raw,) in db.query(models.FieldVisit.visit_number).all():
        s = (raw or "").strip().upper()
        if not s.startswith("FV-"):
            continue
        tail = s[3:].strip()
        if not tail:
            continue
        try:
            max_seq = max(max_seq, int(tail, 10))
        except ValueError:
            continue
    return f"FV-{max_seq + 1:06d}"


def google_maps_url(latitude: float | None, longitude: float | None) -> str | None:
    if latitude is None or longitude is None:
        return None
    return f"https://www.google.com/maps?q={latitude},{longitude}"


def employee_display_name(user: models.User | None) -> str | None:
    if user is None:
        return None
    name = (getattr(user, "name", None) or "").strip()
    if name:
        return name
    email = (getattr(user, "email", None) or "").strip()
    if email:
        return email.split("@")[0] or email
    return None


def as_decimal(v) -> Decimal | None:
    if v is None:
        return None
    return Decimal(str(v))
