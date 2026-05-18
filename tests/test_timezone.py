"""Timezone consistency: Africa/Lagos business logic and UTC storage."""

from __future__ import annotations

from datetime import datetime, timezone
from zoneinfo import ZoneInfo

from app.utils.timezone import (
    BUSINESS_TZ,
    datetime_for_api,
    lagos_today_utc_bounds,
    late_minutes_after_cutoff,
    now_lagos,
    to_lagos,
    utc_naive_from,
)

LAGOS = ZoneInfo("Africa/Lagos")


def test_late_cutoff_8_15_lagos():
    on_time = datetime(2026, 5, 15, 8, 15, 0, tzinfo=LAGOS)
    one_min_late = datetime(2026, 5, 15, 8, 16, 0, tzinfo=LAGOS)
    assert late_minutes_after_cutoff(on_time) == 0
    assert late_minutes_after_cutoff(one_min_late) == 1


def test_late_minutes_naive_utc_from_db():
    """DB stores UTC naive; 07:16 UTC = 08:16 Lagos → 1 minute late."""
    stored = datetime(2026, 5, 15, 7, 16, 0)  # naive UTC
    assert late_minutes_after_cutoff(stored) == 1


def test_utc_naive_round_trip_preserves_instant():
    lagos = datetime(2026, 5, 15, 9, 0, 0, tzinfo=LAGOS)
    stored = utc_naive_from(lagos)
    assert stored == datetime(2026, 5, 15, 8, 0, 0)
    assert to_lagos(stored).hour == 9


def test_datetime_for_api_adds_utc_offset():
    naive = datetime(2026, 5, 15, 8, 0, 0)
    api = datetime_for_api(naive)
    assert api.tzinfo == timezone.utc
    assert api.isoformat().endswith("+00:00")


def test_lagos_today_bounds_cover_full_wat_day():
    start, end = lagos_today_utc_bounds()
    assert end > start
    assert (end - start).total_seconds() == 86400


def test_now_lagos_is_wat():
    n = now_lagos()
    assert n.tzinfo is not None
    assert str(n.tzinfo) in ("Africa/Lagos", "UTC+01:00")
