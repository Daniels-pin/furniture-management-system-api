"""Business timezone helpers — Africa/Lagos (WAT, UTC+1, no DST).

Storage convention for naive DB timestamps (DateTime without time zone):
  - Instants (check_in_at, created_at, paid_at, …) are stored as UTC wall time (naive).
  - Calendar dates (attendance_date, absence_date) use date in Lagos.

API JSON: use datetime_for_api() so Pydantic emits UTC with an offset (parseable everywhere).
Display: frontend converts UTC → Africa/Lagos (never browser-local for business times).
"""

from __future__ import annotations

from datetime import date, datetime, time, timedelta, timezone
from typing import Optional
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

try:
    BUSINESS_TZ = ZoneInfo("Africa/Lagos")
except ZoneInfoNotFoundError:
    # Windows dev without tzdata
    BUSINESS_TZ = timezone(timedelta(hours=1))

UTC = timezone.utc
LATE_CUTOFF_TIME = time(8, 15)  # 08:15 WAT — global fallback when location has no late time
CHECK_OUT_TIME = time(17, 0)  # 17:00 WAT — global fallback when location has no sign-out time


def now_lagos() -> datetime:
    """Timezone-aware current time in Lagos (attendance, payroll month rollover)."""
    return datetime.now(tz=BUSINESS_TZ).replace(microsecond=0)


def lagos_today() -> date:
    return now_lagos().date()


def now_utc_naive() -> datetime:
    """Naive UTC now for audit columns (created_at, updated_at, month_paid_at)."""
    return datetime.now(tz=UTC).replace(tzinfo=None, microsecond=0)


def to_lagos(dt: datetime) -> datetime:
    """Convert any datetime to aware Lagos. Naive values are treated as UTC (DB storage)."""
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=UTC)
    return dt.astimezone(BUSINESS_TZ)


def utc_naive_from(dt: datetime) -> datetime:
    """Persist an instant as naive UTC for TIMESTAMP WITHOUT TIME ZONE columns."""
    if dt.tzinfo is None:
        return dt.replace(microsecond=0)
    return dt.astimezone(UTC).replace(tzinfo=None, microsecond=0)


def datetime_for_api(dt: datetime) -> datetime:
    """UTC-aware datetime for API JSON (always includes offset)."""
    if dt.tzinfo is None:
        return dt.replace(tzinfo=UTC)
    return dt.astimezone(UTC)


def lagos_day_utc_bounds(day: date) -> tuple[datetime, datetime]:
    """UTC-naive [start, end) for a Lagos calendar day (expense/audit day filters)."""
    start_lagos = datetime.combine(day, time.min, tzinfo=BUSINESS_TZ)
    end_lagos = start_lagos + timedelta(days=1)
    return utc_naive_from(start_lagos), utc_naive_from(end_lagos)


def lagos_today_utc_bounds() -> tuple[datetime, datetime]:
    return lagos_day_utc_bounds(lagos_today())


def late_minutes_after_cutoff(
    check_in_at: datetime,
    *,
    cutoff: time = LATE_CUTOFF_TIME,
) -> int:
    """Minutes after cutoff on the Lagos calendar day of check-in; 0 if on time."""
    local = to_lagos(check_in_at)
    threshold = local.replace(hour=cutoff.hour, minute=cutoff.minute, second=0, microsecond=0)
    if local <= threshold:
        return 0
    return int((local - threshold).total_seconds() // 60)


def is_late_check_in(check_in_at: datetime, *, cutoff: time = LATE_CUTOFF_TIME) -> bool:
    return late_minutes_after_cutoff(check_in_at, cutoff=cutoff) > 0


def early_minutes_before_cutoff(
    check_out_at: datetime,
    *,
    cutoff: time = CHECK_OUT_TIME,
) -> int:
    """Minutes before cutoff on the Lagos calendar day of check-out; 0 if on time or after."""
    local = to_lagos(check_out_at)
    threshold = local.replace(hour=cutoff.hour, minute=cutoff.minute, second=0, microsecond=0)
    if local >= threshold:
        return 0
    return int((threshold - local).total_seconds() // 60)


def is_early_check_out(check_out_at: datetime, *, cutoff: time = CHECK_OUT_TIME) -> bool:
    return early_minutes_before_cutoff(check_out_at, cutoff=cutoff) > 0


def lagos_date_of(dt: datetime) -> date:
    return to_lagos(dt).date()
