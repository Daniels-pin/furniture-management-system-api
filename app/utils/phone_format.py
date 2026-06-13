"""Phone formatting helpers for CSV export (Nigerian E.164)."""

from __future__ import annotations

import re

_NON_DIGIT_RE = re.compile(r"\D")
_NIGERIAN_NATIONAL_LENGTH = 10


def sanitize_phone_digits(phone: str) -> str:
    """Remove spaces, dashes, parentheses, and other non-digit characters."""
    return _NON_DIGIT_RE.sub("", (phone or "").strip())


def format_nigerian_phone_e164(phone: str) -> str | None:
    """
    Convert a Nigerian phone number to international E.164 (+234...) for export.

    Returns None for empty, invalid, or malformed numbers. Does not mutate stored data.
    """
    raw = (phone or "").strip()
    if not raw:
        return None

    digits = sanitize_phone_digits(raw)
    if not digits:
        return None

    if digits.startswith("234"):
        national = digits[3:]
        if len(national) == _NIGERIAN_NATIONAL_LENGTH and national.isdigit():
            return f"+234{national}"
        return None

    if digits.startswith("0"):
        national = digits[1:]
        if len(national) == _NIGERIAN_NATIONAL_LENGTH and national.isdigit():
            return f"+234{national}"
        return None

    return None
