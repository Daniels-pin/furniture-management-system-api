from __future__ import annotations

import csv
import io
import logging
import uuid
import math
from collections import defaultdict
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Optional
from datetime import date as date_type, datetime, time, timedelta

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import StreamingResponse
from sqlalchemy import and_, extract, func, or_
from sqlalchemy.orm import Session, joinedload

from app import models
from app.auth.auth import get_current_user, normalize_role, require_role
from app.database import get_db
from app.utils.cloudinary import upload_asset
from app.utils.financial_audit import log_financial_action
from app.utils.timezone import (
    early_minutes_before_cutoff,
    lagos_date_of,
    lagos_today,
    late_minutes_after_cutoff,
    now_lagos,
    now_utc_naive,
    to_lagos,
    utc_naive_from,
)

logger = logging.getLogger(__name__)
from app.schemas import (
    CompanyLocationOut,
    EmployeeLocationAssignmentItemOut,
    EmployeeLocationAssignmentPatchOut,
    EmployeeAdminUpdate,
    EmployeeBonusCreate,
    EmployeeBonusOut,
    EmployeeCreate,
    EmployeeLatenessCreate,
    EmployeeLatenessEntryOut,
    EmployeeListItemOut,
    EmployeeOut,
    EmployeePaymentOut,
    EmployeePaymentUpdate,
    EmployeePayrollAdjustmentIn,
    EmployeePenaltyCreate,
    EmployeePenaltyOut,
    EmployeeSalaryBreakdown,
    EmployeeSelfUpdate,
    EmployeeSendPaymentToFinance,
    EmployeeTransactionOut,
    EmployeeAttendanceEntryOut,
    EmployeeAttendanceHistoryOut,
    EmployeeAttendanceHistoryPageOut,
    EmployeeAttendanceMonthSummaryOut,
    EmployeeAttendanceOverviewOut,
    EmployeeAttendanceStatsOut,
    AttendanceMonitorFilterStatus,
    AttendanceMonitorOut,
    AttendanceMonitorRowOut,
    AttendanceMonitorSummaryOut,
    EmployeeClockInOut,
    EmployeeClockInGeoIn,
    EmployeeClockOutOut,
    EmployeeSignOutPreviewOut,
    EmployeeWorkLocationAssignIn,
    PayrollPeriodsNavOut,
    PayrollSummaryOut,
    SalaryPeriodOut,
)

router = APIRouter(prefix="/employees", tags=["Employees"])

# Completed sessions shorter than this are flagged as short_session (unless early check-out already applies).
MIN_ATTENDANCE_SESSION_MINUTES = 30

SHIFT_MORNING = "morning"
SHIFT_FULL_DAY = "full_day"
VALID_SHIFTS = frozenset({SHIFT_MORNING, SHIFT_FULL_DAY})

_MONTH_NAMES = (
    "",
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
)


def _month_label(year: int, month: int) -> str:
    return f"{_MONTH_NAMES[month]} {year}"


def _can_view_attendance_oversight(user) -> bool:
    role = normalize_role(getattr(user, "role", None))
    return role in ("admin", "factory")


def _require_attendance_oversight(user) -> None:
    if not _can_view_attendance_oversight(user):
        raise HTTPException(status_code=403, detail="Not authorized")


def _is_admin(user) -> bool:
    return normalize_role(getattr(user, "role", None)) == "admin"


MONTH_PAYMENT_PAID = "paid"
MONTH_PAYMENT_PENDING = "pending_payment"


def _next_calendar_month(year: int, month: int) -> tuple[int, int]:
    if month == 12:
        return year + 1, 1
    return year, month + 1


def _ym_key(year: int, month: int) -> tuple[int, int]:
    return year, month


def _ym_from_datetime(dt: datetime) -> tuple[int, int]:
    d = lagos_date_of(dt)
    return d.year, d.month


def _ym_on_or_after(year: int, month: int, start: tuple[int, int]) -> bool:
    return (year, month) >= start


def _first_operational_payroll_month(db: Session) -> Optional[tuple[int, int]]:
    """First calendar month with monthly payroll activity (earliest hire or period data)."""
    candidates: list[tuple[int, int]] = []
    hire = db.query(func.min(models.Employee.created_at)).scalar()
    if hire is not None:
        candidates.append(_ym_from_datetime(hire))
    data_ids = _period_ids_with_any_data(db)
    if data_ids:
        earliest = (
            db.query(models.SalaryPeriod)
            .filter(models.SalaryPeriod.id.in_(data_ids))
            .order_by(models.SalaryPeriod.year.asc(), models.SalaryPeriod.month.asc())
            .first()
        )
        if earliest is not None:
            candidates.append(_ym_key(earliest.year, earliest.month))
    if not candidates:
        return None
    return min(candidates)


def _employee_ids_with_period_footprint(db: Session, period_id: int) -> set[int]:
    ids: set[int] = set()
    for model in (
        models.EmployeeLatenessEntry,
        models.EmployeeEarlySignOutEntry,
        models.EmployeeAbsenceEntry,
        models.EmployeePenalty,
        models.EmployeeBonus,
        models.EmployeePeriodPayroll,
    ):
        for (eid,) in db.query(model.employee_id).filter(model.period_id == period_id).distinct():
            ids.add(int(eid))
    return ids


def _employee_ids_for_period(db: Session, period: models.SalaryPeriod) -> list[int]:
    """Active month: current roster. Archived months: frozen period footprint only."""
    if period.is_active:
        return _active_employee_ids(db)
    return sorted(_employee_ids_with_period_footprint(db, period.id))


def _employees_for_period(db: Session, period: models.SalaryPeriod) -> list[models.Employee]:
    emp_ids = _employee_ids_for_period(db, period)
    if not emp_ids:
        return []
    q = db.query(models.Employee).filter(models.Employee.id.in_(emp_ids))
    if period.is_active:
        q = q.filter(models.Employee.deleted_at.is_(None))
    return q.options(joinedload(models.Employee.work_location)).order_by(models.Employee.id.asc()).all()


def _snapshot_period_roster(db: Session, period: models.SalaryPeriod) -> None:
    """Persist payroll rows for the period roster when a month is archived."""
    ids = set(_employee_ids_with_period_footprint(db, period.id))
    ids.update(_active_employee_ids(db))
    for eid in ids:
        _get_or_create_payroll_row(db, eid, period.id)
    db.flush()


def _bootstrap_employee_payroll(db: Session, emp: models.Employee) -> None:
    """Ensure active payroll month exists and the new hire is on the roster."""
    ensure_payroll_periods_current(db)
    period = get_active_period(db)
    if period is None:
        return
    _get_or_create_payroll_row(db, emp.id, period.id)


def get_or_create_period(db: Session, year: int, month: int) -> models.SalaryPeriod:
    if month < 1 or month > 12:
        raise HTTPException(status_code=400, detail="month must be between 1 and 12")
    first = _first_operational_payroll_month(db)
    if first is not None and not _ym_on_or_after(year, month, first):
        existing = db.query(models.SalaryPeriod).filter_by(year=year, month=month).first()
        if existing is not None:
            return existing
        raise HTTPException(status_code=404, detail="Payroll is not tracked before the first monthly employee month.")
    p = db.query(models.SalaryPeriod).filter_by(year=year, month=month).first()
    if p:
        return p
    p = models.SalaryPeriod(
        year=year,
        month=month,
        label=_month_label(year, month),
        is_active=False,
        month_payment_status=MONTH_PAYMENT_PENDING,
    )
    db.add(p)
    db.flush()
    return p


def get_active_period(db: Session) -> Optional[models.SalaryPeriod]:
    return db.query(models.SalaryPeriod).filter(models.SalaryPeriod.is_active.is_(True)).first()


def _active_employee_ids(db: Session) -> list[int]:
    return [
        int(eid)
        for (eid,) in db.query(models.Employee.id).filter(models.Employee.deleted_at.is_(None)).all()
    ]


def _period_payment_counts(db: Session, period: models.SalaryPeriod) -> tuple[int, int]:
    """Return (paid_count, total_employees) for this period's roster."""
    emp_ids = _employee_ids_for_period(db, period)
    total = len(emp_ids)
    if total == 0:
        return 0, 0
    paid = (
        db.query(func.count(models.EmployeePeriodPayroll.id))
        .filter(
            models.EmployeePeriodPayroll.period_id == period.id,
            models.EmployeePeriodPayroll.employee_id.in_(emp_ids),
            models.EmployeePeriodPayroll.payment_status == "paid",
        )
        .scalar()
        or 0
    )
    return int(paid), total


def _all_active_employees_paid_for_period(db: Session, period_id: int) -> bool:
    period = db.query(models.SalaryPeriod).filter(models.SalaryPeriod.id == period_id).first()
    if period is None:
        return False
    paid, total = _period_payment_counts(db, period)
    return total > 0 and paid == total


def _try_auto_mark_period_month_paid(db: Session, period_id: int, actor_user=None) -> bool:
    """When every roster employee is paid, mark the salary period month as paid."""
    period = db.query(models.SalaryPeriod).filter(models.SalaryPeriod.id == period_id).first()
    if period is None or period.month_payment_status == MONTH_PAYMENT_PAID:
        return False
    if not _all_active_employees_paid_for_period(db, period_id):
        return False
    period.month_payment_status = MONTH_PAYMENT_PAID
    period.month_paid_at = now_utc_naive()
    if actor_user is not None:
        period.month_paid_by_id = actor_user.id
    db.flush()
    return True


def _mark_unpaid_roster_employees_paid(
    db: Session,
    period: models.SalaryPeriod,
    actor_user,
    paid_at: Optional[datetime] = None,
) -> int:
    """Mark unpaid roster employees paid for this period (payment flags only; no salary recalc)."""
    paid_at = paid_at or now_utc_naive()
    updated = 0
    for eid in _employee_ids_for_period(db, period):
        row = _get_or_create_payroll_row(db, eid, period.id)
        if row.payment_status == "paid":
            continue
        row.payment_status = "paid"
        row.payment_date = paid_at
        row.updated_at = paid_at
        row.updated_by_id = getattr(actor_user, "id", None)
        updated += 1
    db.flush()
    return updated


def ensure_payroll_periods_current(db: Session) -> Optional[models.SalaryPeriod]:
    """Ensure payroll months exist from first hire through today; archive the outgoing active month."""
    first = _first_operational_payroll_month(db)
    if first is None:
        db.query(models.SalaryPeriod).update({models.SalaryPeriod.is_active: False}, synchronize_session=False)
        db.flush()
        return None

    now = now_lagos()
    cy, cm = now.year, now.month
    if not _ym_on_or_after(cy, cm, first):
        db.query(models.SalaryPeriod).update({models.SalaryPeriod.is_active: False}, synchronize_session=False)
        db.flush()
        return None

    active = get_active_period(db)
    if active is not None and active.year == cy and active.month == cm:
        return active
    if active is not None and (active.year, active.month) > (cy, cm):
        return active

    if active is not None and (active.year, active.month) < (cy, cm):
        _snapshot_period_roster(db, active)

    if active is not None:
        y, m = _next_calendar_month(active.year, active.month)
        while (y, m) <= (cy, cm):
            if _ym_on_or_after(y, m, first):
                get_or_create_period(db, y, m)
            y, m = _next_calendar_month(y, m)
    elif _ym_on_or_after(cy, cm, first):
        get_or_create_period(db, cy, cm)

    current = get_or_create_period(db, cy, cm)
    db.query(models.SalaryPeriod).update({models.SalaryPeriod.is_active: False}, synchronize_session=False)
    current.is_active = True
    db.flush()
    return current


def _salary_period_out(db: Session, period: models.SalaryPeriod) -> SalaryPeriodOut:
    paid, total = _period_payment_counts(db, period)
    status = period.month_payment_status or MONTH_PAYMENT_PENDING
    if status != MONTH_PAYMENT_PAID and total > 0 and paid == total:
        status = MONTH_PAYMENT_PAID
    return SalaryPeriodOut(
        id=period.id,
        year=period.year,
        month=period.month,
        label=period.label,
        is_active=bool(period.is_active),
        month_payment_status=status,  # type: ignore[arg-type]
        paid_employee_count=paid,
        total_employee_count=total,
        month_paid_at=period.month_paid_at,
    )


def _is_sunday(d: date_type) -> bool:
    # Python weekday(): Monday=0 ... Sunday=6
    return d.weekday() == 6


def _decimal_fee(value) -> Decimal:
    return Decimal(str(value or 0))


def _shift_label(shift: str | None) -> str | None:
    if shift == SHIFT_MORNING:
        return "Morning Shift"
    if shift == SHIFT_FULL_DAY:
        return "Full Day Shift"
    return None


def _location_late_fee(loc: models.CompanyLocation | None) -> Decimal:
    if loc is None:
        return Decimal("0")
    return _decimal_fee(getattr(loc, "late_coming_fee_naira", 0))


def _location_early_sign_out_fee(loc: models.CompanyLocation | None) -> Decimal:
    if loc is None:
        return Decimal("0")
    return _decimal_fee(getattr(loc, "early_sign_out_fee_naira", 0))


def _location_absence_fee(loc: models.CompanyLocation | None) -> Decimal:
    if loc is None:
        return Decimal("0")
    return _decimal_fee(getattr(loc, "absence_fee_naira", 0))


def _shift_times_for_location(loc: models.CompanyLocation, shift: str) -> tuple[time, time]:
    if shift == SHIFT_MORNING:
        late_t = getattr(loc, "morning_shift_late_time", None)
        close_t = getattr(loc, "morning_shift_closing_time", None)
    elif shift == SHIFT_FULL_DAY:
        late_t = getattr(loc, "full_day_shift_late_time", None)
        close_t = getattr(loc, "full_day_shift_closing_time", None)
    else:
        raise HTTPException(status_code=400, detail="Invalid shift selection.")
    if late_t is None or close_t is None:
        raise HTTPException(status_code=409, detail="Shift times are not configured for this location.")
    return late_t, close_t


def _attendance_times_for_check_in(
    loc: models.CompanyLocation,
    shift: str | None,
) -> tuple[time, time, str | None]:
    """Return (late_time, closing_time, selected_shift) for a new attendance row."""
    if bool(getattr(loc, "shift_mode_enabled", False)):
        if shift not in VALID_SHIFTS:
            raise HTTPException(
                status_code=400,
                detail="Select today's shift before checking in.",
            )
        late_t, close_t = _shift_times_for_location(loc, shift)
        return late_t, close_t, shift
    return loc.late_attendance_time, loc.check_out_time, None


def _late_minutes(check_in_at: datetime, *, cutoff: time) -> int:
    """Minutes after the location cutoff on the Lagos calendar day of check-in."""
    return late_minutes_after_cutoff(check_in_at, cutoff=cutoff)


def _early_check_out_minutes(check_out_at: datetime, *, cutoff: time) -> int:
    """Minutes before the location closing time on the Lagos calendar day of check-out."""
    return early_minutes_before_cutoff(check_out_at, cutoff=cutoff)


def _late_cutoff_for_location(loc: models.CompanyLocation | None) -> time:
    if loc is None:
        raise HTTPException(status_code=409, detail="Work location is required for attendance rules.")
    return loc.late_attendance_time


def _late_cutoff_for_attendance_row(
    r: models.EmployeeAttendanceEntry,
    loc: models.CompanyLocation | None = None,
) -> time:
    stored = getattr(r, "expected_late_time", None)
    if stored is not None:
        return stored
    shift = getattr(r, "selected_shift", None)
    if loc is not None and shift in VALID_SHIFTS:
        late_t, _ = _shift_times_for_location(loc, shift)
        return late_t
    if loc is not None:
        return loc.late_attendance_time
    raise HTTPException(status_code=409, detail="Attendance rules are unavailable for this record.")


def _late_cutoff_for_employee(db: Session, emp: models.Employee) -> time:
    loc_id = getattr(emp, "work_location_id", None)
    if loc_id is None:
        raise HTTPException(status_code=409, detail="No work location assigned.")
    loc = db.query(models.CompanyLocation).filter(models.CompanyLocation.id == int(loc_id)).first()
    if loc is None:
        raise HTTPException(status_code=409, detail="Assigned work location no longer exists.")
    return _late_cutoff_for_location(loc)


def _last_day_of_month(year: int, month: int) -> date_type:
    if month == 12:
        return date_type(year + 1, 1, 1) - timedelta(days=1)
    return date_type(year, month + 1, 1) - timedelta(days=1)


def _work_location_assigned_date(emp: models.Employee) -> Optional[date_type]:
    at = getattr(emp, "work_location_assigned_at", None)
    if at is None:
        return None
    return lagos_date_of(at)


def _attendance_deductions_apply(db: Session, emp: models.Employee, period_id: int) -> bool:
    """Lateness/absence payroll deductions require an assigned work location (unpaid periods only)."""
    if _period_paid(db, emp.id, period_id):
        return True
    return emp.work_location_id is not None


def _set_work_location_assignment(emp: models.Employee, location_id: Optional[int]) -> None:
    """Assign or clear work location; stamp assignment time when a location is set."""
    if location_id is not None:
        new_id = int(location_id)
        if emp.work_location_id != new_id:
            emp.work_location_assigned_at = now_utc_naive()
        emp.work_location_id = new_id
    else:
        emp.work_location_id = None
        emp.work_location_assigned_at = None


def _sync_absence_entries_for_period(db: Session, employee_id: int, period: models.SalaryPeriod) -> None:
    """Create absence rows for past workdays in period with no attendance (Sundays excluded)."""
    if _period_paid(db, employee_id, period.id):
        return
    emp = db.query(models.Employee).filter(models.Employee.id == employee_id).first()
    if emp is None or emp.work_location_id is None:
        return
    today = lagos_today()
    start = date_type(period.year, period.month, 1)
    assigned = _work_location_assigned_date(emp)
    if assigned is not None and start < assigned:
        start = assigned
    end = min(today - timedelta(days=1), _last_day_of_month(period.year, period.month))
    if end < start:
        return

    attended = {
        d
        for (d,) in db.query(models.EmployeeAttendanceEntry.attendance_date)
        .filter(
            models.EmployeeAttendanceEntry.employee_id == employee_id,
            models.EmployeeAttendanceEntry.attendance_date >= start,
            models.EmployeeAttendanceEntry.attendance_date <= end,
        )
        .all()
    }
    existing_absence = {
        d
        for (d,) in db.query(models.EmployeeAbsenceEntry.absence_date)
        .filter(
            models.EmployeeAbsenceEntry.employee_id == employee_id,
            models.EmployeeAbsenceEntry.absence_date >= start,
            models.EmployeeAbsenceEntry.absence_date <= end,
            models.EmployeeAbsenceEntry.voided_at.is_(None),
        )
        .all()
    }

    loc = None
    if emp.work_location_id is not None:
        loc = db.query(models.CompanyLocation).filter(models.CompanyLocation.id == emp.work_location_id).first()
    absence_fee = _location_absence_fee(loc)

    day = start
    while day <= end:
        if not _is_sunday(day) and day not in attended and day not in existing_absence:
            note = f"Absence: no attendance marked for {day.isoformat()}"
            db.add(
                models.EmployeeAbsenceEntry(
                    employee_id=employee_id,
                    period_id=period.id,
                    absence_date=day,
                    deduction_amount_naira=absence_fee,
                    note=note,
                )
            )
            existing_absence.add(day)
        day += timedelta(days=1)


def _ensure_absences_synced(db: Session, employee_id: int) -> None:
    """Sync absence penalties for recent payroll months (active + last two calendar months)."""
    first = _first_operational_payroll_month(db)
    if first is None:
        return
    today = lagos_today()
    y, m = today.year, today.month
    seen: set[int] = set()
    for _ in range(3):
        if not _ym_on_or_after(y, m, first):
            break
        period = get_or_create_period(db, y, m)
        if period.is_active and period.id not in seen:
            seen.add(period.id)
            _sync_absence_entries_for_period(db, employee_id, period)
        if m == 1:
            y, m = y - 1, 12
        else:
            m -= 1
    ap = get_active_period(db)
    if ap and ap.is_active and ap.id not in seen:
        _sync_absence_entries_for_period(db, employee_id, ap)
    db.flush()


def _remove_absence_for_date(db: Session, employee_id: int, day: date_type) -> None:
    """Remove auto-absence row when attendance is marked for that day."""
    db.query(models.EmployeeAbsenceEntry).filter(
        models.EmployeeAbsenceEntry.employee_id == employee_id,
        models.EmployeeAbsenceEntry.absence_date == day,
        models.EmployeeAbsenceEntry.voided_at.is_(None),
    ).delete(synchronize_session=False)


def _absence_count_for_period(
    db: Session,
    employee_id: int,
    period: models.SalaryPeriod,
    *,
    skip_sync: bool = False,
) -> int:
    emp = db.query(models.Employee).filter(models.Employee.id == employee_id).first()
    if emp is None:
        return 0
    paid = _period_paid(db, employee_id, period.id)
    if not paid and emp.work_location_id is None:
        return 0
    if (
        not skip_sync
        and period.is_active
        and (paid or emp.work_location_id is not None)
    ):
        _sync_absence_entries_for_period(db, employee_id, period)
    q = (
        db.query(models.EmployeeAbsenceEntry)
        .filter_by(employee_id=employee_id, period_id=period.id)
        .filter(models.EmployeeAbsenceEntry.voided_at.is_(None))
    )
    if not paid:
        assigned = _work_location_assigned_date(emp)
        if assigned is not None:
            q = q.filter(models.EmployeeAbsenceEntry.absence_date >= assigned)
    return q.count()


def _lateness_count_for_payroll(db: Session, emp: models.Employee, period_id: int) -> int:
    if not _attendance_deductions_apply(db, emp, period_id):
        return 0
    q = (
        db.query(func.count(models.EmployeeLatenessEntry.id))
        .filter(
            models.EmployeeLatenessEntry.employee_id == emp.id,
            models.EmployeeLatenessEntry.period_id == period_id,
            models.EmployeeLatenessEntry.voided_at.is_(None),
        )
    )
    if not _period_paid(db, emp.id, period_id):
        assigned = _work_location_assigned_date(emp)
        if assigned is not None:
            q = q.outerjoin(
                models.EmployeeAttendanceEntry,
                models.EmployeeLatenessEntry.attendance_id == models.EmployeeAttendanceEntry.id,
            ).filter(
                or_(
                    models.EmployeeAttendanceEntry.attendance_date >= assigned,
                    and_(
                        models.EmployeeLatenessEntry.attendance_id.is_(None),
                        func.date(models.EmployeeLatenessEntry.created_at) >= assigned,
                    ),
                )
            )
    return int(q.scalar() or 0)


def _check_out_time_for_location(loc: models.CompanyLocation | None) -> time:
    if loc is None:
        raise HTTPException(status_code=409, detail="Work location is required for attendance rules.")
    return loc.check_out_time


def _check_out_time_for_employee(db: Session, emp: models.Employee) -> time:
    loc_id = getattr(emp, "work_location_id", None)
    if loc_id is None:
        raise HTTPException(status_code=409, detail="No work location assigned.")
    loc = db.query(models.CompanyLocation).filter(models.CompanyLocation.id == int(loc_id)).first()
    if loc is None:
        raise HTTPException(status_code=409, detail="Assigned work location no longer exists.")
    return _check_out_time_for_location(loc)


def _closing_time_for_attendance_row(
    r: models.EmployeeAttendanceEntry,
    loc: models.CompanyLocation | None = None,
) -> time:
    """Closing-time snapshot for a row; prefers stored snapshot over current location config."""
    stored = getattr(r, "expected_check_out_time", None)
    if stored is not None:
        return stored
    if loc is None:
        loc = getattr(r, "work_location", None)
    shift = getattr(r, "selected_shift", None)
    if loc is not None and shift in VALID_SHIFTS:
        _, close_t = _shift_times_for_location(loc, shift)
        return close_t
    if loc is not None:
        return loc.check_out_time
    raise HTTPException(status_code=409, detail="Closing time is unavailable for this attendance record.")


def _attendance_duration_minutes(r: models.EmployeeAttendanceEntry) -> Optional[int]:
    if r.check_in_at is None or r.check_out_at is None:
        return None
    delta = to_lagos(r.check_out_at) - to_lagos(r.check_in_at)
    return max(0, int(delta.total_seconds() // 60))


def _early_check_out_minutes_for_row(r: models.EmployeeAttendanceEntry) -> Optional[int]:
    if r.check_out_at is None:
        return None
    stored = getattr(r, "early_check_out_minutes", None)
    if stored is not None:
        return int(stored)
    mins = _early_check_out_minutes(
        r.check_out_at,
        cutoff=_closing_time_for_attendance_row(r, getattr(r, "work_location", None)),
    )
    return mins if mins > 0 else None


def _is_early_check_out_row(r: models.EmployeeAttendanceEntry) -> bool:
    if r.check_out_at is None:
        return False
    if bool(getattr(r, "is_early_check_out", False)):
        return True
    return _early_check_out_minutes_for_row(r) is not None


def _resolve_attendance_status(
    r: models.EmployeeAttendanceEntry,
    *,
    today: date_type | None = None,
) -> str:
    """Derive history status without altering stored payroll rows."""
    today = today or lagos_today()
    is_late = bool(r.is_late)
    has_check_out = r.check_out_at is not None
    is_today = r.attendance_date == today

    if not has_check_out:
        if is_today:
            return "checked_in"
        return "incomplete_day"

    is_early = _is_early_check_out_row(r)
    duration = _attendance_duration_minutes(r)
    is_short = duration is not None and duration < MIN_ATTENDANCE_SESSION_MINUTES

    if is_late and is_early:
        return "late_early_check_out"
    if is_early:
        return "early_check_out"
    if is_late:
        return "late"
    if is_short:
        return "short_session"
    return "present"


def _lateness_deduction_sum_for_payroll(db: Session, emp: models.Employee, period_id: int) -> Decimal:
    if not _attendance_deductions_apply(db, emp, period_id):
        return Decimal("0")
    q = (
        db.query(func.coalesce(func.sum(models.EmployeeLatenessEntry.deduction_amount_naira), 0))
        .filter(
            models.EmployeeLatenessEntry.employee_id == emp.id,
            models.EmployeeLatenessEntry.period_id == period_id,
            models.EmployeeLatenessEntry.voided_at.is_(None),
        )
    )
    if not _period_paid(db, emp.id, period_id):
        assigned = _work_location_assigned_date(emp)
        if assigned is not None:
            q = q.outerjoin(
                models.EmployeeAttendanceEntry,
                models.EmployeeLatenessEntry.attendance_id == models.EmployeeAttendanceEntry.id,
            ).filter(
                or_(
                    models.EmployeeAttendanceEntry.attendance_date >= assigned,
                    and_(
                        models.EmployeeLatenessEntry.attendance_id.is_(None),
                        func.date(models.EmployeeLatenessEntry.created_at) >= assigned,
                    ),
                )
            )
    return _decimal_fee(q.scalar())


def _early_sign_out_count_for_payroll(db: Session, emp: models.Employee, period_id: int) -> int:
    if not _attendance_deductions_apply(db, emp, period_id):
        return 0
    q = (
        db.query(func.count(models.EmployeeEarlySignOutEntry.id))
        .filter(
            models.EmployeeEarlySignOutEntry.employee_id == emp.id,
            models.EmployeeEarlySignOutEntry.period_id == period_id,
            models.EmployeeEarlySignOutEntry.voided_at.is_(None),
        )
    )
    if not _period_paid(db, emp.id, period_id):
        assigned = _work_location_assigned_date(emp)
        if assigned is not None:
            q = q.outerjoin(
                models.EmployeeAttendanceEntry,
                models.EmployeeEarlySignOutEntry.attendance_id == models.EmployeeAttendanceEntry.id,
            ).filter(
                or_(
                    models.EmployeeAttendanceEntry.attendance_date >= assigned,
                    and_(
                        models.EmployeeEarlySignOutEntry.attendance_id.is_(None),
                        func.date(models.EmployeeEarlySignOutEntry.created_at) >= assigned,
                    ),
                )
            )
    return int(q.scalar() or 0)


def _early_sign_out_deduction_sum_for_payroll(db: Session, emp: models.Employee, period_id: int) -> Decimal:
    if not _attendance_deductions_apply(db, emp, period_id):
        return Decimal("0")
    q = (
        db.query(func.coalesce(func.sum(models.EmployeeEarlySignOutEntry.deduction_amount_naira), 0))
        .filter(
            models.EmployeeEarlySignOutEntry.employee_id == emp.id,
            models.EmployeeEarlySignOutEntry.period_id == period_id,
            models.EmployeeEarlySignOutEntry.voided_at.is_(None),
        )
    )
    if not _period_paid(db, emp.id, period_id):
        assigned = _work_location_assigned_date(emp)
        if assigned is not None:
            q = q.outerjoin(
                models.EmployeeAttendanceEntry,
                models.EmployeeEarlySignOutEntry.attendance_id == models.EmployeeAttendanceEntry.id,
            ).filter(
                or_(
                    models.EmployeeAttendanceEntry.attendance_date >= assigned,
                    and_(
                        models.EmployeeEarlySignOutEntry.attendance_id.is_(None),
                        func.date(models.EmployeeEarlySignOutEntry.created_at) >= assigned,
                    ),
                )
            )
    return _decimal_fee(q.scalar())


def _absence_deduction_sum_for_payroll(db: Session, emp: models.Employee, period: models.SalaryPeriod) -> Decimal:
    if not _attendance_deductions_apply(db, emp, period.id):
        return Decimal("0")
    ac = _absence_count_for_period(db, emp.id, period)
    if ac == 0:
        return Decimal("0")
    q = (
        db.query(func.coalesce(func.sum(models.EmployeeAbsenceEntry.deduction_amount_naira), 0))
        .filter(
            models.EmployeeAbsenceEntry.employee_id == emp.id,
            models.EmployeeAbsenceEntry.period_id == period.id,
            models.EmployeeAbsenceEntry.voided_at.is_(None),
        )
    )
    if not _period_paid(db, emp.id, period.id):
        assigned = _work_location_assigned_date(emp)
        if assigned is not None:
            q = q.filter(models.EmployeeAbsenceEntry.absence_date >= assigned)
    return _decimal_fee(q.scalar())


def _location_rates_for_employee(db: Session, emp: models.Employee) -> tuple[Decimal, Decimal, Decimal]:
    loc = None
    if emp.work_location_id is not None:
        loc = db.query(models.CompanyLocation).filter(models.CompanyLocation.id == emp.work_location_id).first()
    return (
        _location_late_fee(loc),
        _location_early_sign_out_fee(loc),
        _location_absence_fee(loc),
    )


def _create_lateness_entry(
    db: Session,
    *,
    emp: models.Employee,
    period_id: int,
    attendance_id: int,
    note: str,
    fee: Decimal,
) -> models.EmployeeLatenessEntry:
    existing = (
        db.query(models.EmployeeLatenessEntry)
        .filter(
            models.EmployeeLatenessEntry.attendance_id == attendance_id,
            models.EmployeeLatenessEntry.voided_at.is_(None),
        )
        .first()
    )
    if existing is not None:
        return existing
    le = models.EmployeeLatenessEntry(
        employee_id=emp.id,
        period_id=period_id,
        attendance_id=attendance_id,
        deduction_amount_naira=fee,
        note=note,
    )
    db.add(le)
    db.flush()
    return le


def _create_early_sign_out_entry(
    db: Session,
    *,
    emp: models.Employee,
    period_id: int,
    attendance_id: int,
    note: str,
    fee: Decimal,
) -> models.EmployeeEarlySignOutEntry:
    existing = (
        db.query(models.EmployeeEarlySignOutEntry)
        .filter(
            models.EmployeeEarlySignOutEntry.attendance_id == attendance_id,
            models.EmployeeEarlySignOutEntry.voided_at.is_(None),
        )
        .first()
    )
    if existing is not None:
        return existing
    row = models.EmployeeEarlySignOutEntry(
        employee_id=emp.id,
        period_id=period_id,
        attendance_id=attendance_id,
        deduction_amount_naira=fee,
        note=note,
    )
    db.add(row)
    db.flush()
    return row


def _attendance_history_from_row(
    r: models.EmployeeAttendanceEntry,
    *,
    lateness_entry_id: Optional[int] = None,
    today: date_type | None = None,
) -> EmployeeAttendanceHistoryOut:
    is_late = bool(r.is_late)
    late_id = lateness_entry_id
    if late_id is None:
        late_id = getattr(getattr(r, "lateness_entry", None), "id", None)
    is_early_check_out = _is_early_check_out_row(r)
    early_check_out_minutes = _early_check_out_minutes_for_row(r)
    attendance_duration_minutes = _attendance_duration_minutes(r)
    status = _resolve_attendance_status(r, today=today)
    early_id = getattr(getattr(r, "early_sign_out_entry", None), "id", None)
    loc = getattr(r, "work_location", None)
    late_fee = Decimal("0")
    if is_late and late_id is not None:
        le = getattr(r, "lateness_entry", None)
        late_fee = _decimal_fee(getattr(le, "deduction_amount_naira", None) if le else None)
        if late_fee <= 0:
            late_fee = _location_late_fee(loc)
    early_fee = Decimal("0")
    if is_early_check_out and early_id is not None:
        ese = getattr(r, "early_sign_out_entry", None)
        early_fee = _decimal_fee(getattr(ese, "deduction_amount_naira", None) if ese else None)
        if early_fee <= 0:
            early_fee = _location_early_sign_out_fee(loc)
    shift_key = getattr(r, "selected_shift", None)
    return EmployeeAttendanceHistoryOut(
        id=r.id,
        record_type="attendance",
        employee_id=r.employee_id,
        period_id=r.period_id,
        attendance_date=r.attendance_date,
        status=status,  # type: ignore[arg-type]
        check_in_at=r.check_in_at,
        check_out_at=r.check_out_at,
        selected_shift=shift_key if shift_key in VALID_SHIFTS else None,  # type: ignore[arg-type]
        shift_label=_shift_label(shift_key),
        expected_late_time=getattr(r, "expected_late_time", None),
        is_late=is_late,
        late_minutes=r.late_minutes,
        is_early_check_out=is_early_check_out,
        early_check_out_minutes=early_check_out_minutes,
        expected_check_out_time=getattr(r, "expected_check_out_time", None),
        attendance_duration_minutes=attendance_duration_minutes,
        late_deduction_naira=late_fee,
        early_sign_out_deduction_naira=early_fee,
        deduction_naira=late_fee + early_fee,
        lateness_entry_id=int(late_id) if late_id is not None else None,
        early_sign_out_entry_id=int(early_id) if early_id is not None else None,
        absence_entry_id=None,
        work_location_id=r.work_location_id,
        employee_latitude=r.employee_latitude,
        employee_longitude=r.employee_longitude,
        distance_meters=r.distance_meters,
        check_out_latitude=r.check_out_latitude,
        check_out_longitude=r.check_out_longitude,
        check_out_distance_meters=r.check_out_distance_meters,
        work_location=CompanyLocationOut.model_validate(r.work_location) if getattr(r, "work_location", None) else None,
    )


def _attendance_row_to_history(
    r: models.EmployeeAttendanceEntry,
    *,
    lateness_entry_id: Optional[int] = None,
) -> EmployeeAttendanceHistoryOut:
    return _attendance_history_from_row(r, lateness_entry_id=lateness_entry_id)


def _build_attendance_history(
    db: Session,
    employee_id: int,
    *,
    limit: int,
    offset: int,
) -> list[EmployeeAttendanceHistoryOut]:
    # Cap to ~13 months of history (max API limit is 366) instead of loading all lifetime rows.
    today = lagos_today()
    window_start = today - timedelta(days=400)
    end = today + timedelta(days=1)
    items = _attendance_history_items_for_range(
        db,
        employee_id,
        start=window_start,
        end=end,
        sync_absences=True,
    )
    return items[offset : offset + limit]


MONITOR_FILTER_STATUSES = frozenset(
    {"present", "late", "early_sign_out", "absent", "checked_in", "incomplete_day"}
)


def _monitor_filter_status(raw_status: str) -> str:
    if raw_status in ("present", "short_session"):
        return "present"
    if raw_status in ("late", "late_early_check_out"):
        return "late"
    if raw_status in ("early_check_out", "late_early_check_out"):
        return "early_sign_out"
    if raw_status == "checked_in":
        return "checked_in"
    if raw_status == "incomplete_day":
        return "incomplete_day"
    if raw_status == "absent":
        return "absent"
    return "present"


def _attendance_assigned_employees(db: Session) -> list[models.Employee]:
    return (
        db.query(models.Employee)
        .options(joinedload(models.Employee.work_location))
        .filter(
            models.Employee.deleted_at.is_(None),
            models.Employee.work_location_id.isnot(None),
        )
        .order_by(models.Employee.full_name.asc(), models.Employee.id.asc())
        .all()
    )


def _absence_history_item(
    a: models.EmployeeAbsenceEntry,
) -> EmployeeAttendanceHistoryOut:
    return EmployeeAttendanceHistoryOut(
        id=a.id,
        record_type="absence",
        employee_id=a.employee_id,
        period_id=a.period_id,
        attendance_date=a.absence_date,
        status="absent",
        check_in_at=None,
        check_out_at=None,
        is_late=False,
        late_minutes=None,
        is_early_check_out=False,
        early_check_out_minutes=None,
        expected_check_out_time=None,
        attendance_duration_minutes=None,
        late_deduction_naira=Decimal("0"),
        early_sign_out_deduction_naira=Decimal("0"),
        deduction_naira=_decimal_fee(getattr(a, "deduction_amount_naira", 0)),
        lateness_entry_id=None,
        early_sign_out_entry_id=None,
        absence_entry_id=a.id,
        work_location_id=None,
        employee_latitude=None,
        employee_longitude=None,
        distance_meters=None,
        check_out_latitude=None,
        check_out_longitude=None,
        check_out_distance_meters=None,
        work_location=None,
    )



def _month_bounds(year: int, month: int) -> tuple[date_type, date_type]:
    start = date_type(year, month, 1)
    if month == 12:
        end = date_type(year + 1, 1, 1)
    else:
        end = date_type(year, month + 1, 1)
    return start, end


def _attendance_history_items_for_range(
    db: Session,
    employee_id: int,
    *,
    start: date_type,
    end: date_type,
    sync_absences: bool = False,
) -> list[EmployeeAttendanceHistoryOut]:
    if sync_absences:
        _ensure_absences_synced(db, employee_id)

    att_rows = (
        db.query(models.EmployeeAttendanceEntry)
        .filter(
            models.EmployeeAttendanceEntry.employee_id == employee_id,
            models.EmployeeAttendanceEntry.attendance_date >= start,
            models.EmployeeAttendanceEntry.attendance_date < end,
        )
        .order_by(models.EmployeeAttendanceEntry.attendance_date.desc(), models.EmployeeAttendanceEntry.id.desc())
        .all()
    )
    abs_rows = (
        db.query(models.EmployeeAbsenceEntry)
        .filter(
            models.EmployeeAbsenceEntry.employee_id == employee_id,
            models.EmployeeAbsenceEntry.absence_date >= start,
            models.EmployeeAbsenceEntry.absence_date < end,
            models.EmployeeAbsenceEntry.voided_at.is_(None),
        )
        .order_by(models.EmployeeAbsenceEntry.absence_date.desc(), models.EmployeeAbsenceEntry.id.desc())
        .all()
    )

    items: list[EmployeeAttendanceHistoryOut] = []
    today = lagos_today()
    for r in att_rows:
        late_id = getattr(getattr(r, "lateness_entry", None), "id", None)
        items.append(
            _attendance_history_from_row(
                r,
                lateness_entry_id=int(late_id) if late_id is not None else None,
                today=today,
            )
        )
    for a in abs_rows:
        items.append(_absence_history_item(a))

    items.sort(key=lambda x: (x.attendance_date, 0 if x.record_type == "attendance" else 1), reverse=True)
    return items


def _collect_attendance_history_items(
    db: Session,
    employee_id: int,
    *,
    sync_absences: bool,
) -> list[EmployeeAttendanceHistoryOut]:
    if sync_absences:
        _ensure_absences_synced(db, employee_id)

    att_rows = (
        db.query(models.EmployeeAttendanceEntry)
        .filter(models.EmployeeAttendanceEntry.employee_id == employee_id)
        .order_by(models.EmployeeAttendanceEntry.attendance_date.desc(), models.EmployeeAttendanceEntry.id.desc())
        .all()
    )
    abs_rows = (
        db.query(models.EmployeeAbsenceEntry)
        .filter(
            models.EmployeeAbsenceEntry.employee_id == employee_id,
            models.EmployeeAbsenceEntry.voided_at.is_(None),
        )
        .order_by(models.EmployeeAbsenceEntry.absence_date.desc(), models.EmployeeAbsenceEntry.id.desc())
        .all()
    )

    items: list[EmployeeAttendanceHistoryOut] = []
    today = lagos_today()
    for r in att_rows:
        late_id = getattr(getattr(r, "lateness_entry", None), "id", None)
        items.append(
            _attendance_history_from_row(
                r,
                lateness_entry_id=int(late_id) if late_id is not None else None,
                today=today,
            )
        )
    for a in abs_rows:
        items.append(_absence_history_item(a))

    items.sort(key=lambda x: (x.attendance_date, 0 if x.record_type == "attendance" else 1), reverse=True)
    return items


def _build_attendance_history_page(
    db: Session,
    employee_id: int,
    *,
    year: int,
    month: int,
    limit: int,
    offset: int,
) -> tuple[list[EmployeeAttendanceHistoryOut], int]:
    start, end = _month_bounds(year, month)
    items = _attendance_history_items_for_range(
        db,
        employee_id,
        start=start,
        end=end,
        sync_absences=True,
    )
    total = len(items)
    return items[offset : offset + limit], total


def _attendance_month_summaries(
    db: Session,
    employee_id: int,
) -> list[EmployeeAttendanceMonthSummaryOut]:
    _ensure_absences_synced(db, employee_id)
    counts: dict[tuple[int, int], int] = {}

    att_groups = (
        db.query(
            extract("year", models.EmployeeAttendanceEntry.attendance_date),
            extract("month", models.EmployeeAttendanceEntry.attendance_date),
            func.count(),
        )
        .filter(models.EmployeeAttendanceEntry.employee_id == employee_id)
        .group_by(
            extract("year", models.EmployeeAttendanceEntry.attendance_date),
            extract("month", models.EmployeeAttendanceEntry.attendance_date),
        )
        .all()
    )
    for y_val, m_val, count in att_groups:
        counts[(int(y_val), int(m_val))] = counts.get((int(y_val), int(m_val)), 0) + int(count)

    abs_groups = (
        db.query(
            extract("year", models.EmployeeAbsenceEntry.absence_date),
            extract("month", models.EmployeeAbsenceEntry.absence_date),
            func.count(),
        )
        .filter(
            models.EmployeeAbsenceEntry.employee_id == employee_id,
            models.EmployeeAbsenceEntry.voided_at.is_(None),
        )
        .group_by(
            extract("year", models.EmployeeAbsenceEntry.absence_date),
            extract("month", models.EmployeeAbsenceEntry.absence_date),
        )
        .all()
    )
    for y_val, m_val, count in abs_groups:
        key = (int(y_val), int(m_val))
        counts[key] = counts.get(key, 0) + int(count)

    today = lagos_today()
    counts.setdefault((today.year, today.month), 0)

    out: list[EmployeeAttendanceMonthSummaryOut] = []
    for (y, m), count in sorted(counts.items(), reverse=True):
        label = date_type(y, m, 1).strftime("%B %Y")
        out.append(EmployeeAttendanceMonthSummaryOut(year=y, month=m, label=label, record_count=count))
    return out


def _attendance_stats_for_month(
    db: Session,
    employee_id: int,
    *,
    year: int,
    month: int,
) -> EmployeeAttendanceStatsOut:
    start, end = _month_bounds(year, month)
    month_items = _attendance_history_items_for_range(
        db,
        employee_id,
        start=start,
        end=end,
        sync_absences=True,
    )
    counts = {
        "present": 0,
        "late": 0,
        "early_sign_out": 0,
        "absent": 0,
        "checked_in_only": 0,
        "incomplete_day": 0,
    }
    for item in month_items:
        key = _monitor_filter_status(item.status)
        if key in counts:
            counts[key] += 1
    return EmployeeAttendanceStatsOut(year=year, month=month, **counts)


def _monitor_row_for_employee(
    db: Session,
    emp: models.Employee,
    *,
    target_date: date_type,
    today: date_type,
    att_by_emp: dict[int, models.EmployeeAttendanceEntry],
    abs_by_emp: dict[int, models.EmployeeAbsenceEntry],
) -> AttendanceMonitorRowOut | None:
    if _is_sunday(target_date):
        return None

    att = att_by_emp.get(emp.id)
    if att is not None:
        history = _attendance_history_from_row(att, today=today)
        raw_status = history.status
        return AttendanceMonitorRowOut(
            employee_id=emp.id,
            full_name=emp.full_name or "",
            work_location=CompanyLocationOut.model_validate(emp.work_location) if emp.work_location else None,
            shift_label=history.shift_label,
            check_in_at=history.check_in_at,
            check_out_at=history.check_out_at,
            status=raw_status,  # type: ignore[arg-type]
            monitor_filter_status=_monitor_filter_status(raw_status),  # type: ignore[arg-type]
        )

    abs_row = abs_by_emp.get(emp.id)
    if abs_row is not None or target_date < today or target_date == today:
        return AttendanceMonitorRowOut(
            employee_id=emp.id,
            full_name=emp.full_name or "",
            work_location=CompanyLocationOut.model_validate(emp.work_location) if emp.work_location else None,
            shift_label=None,
            check_in_at=None,
            check_out_at=None,
            status="absent",
            monitor_filter_status="absent",
        )
    return None


def _build_attendance_monitor(
    db: Session,
    *,
    target_date: date_type,
    search: str = "",
    status_filter: str | None = None,
    location_id: int | None = None,
    limit: int | None = None,
    offset: int = 0,
) -> AttendanceMonitorOut:
    today = lagos_today()
    employees = _attendance_assigned_employees(db)
    s = (search or "").strip().lower()
    if s:
        employees = [e for e in employees if s in (e.full_name or "").lower()]
    if location_id is not None:
        employees = [e for e in employees if e.work_location_id == location_id]

    emp_ids = [e.id for e in employees]
    att_rows: list[models.EmployeeAttendanceEntry] = []
    abs_rows: list[models.EmployeeAbsenceEntry] = []
    if emp_ids:
        att_rows = (
            db.query(models.EmployeeAttendanceEntry)
            .filter(
                models.EmployeeAttendanceEntry.employee_id.in_(emp_ids),
                models.EmployeeAttendanceEntry.attendance_date == target_date,
            )
            .all()
        )
        abs_rows = (
            db.query(models.EmployeeAbsenceEntry)
            .filter(
                models.EmployeeAbsenceEntry.employee_id.in_(emp_ids),
                models.EmployeeAbsenceEntry.absence_date == target_date,
                models.EmployeeAbsenceEntry.voided_at.is_(None),
            )
            .all()
        )

    att_by_emp = {r.employee_id: r for r in att_rows}
    abs_by_emp = {r.employee_id: r for r in abs_rows}

    summary_counts = {
        "expected_employees": 0,
        "present": 0,
        "late": 0,
        "early_sign_out": 0,
        "absent": 0,
        "checked_in_only": 0,
        "incomplete_day": 0,
    }
    filtered_rows: list[AttendanceMonitorRowOut] = []
    for emp in employees:
        row = _monitor_row_for_employee(
            db,
            emp,
            target_date=target_date,
            today=today,
            att_by_emp=att_by_emp,
            abs_by_emp=abs_by_emp,
        )
        if row is None:
            continue
        summary_counts["expected_employees"] += 1
        key = row.monitor_filter_status
        if key == "present":
            summary_counts["present"] += 1
        elif key == "late":
            summary_counts["late"] += 1
        elif key == "early_sign_out":
            summary_counts["early_sign_out"] += 1
        elif key == "absent":
            summary_counts["absent"] += 1
        elif key == "checked_in":
            summary_counts["checked_in_only"] += 1
        elif key == "incomplete_day":
            summary_counts["incomplete_day"] += 1
        if status_filter and status_filter in MONITOR_FILTER_STATUSES:
            if row.monitor_filter_status != status_filter:
                continue
        filtered_rows.append(row)

    rows_total = len(filtered_rows)
    off = max(0, int(offset or 0))
    if limit is not None:
        lim = max(1, min(int(limit), 500))
        page_rows = filtered_rows[off : off + lim]
    else:
        page_rows = filtered_rows[off:] if off else filtered_rows

    summary = AttendanceMonitorSummaryOut(attendance_date=target_date, **summary_counts)
    return AttendanceMonitorOut(
        attendance_date=target_date,
        summary=summary,
        rows=page_rows,
        rows_total=rows_total,
    )


def _haversine_meters(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance in meters."""
    r = 6371000.0
    p1 = math.radians(lat1)
    p2 = math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return r * c


# Modest buffer for consumer GPS drift (indoor/outdoor); applied on top of configured radius only.
_GEO_VALIDATION_BUFFER_METERS = 15.0
# Cap client-reported accuracy so a spoofed payload cannot bypass geo checks entirely.
_MAX_GPS_ACCURACY_CONTRIBUTION_METERS = 100.0


def _effective_geo_radius_meters(allowed: int, gps_accuracy_meters: float | None = None) -> float:
    """Allowed distance from site center (configured radius + drift / reported GPS uncertainty)."""
    effective = float(allowed) + _GEO_VALIDATION_BUFFER_METERS
    if gps_accuracy_meters is not None and gps_accuracy_meters > 0:
        acc = min(float(gps_accuracy_meters), _MAX_GPS_ACCURACY_CONTRIBUTION_METERS)
        effective = max(effective, float(allowed) + acc)
    return effective


def _log_geo_clock_in_validation(
    *,
    outcome: str,
    employee_id: int | None,
    location: models.CompanyLocation,
    employee_lat: float,
    employee_lon: float,
    distance_meters: float,
    allowed_radius_meters: int,
    gps_accuracy_meters: float | None,
    effective_radius_meters: float,
    rejection_reason: str | None = None,
) -> None:
    """Structured diagnostics for geo-attendance investigation (no PII beyond employee id)."""
    acc_repr = "none" if gps_accuracy_meters is None else f"{gps_accuracy_meters:.1f}"
    logger.info(
        "geo_attendance_validation outcome=%s employee_id=%s location_id=%s location_name=%r "
        "employee_lat=%.7f employee_lon=%.7f site_lat=%.7f site_lon=%.7f "
        "distance_m=%.1f allowed_radius_m=%s buffer_m=%.0f gps_accuracy_m=%s effective_radius_m=%.1f "
        "rejection_reason=%s",
        outcome,
        employee_id,
        int(location.id),
        location.name,
        float(employee_lat),
        float(employee_lon),
        float(location.latitude),
        float(location.longitude),
        float(distance_meters),
        allowed_radius_meters,
        _GEO_VALIDATION_BUFFER_METERS,
        acc_repr,
        float(effective_radius_meters),
        rejection_reason or "",
    )


def _validate_geo_clock_in_distance(
    employee_lat: float,
    employee_lon: float,
    loc: models.CompanyLocation,
    gps_accuracy_meters: float | None = None,
    *,
    employee_id: int | None = None,
) -> tuple[float, int]:
    """Return (distance_meters, configured_radius_meters); raise 403/409 when not allowed."""
    allowed = int(loc.allowed_radius_meters or 0)
    if allowed <= 0:
        raise HTTPException(
            status_code=409,
            detail="Assigned work location radius is not configured. Contact an administrator.",
        )
    distance = _haversine_meters(
        float(employee_lat),
        float(employee_lon),
        float(loc.latitude),
        float(loc.longitude),
    )
    effective = _effective_geo_radius_meters(allowed, gps_accuracy_meters)
    if distance > effective:
        _log_geo_clock_in_validation(
            outcome="rejected",
            employee_id=employee_id,
            location=loc,
            employee_lat=employee_lat,
            employee_lon=employee_lon,
            distance_meters=distance,
            allowed_radius_meters=allowed,
            gps_accuracy_meters=gps_accuracy_meters,
            effective_radius_meters=effective,
            rejection_reason="distance_exceeds_effective_radius",
        )
        extra = ""
        if gps_accuracy_meters is not None and gps_accuracy_meters > 0:
            extra = f" GPS accuracy was about {int(round(gps_accuracy_meters))}m."
        raise HTTPException(
            status_code=403,
            detail=(
                "You must be within your assigned work location to complete this attendance action. "
                f"(About {int(round(distance))}m from the site center; allowed {allowed}m"
                f" plus location tolerance, up to {int(round(effective))}m.{extra})"
            ),
        )
    _log_geo_clock_in_validation(
        outcome="accepted",
        employee_id=employee_id,
        location=loc,
        employee_lat=employee_lat,
        employee_lon=employee_lon,
        distance_meters=distance,
        allowed_radius_meters=allowed,
        gps_accuracy_meters=gps_accuracy_meters,
        effective_radius_meters=effective,
    )
    return distance, allowed


def _period_ids_with_any_data(db: Session) -> set[int]:
    s: set[int] = set()
    for (pid,) in db.query(models.EmployeeLatenessEntry.period_id).distinct():
        s.add(int(pid))
    for (pid,) in db.query(models.EmployeeAbsenceEntry.period_id).distinct():
        s.add(int(pid))
    for (pid,) in db.query(models.EmployeePenalty.period_id).distinct():
        s.add(int(pid))
    for (pid,) in db.query(models.EmployeeBonus.period_id).distinct():
        s.add(int(pid))
    for (pid,) in db.query(models.EmployeePeriodPayroll.period_id).distinct():
        s.add(int(pid))
    for (pid,) in db.query(models.EmployeeEarlySignOutEntry.period_id).distinct():
        s.add(int(pid))
    return s


def _periods_for_nav(db: Session) -> list[models.SalaryPeriod]:
    """Months from first hire onward with payroll activity or an active cycle."""
    first = _first_operational_payroll_month(db)
    if first is None:
        return []
    all_p = (
        db.query(models.SalaryPeriod)
        .order_by(models.SalaryPeriod.year.desc(), models.SalaryPeriod.month.desc())
        .all()
    )
    data_ids = _period_ids_with_any_data(db)
    out: list[models.SalaryPeriod] = []
    for p in all_p:
        if not _ym_on_or_after(p.year, p.month, first):
            continue
        if p.is_active or p.id in data_ids:
            out.append(p)
    return out


def _build_nav_out(db: Session) -> PayrollPeriodsNavOut:
    ensure_payroll_periods_current(db)
    ap = get_active_period(db)
    plist = _periods_for_nav(db)
    return PayrollPeriodsNavOut(
        active_period=_salary_period_out(db, ap) if ap else None,
        periods=[_salary_period_out(db, p) for p in plist],
    )


def _assert_period_is_editable(period: models.SalaryPeriod) -> None:
    if not period.is_active:
        raise HTTPException(
            status_code=403,
            detail="This salary period is archived. Open the active payroll month to make changes.",
        )


def resolve_period(
    db: Session,
    period_year: Optional[int],
    period_month: Optional[int],
) -> models.SalaryPeriod:
    ensure_payroll_periods_current(db)
    if period_year is None and period_month is None:
        ap = get_active_period(db)
        if ap:
            return ap
        raise HTTPException(
            status_code=404,
            detail="No active payroll month. Add a monthly employee to start payroll tracking.",
        )
    if period_year is None or period_month is None:
        raise HTTPException(
            status_code=400,
            detail="Provide both period_year and period_month, or neither for the active payroll month",
        )
    return get_or_create_period(db, period_year, period_month)


def _get_or_create_payroll_row(db: Session, employee_id: int, period_id: int) -> models.EmployeePeriodPayroll:
    r = db.query(models.EmployeePeriodPayroll).filter_by(employee_id=employee_id, period_id=period_id).first()
    if r:
        return r
    r = models.EmployeePeriodPayroll(employee_id=employee_id, period_id=period_id, payment_status="unpaid")
    db.add(r)
    db.flush()
    return r


def _period_paid(db: Session, employee_id: int, period_id: int) -> bool:
    r = db.query(models.EmployeePeriodPayroll).filter_by(employee_id=employee_id, period_id=period_id).first()
    return r is not None and r.payment_status == "paid"


def _assert_financial_mutable(db: Session, employee_id: int, period_id: int, confirm: bool) -> None:
    if _period_paid(db, employee_id, period_id) and not confirm:
        raise HTTPException(
            status_code=409,
            detail="This period is marked paid. Pass confirm_financial_edit=true to change lateness, penalties, or bonuses.",
        )


def _payroll_breakdown_kwargs(payroll: Optional[models.EmployeePeriodPayroll]) -> dict:
    if payroll is None:
        return {
            "period_base_salary": None,
            "adjustment_bonus": Decimal("0"),
            "adjustment_deduction": Decimal("0"),
            "adjustment_late_penalty": Decimal("0"),
            "lateness_deduction_override": None,
            "absence_deduction_override": None,
            "early_sign_out_deduction_override": None,
            "adjustment_note": None,
        }
    return {
        "period_base_salary": getattr(payroll, "period_base_salary", None),
        "adjustment_bonus": Decimal(str(getattr(payroll, "adjustment_bonus", 0) or 0)),
        "adjustment_deduction": Decimal(str(getattr(payroll, "adjustment_deduction", 0) or 0)),
        "adjustment_late_penalty": Decimal(str(getattr(payroll, "adjustment_late_penalty", 0) or 0)),
        "lateness_deduction_override": (
            Decimal(str(payroll.lateness_deduction_override))
            if getattr(payroll, "lateness_deduction_override", None) is not None
            else None
        ),
        "absence_deduction_override": (
            Decimal(str(payroll.absence_deduction_override))
            if getattr(payroll, "absence_deduction_override", None) is not None
            else None
        ),
        "early_sign_out_deduction_override": (
            Decimal(str(payroll.early_sign_out_deduction_override))
            if getattr(payroll, "early_sign_out_deduction_override", None) is not None
            else None
        ),
        "adjustment_note": getattr(payroll, "adjustment_note", None),
    }


def _salary_breakdown(
    base: Decimal,
    lateness_count: int,
    penalties_total: Decimal,
    bonuses_total: Decimal,
    *,
    lateness_auto: Decimal = Decimal("0"),
    early_sign_out_count: int = 0,
    early_sign_out_auto: Decimal = Decimal("0"),
    absence_count: int = 0,
    absence_auto: Decimal = Decimal("0"),
    lateness_rate: Optional[Decimal] = None,
    early_sign_out_rate: Optional[Decimal] = None,
    absence_rate: Optional[Decimal] = None,
    period_base_salary: Optional[Decimal] = None,
    adjustment_bonus: Decimal = Decimal("0"),
    adjustment_deduction: Decimal = Decimal("0"),
    adjustment_late_penalty: Decimal = Decimal("0"),
    lateness_deduction_override: Optional[Decimal] = None,
    absence_deduction_override: Optional[Decimal] = None,
    early_sign_out_deduction_override: Optional[Decimal] = None,
    adjustment_note: Optional[str] = None,
    apply_attendance_deductions: bool = True,
) -> EmployeeSalaryBreakdown:
    if apply_attendance_deductions:
        lateness_ded = lateness_deduction_override if lateness_deduction_override is not None else lateness_auto
        early_ded = (
            early_sign_out_deduction_override
            if early_sign_out_deduction_override is not None
            else early_sign_out_auto
        )
        absence_ded = absence_deduction_override if absence_deduction_override is not None else absence_auto
    else:
        lateness_ded = Decimal("0")
        early_ded = Decimal("0")
        absence_ded = Decimal("0")
    base_used = period_base_salary if period_base_salary is not None else base
    penalties_entries_total = penalties_total
    bonuses_entries_total = bonuses_total
    bonuses_total_all = bonuses_entries_total + (adjustment_bonus or Decimal("0"))
    penalties_total_all = penalties_entries_total + (adjustment_deduction or Decimal("0")) + (adjustment_late_penalty or Decimal("0"))
    total_ded = lateness_ded + early_ded + absence_ded + penalties_total_all
    final = base_used - lateness_ded - early_ded - absence_ded - penalties_total_all + bonuses_total_all
    return EmployeeSalaryBreakdown(
        base_salary_used=base_used,
        base_salary=base_used,
        period_base_salary=period_base_salary,
        lateness_count=lateness_count,
        lateness_deduction_auto=lateness_auto,
        lateness_deduction=lateness_ded,
        lateness_deduction_override=lateness_deduction_override,
        lateness_rate_naira=lateness_rate,
        early_sign_out_count=early_sign_out_count,
        early_sign_out_deduction_auto=early_sign_out_auto,
        early_sign_out_deduction=early_ded,
        early_sign_out_deduction_override=early_sign_out_deduction_override,
        early_sign_out_rate_naira=early_sign_out_rate,
        absence_count=absence_count,
        absence_deduction_auto=absence_auto,
        absence_deduction=absence_ded,
        absence_deduction_override=absence_deduction_override,
        absence_rate_naira=absence_rate,
        attendance_deductions_eligible=apply_attendance_deductions,
        penalties_entries_total=penalties_entries_total,
        bonuses_entries_total=bonuses_entries_total,
        adjustment_bonus=(adjustment_bonus or Decimal("0")),
        adjustment_deduction=(adjustment_deduction or Decimal("0")),
        adjustment_late_penalty=(adjustment_late_penalty or Decimal("0")),
        penalties_total=penalties_total_all,
        bonuses_total=bonuses_total_all,
        total_deductions=total_ded,
        final_payable=final,
        adjustment_note=adjustment_note,
    )


def _validate_breakdown(b: EmployeeSalaryBreakdown) -> None:
    if b.final_payable < 0:
        raise HTTPException(
            status_code=400,
            detail="Total deductions cannot exceed base salary plus bonuses for this period.",
        )


def _payroll_salary_for_employee(
    db: Session,
    emp: models.Employee,
    period: models.SalaryPeriod,
    penalties_total: Decimal,
    bonuses_total: Decimal,
    *,
    lateness_extra: int = 0,
    payroll: Optional[models.EmployeePeriodPayroll] = None,
    skip_absence_sync: bool = False,
) -> EmployeeSalaryBreakdown:
    base = emp.base_salary if emp.base_salary is not None else Decimal("0")
    lc = _lateness_count_for_payroll(db, emp, period.id) + lateness_extra
    esc = _early_sign_out_count_for_payroll(db, emp, period.id)
    ac = _absence_count_for_period(db, emp.id, period, skip_sync=skip_absence_sync)
    apply_att = _attendance_deductions_apply(db, emp, period.id)
    late_rate, early_rate, abs_rate = _location_rates_for_employee(db, emp)
    return _salary_breakdown(
        base,
        lc,
        penalties_total,
        bonuses_total,
        lateness_auto=_lateness_deduction_sum_for_payroll(db, emp, period.id),
        early_sign_out_count=esc,
        early_sign_out_auto=_early_sign_out_deduction_sum_for_payroll(db, emp, period.id),
        absence_count=ac,
        absence_auto=_absence_deduction_sum_for_payroll(db, emp, period),
        lateness_rate=late_rate,
        early_sign_out_rate=early_rate,
        absence_rate=abs_rate,
        apply_attendance_deductions=apply_att,
        **_payroll_breakdown_kwargs(payroll),
    )


def _employee_needs_assigned_payroll_filter(emp: models.Employee, *, period_paid: bool) -> bool:
    if period_paid:
        return False
    return _work_location_assigned_date(emp) is not None


def _batch_sum_map(
    db: Session,
    model,
    sum_column,
    period_id: int,
    employee_ids: list[int],
) -> dict[int, Decimal]:
    if not employee_ids:
        return {}
    rows = (
        db.query(model.employee_id, func.coalesce(func.sum(sum_column), 0))
        .filter(
            model.period_id == period_id,
            model.employee_id.in_(employee_ids),
            model.voided_at.is_(None),
        )
        .group_by(model.employee_id)
        .all()
    )
    return {int(eid): _decimal_fee(total) for eid, total in rows}


def _batch_count_map(
    db: Session,
    model,
    period_id: int,
    employee_ids: list[int],
) -> dict[int, int]:
    if not employee_ids:
        return {}
    rows = (
        db.query(model.employee_id, func.count(model.id))
        .filter(
            model.period_id == period_id,
            model.employee_id.in_(employee_ids),
            model.voided_at.is_(None),
        )
        .group_by(model.employee_id)
        .all()
    )
    return {int(eid): int(c) for eid, c in rows}


def _assigned_date_groups(emps: list[models.Employee]) -> dict[date_type, list[int]]:
    by_date: dict[date_type, list[int]] = defaultdict(list)
    for emp in emps:
        assigned = _work_location_assigned_date(emp)
        if assigned is not None:
            by_date[assigned].append(emp.id)
    return dict(by_date)


def _attendance_linked_on_or_after_assigned(assigned: date_type, entry_model, attendance_fk):
    return or_(
        models.EmployeeAttendanceEntry.attendance_date >= assigned,
        and_(
            attendance_fk.is_(None),
            func.date(entry_model.created_at) >= assigned,
        ),
    )


def _batch_lateness_ded_assigned_map(
    db: Session,
    period_id: int,
    emps: list[models.Employee],
) -> dict[int, Decimal]:
    result: dict[int, Decimal] = {}
    for assigned, eids in _assigned_date_groups(emps).items():
        rows = (
            db.query(
                models.EmployeeLatenessEntry.employee_id,
                func.coalesce(func.sum(models.EmployeeLatenessEntry.deduction_amount_naira), 0),
            )
            .outerjoin(
                models.EmployeeAttendanceEntry,
                models.EmployeeLatenessEntry.attendance_id == models.EmployeeAttendanceEntry.id,
            )
            .filter(
                models.EmployeeLatenessEntry.period_id == period_id,
                models.EmployeeLatenessEntry.employee_id.in_(eids),
                models.EmployeeLatenessEntry.voided_at.is_(None),
                _attendance_linked_on_or_after_assigned(
                    assigned,
                    models.EmployeeLatenessEntry,
                    models.EmployeeLatenessEntry.attendance_id,
                ),
            )
            .group_by(models.EmployeeLatenessEntry.employee_id)
            .all()
        )
        for eid, total in rows:
            result[int(eid)] = _decimal_fee(total)
        for eid in eids:
            result.setdefault(int(eid), Decimal("0"))
    return result


def _batch_lateness_count_assigned_map(
    db: Session,
    period_id: int,
    emps: list[models.Employee],
) -> dict[int, int]:
    result: dict[int, int] = {}
    for assigned, eids in _assigned_date_groups(emps).items():
        rows = (
            db.query(models.EmployeeLatenessEntry.employee_id, func.count(models.EmployeeLatenessEntry.id))
            .outerjoin(
                models.EmployeeAttendanceEntry,
                models.EmployeeLatenessEntry.attendance_id == models.EmployeeAttendanceEntry.id,
            )
            .filter(
                models.EmployeeLatenessEntry.period_id == period_id,
                models.EmployeeLatenessEntry.employee_id.in_(eids),
                models.EmployeeLatenessEntry.voided_at.is_(None),
                _attendance_linked_on_or_after_assigned(
                    assigned,
                    models.EmployeeLatenessEntry,
                    models.EmployeeLatenessEntry.attendance_id,
                ),
            )
            .group_by(models.EmployeeLatenessEntry.employee_id)
            .all()
        )
        for eid, count in rows:
            result[int(eid)] = int(count)
        for eid in eids:
            result.setdefault(int(eid), 0)
    return result


def _batch_early_sign_out_ded_assigned_map(
    db: Session,
    period_id: int,
    emps: list[models.Employee],
) -> dict[int, Decimal]:
    result: dict[int, Decimal] = {}
    for assigned, eids in _assigned_date_groups(emps).items():
        rows = (
            db.query(
                models.EmployeeEarlySignOutEntry.employee_id,
                func.coalesce(func.sum(models.EmployeeEarlySignOutEntry.deduction_amount_naira), 0),
            )
            .outerjoin(
                models.EmployeeAttendanceEntry,
                models.EmployeeEarlySignOutEntry.attendance_id == models.EmployeeAttendanceEntry.id,
            )
            .filter(
                models.EmployeeEarlySignOutEntry.period_id == period_id,
                models.EmployeeEarlySignOutEntry.employee_id.in_(eids),
                models.EmployeeEarlySignOutEntry.voided_at.is_(None),
                _attendance_linked_on_or_after_assigned(
                    assigned,
                    models.EmployeeEarlySignOutEntry,
                    models.EmployeeEarlySignOutEntry.attendance_id,
                ),
            )
            .group_by(models.EmployeeEarlySignOutEntry.employee_id)
            .all()
        )
        for eid, total in rows:
            result[int(eid)] = _decimal_fee(total)
        for eid in eids:
            result.setdefault(int(eid), Decimal("0"))
    return result


def _batch_early_sign_out_count_assigned_map(
    db: Session,
    period_id: int,
    emps: list[models.Employee],
) -> dict[int, int]:
    result: dict[int, int] = {}
    for assigned, eids in _assigned_date_groups(emps).items():
        rows = (
            db.query(
                models.EmployeeEarlySignOutEntry.employee_id,
                func.count(models.EmployeeEarlySignOutEntry.id),
            )
            .outerjoin(
                models.EmployeeAttendanceEntry,
                models.EmployeeEarlySignOutEntry.attendance_id == models.EmployeeAttendanceEntry.id,
            )
            .filter(
                models.EmployeeEarlySignOutEntry.period_id == period_id,
                models.EmployeeEarlySignOutEntry.employee_id.in_(eids),
                models.EmployeeEarlySignOutEntry.voided_at.is_(None),
                _attendance_linked_on_or_after_assigned(
                    assigned,
                    models.EmployeeEarlySignOutEntry,
                    models.EmployeeEarlySignOutEntry.attendance_id,
                ),
            )
            .group_by(models.EmployeeEarlySignOutEntry.employee_id)
            .all()
        )
        for eid, count in rows:
            result[int(eid)] = int(count)
        for eid in eids:
            result.setdefault(int(eid), 0)
    return result


def _batch_absence_ded_assigned_map(
    db: Session,
    period_id: int,
    emps: list[models.Employee],
) -> dict[int, Decimal]:
    result: dict[int, Decimal] = {}
    for assigned, eids in _assigned_date_groups(emps).items():
        rows = (
            db.query(
                models.EmployeeAbsenceEntry.employee_id,
                func.coalesce(func.sum(models.EmployeeAbsenceEntry.deduction_amount_naira), 0),
            )
            .filter(
                models.EmployeeAbsenceEntry.period_id == period_id,
                models.EmployeeAbsenceEntry.employee_id.in_(eids),
                models.EmployeeAbsenceEntry.voided_at.is_(None),
                models.EmployeeAbsenceEntry.absence_date >= assigned,
            )
            .group_by(models.EmployeeAbsenceEntry.employee_id)
            .all()
        )
        for eid, total in rows:
            result[int(eid)] = _decimal_fee(total)
        for eid in eids:
            result.setdefault(int(eid), Decimal("0"))
    return result


def _batch_absence_count_assigned_map(
    db: Session,
    period_id: int,
    emps: list[models.Employee],
) -> dict[int, int]:
    result: dict[int, int] = {}
    for assigned, eids in _assigned_date_groups(emps).items():
        rows = (
            db.query(models.EmployeeAbsenceEntry.employee_id, func.count(models.EmployeeAbsenceEntry.id))
            .filter(
                models.EmployeeAbsenceEntry.period_id == period_id,
                models.EmployeeAbsenceEntry.employee_id.in_(eids),
                models.EmployeeAbsenceEntry.voided_at.is_(None),
                models.EmployeeAbsenceEntry.absence_date >= assigned,
            )
            .group_by(models.EmployeeAbsenceEntry.employee_id)
            .all()
        )
        for eid, count in rows:
            result[int(eid)] = int(count)
        for eid in eids:
            result.setdefault(int(eid), 0)
    return result


@dataclass
class _PayrollListContext:
    db: Session
    period: models.SalaryPeriod
    period_out: SalaryPeriodOut
    emps: list[models.Employee]
    lateness_map: dict[int, int]
    absence_map: dict[int, int]
    pen_map: dict[int, Decimal]
    bon_map: dict[int, Decimal]
    payroll_map: dict[int, models.EmployeePeriodPayroll]
    _paid: dict[int, bool] = field(default_factory=dict)
    _apply_att: dict[int, bool] = field(default_factory=dict)
    _loc_rates: dict[int, tuple[Decimal, Decimal, Decimal]] = field(default_factory=dict)
    _lateness_ded: dict[int, Decimal] = field(default_factory=dict)
    _lateness_count_assigned: dict[int, int] = field(default_factory=dict)
    _early_count: dict[int, int] = field(default_factory=dict)
    _early_ded: dict[int, Decimal] = field(default_factory=dict)
    _absence_ded: dict[int, Decimal] = field(default_factory=dict)
    _absence_count_assigned: dict[int, int] = field(default_factory=dict)
    _deductions_loaded: bool = False

    @classmethod
    def build(
        cls,
        db: Session,
        period: models.SalaryPeriod,
        *,
        search: str = "",
        payment_status: Optional[str] = None,
    ) -> _PayrollListContext:
        lateness_map, absence_map, pen_map, bon_map = _aggregates_for_period(db, period.id)
        payroll_map = _payroll_map_for_period(db, period.id)
        emps = _employees_for_period(db, period)
        s = (search or "").strip()
        if s:
            emps = [e for e in emps if s.lower() in (e.full_name or "").lower()]
        if payment_status is not None:
            emps = [
                e
                for e in emps
                if (
                    (payroll_map.get(e.id).payment_status if payroll_map.get(e.id) else "unpaid")
                    == payment_status
                )
            ]
        ctx = cls(
            db=db,
            period=period,
            period_out=_salary_period_out(db, period),
            emps=emps,
            lateness_map=lateness_map,
            absence_map=absence_map,
            pen_map=pen_map,
            bon_map=bon_map,
            payroll_map=payroll_map,
        )
        ctx._init_employee_caches()
        return ctx

    def _init_employee_caches(self) -> None:
        loc_ids = {int(e.work_location_id) for e in self.emps if e.work_location_id is not None}
        if loc_ids:
            locs = (
                self.db.query(models.CompanyLocation)
                .filter(models.CompanyLocation.id.in_(loc_ids))
                .all()
            )
            for loc in locs:
                self._loc_rates[int(loc.id)] = (
                    _location_late_fee(loc),
                    _location_early_sign_out_fee(loc),
                    _location_absence_fee(loc),
                )
        for emp in self.emps:
            pr = self.payroll_map.get(emp.id)
            paid = pr is not None and pr.payment_status == "paid"
            self._paid[emp.id] = paid
            self._apply_att[emp.id] = paid or emp.work_location_id is not None

    def _rates_for(self, emp: models.Employee) -> tuple[Decimal, Decimal, Decimal]:
        wid = getattr(emp, "work_location_id", None)
        if wid is not None and int(wid) in self._loc_rates:
            return self._loc_rates[int(wid)]
        return _location_rates_for_employee(self.db, emp)

    def _ensure_batch_deductions(self) -> None:
        if self._deductions_loaded:
            return
        emp_ids = [e.id for e in self.emps]
        pid = self.period.id
        self._lateness_ded = _batch_sum_map(
            self.db,
            models.EmployeeLatenessEntry,
            models.EmployeeLatenessEntry.deduction_amount_naira,
            pid,
            emp_ids,
        )
        self._early_count = _batch_count_map(
            self.db, models.EmployeeEarlySignOutEntry, pid, emp_ids
        )
        self._early_ded = _batch_sum_map(
            self.db,
            models.EmployeeEarlySignOutEntry,
            models.EmployeeEarlySignOutEntry.deduction_amount_naira,
            pid,
            emp_ids,
        )
        self._absence_ded = _batch_sum_map(
            self.db,
            models.EmployeeAbsenceEntry,
            models.EmployeeAbsenceEntry.deduction_amount_naira,
            pid,
            emp_ids,
        )
        assigned_emps = [
            e
            for e in self.emps
            if _employee_needs_assigned_payroll_filter(e, period_paid=self._paid[e.id])
            and self._apply_att.get(e.id)
        ]
        if assigned_emps:
            lat_ded = _batch_lateness_ded_assigned_map(self.db, pid, assigned_emps)
            lat_cnt = _batch_lateness_count_assigned_map(self.db, pid, assigned_emps)
            early_ded = _batch_early_sign_out_ded_assigned_map(self.db, pid, assigned_emps)
            early_cnt = _batch_early_sign_out_count_assigned_map(self.db, pid, assigned_emps)
            abs_ded = _batch_absence_ded_assigned_map(self.db, pid, assigned_emps)
            abs_cnt = _batch_absence_count_assigned_map(self.db, pid, assigned_emps)
            for emp in assigned_emps:
                eid = emp.id
                self._lateness_ded[eid] = lat_ded.get(eid, Decimal("0"))
                self._lateness_count_assigned[eid] = lat_cnt.get(eid, 0)
                self._early_ded[eid] = early_ded.get(eid, Decimal("0"))
                self._early_count[eid] = early_cnt.get(eid, 0)
                self._absence_ded[eid] = abs_ded.get(eid, Decimal("0"))
                self._absence_count_assigned[eid] = abs_cnt.get(eid, 0)
        self._deductions_loaded = True

    def _lateness_count(self, emp: models.Employee) -> int:
        if not self._apply_att.get(emp.id):
            return 0
        if _employee_needs_assigned_payroll_filter(emp, period_paid=self._paid[emp.id]):
            self._ensure_batch_deductions()
            return self._lateness_count_assigned.get(emp.id, 0)
        return self.lateness_map.get(emp.id, 0)

    def _early_sign_out_count(self, emp: models.Employee) -> int:
        if not self._apply_att.get(emp.id):
            return 0
        self._ensure_batch_deductions()
        return self._early_count.get(emp.id, 0)

    def _absence_count(self, emp: models.Employee) -> int:
        if not self._paid[emp.id] and emp.work_location_id is None:
            return 0
        if _employee_needs_assigned_payroll_filter(emp, period_paid=self._paid[emp.id]):
            self._ensure_batch_deductions()
            return self._absence_count_assigned.get(emp.id, 0)
        return self.absence_map.get(emp.id, 0)

    def salary_for(
        self,
        emp: models.Employee,
        penalties_total: Decimal,
        bonuses_total: Decimal,
        payroll: Optional[models.EmployeePeriodPayroll],
    ) -> EmployeeSalaryBreakdown:
        base = emp.base_salary if emp.base_salary is not None else Decimal("0")
        apply_att = self._apply_att.get(emp.id, False)
        if not apply_att:
            return _salary_breakdown(
                base,
                0,
                penalties_total,
                bonuses_total,
                apply_attendance_deductions=False,
                **_payroll_breakdown_kwargs(payroll),
            )
        self._ensure_batch_deductions()
        late_rate, early_rate, abs_rate = self._rates_for(emp)
        eid = emp.id
        return _salary_breakdown(
            base,
            self._lateness_count(emp),
            penalties_total,
            bonuses_total,
            lateness_auto=self._lateness_ded.get(eid, Decimal("0")),
            early_sign_out_count=self._early_sign_out_count(emp),
            early_sign_out_auto=self._early_ded.get(eid, Decimal("0")),
            absence_count=self._absence_count(emp),
            absence_auto=self._absence_ded.get(eid, Decimal("0")),
            lateness_rate=late_rate,
            early_sign_out_rate=early_rate,
            absence_rate=abs_rate,
            apply_attendance_deductions=True,
            **_payroll_breakdown_kwargs(payroll),
        )


def _log_payroll(db: Session, action: str, entity_id: Optional[int], user, meta: dict) -> None:
    db.add(
        models.ActionLog(
            action=action,
            entity_type="employee_payroll",
            entity_id=entity_id,
            actor_user_id=getattr(user, "id", None),
            actor_username=getattr(user, "email", None),
            meta=meta,
        )
    )


def _load_rows_for_period(
    db: Session,
    employee_id: int,
    period: models.SalaryPeriod,
) -> tuple[
    list[models.EmployeeLatenessEntry],
    list[models.EmployeePenalty],
    list[models.EmployeeBonus],
    Optional[models.EmployeePeriodPayroll],
]:
    lateness = (
        db.query(models.EmployeeLatenessEntry)
        .filter_by(employee_id=employee_id, period_id=period.id)
        .filter(models.EmployeeLatenessEntry.voided_at.is_(None))
        .order_by(models.EmployeeLatenessEntry.id)
        .all()
    )
    penalties = (
        db.query(models.EmployeePenalty)
        .filter_by(employee_id=employee_id, period_id=period.id)
        .filter(models.EmployeePenalty.voided_at.is_(None))
        .order_by(models.EmployeePenalty.id)
        .all()
    )
    bonuses = (
        db.query(models.EmployeeBonus)
        .filter_by(employee_id=employee_id, period_id=period.id)
        .filter(models.EmployeeBonus.voided_at.is_(None))
        .order_by(models.EmployeeBonus.id)
        .all()
    )
    payroll = db.query(models.EmployeePeriodPayroll).filter_by(employee_id=employee_id, period_id=period.id).first()
    return lateness, penalties, bonuses, payroll


def _employee_to_out(
    emp: models.Employee,
    db: Session,
    period: models.SalaryPeriod,
    lateness: list[models.EmployeeLatenessEntry],
    penalties: list[models.EmployeePenalty],
    bonuses: list[models.EmployeeBonus],
    payroll: Optional[models.EmployeePeriodPayroll],
) -> EmployeeOut:
    linked_username = None
    if emp.user_id:
        u = db.query(models.User).filter(models.User.id == emp.user_id).first()
        if u:
            linked_username = u.email
    pen = sum((p.amount for p in penalties), Decimal("0"))
    bon = sum((b.amount for b in bonuses), Decimal("0"))
    salary = _payroll_salary_for_employee(db, emp, period, pen, bon, payroll=payroll)
    pay = EmployeePaymentOut(
        status=(payroll.payment_status if payroll else "unpaid"),
        payment_date=payroll.payment_date if payroll else None,
        payment_reference=payroll.payment_reference if payroll else None,
    )
    return EmployeeOut(
        id=emp.id,
        full_name=emp.full_name,
        address=emp.address,
        phone=emp.phone,
        bank_name=getattr(emp, "bank_name", None),
        account_number=emp.account_number,
        notes=emp.notes,
        base_salary=emp.base_salary,
        documents=emp.documents or [],
        user_id=emp.user_id,
        linked_username=linked_username,
        work_location_id=getattr(emp, "work_location_id", None),
        work_location=CompanyLocationOut.model_validate(emp.work_location) if getattr(emp, "work_location", None) else None,
        created_at=emp.created_at,
        updated_at=emp.updated_at,
        period=_salary_period_out(db, period),
        payment=pay,
        lateness_entries=[EmployeeLatenessEntryOut.model_validate(x) for x in lateness],
        penalties=[EmployeePenaltyOut.model_validate(x) for x in penalties],
        bonuses=[EmployeeBonusOut.model_validate(x) for x in bonuses],
        salary=salary,
    )


def _list_item(
    ctx: _PayrollListContext,
    emp: models.Employee,
    penalties_total: Decimal,
    bonuses_total: Decimal,
    payroll: Optional[models.EmployeePeriodPayroll],
) -> EmployeeListItemOut:
    base = emp.base_salary if emp.base_salary is not None else Decimal("0")
    salary = ctx.salary_for(emp, penalties_total, bonuses_total, payroll)
    pay = EmployeePaymentOut(
        status=(payroll.payment_status if payroll else "unpaid"),
        payment_date=payroll.payment_date if payroll else None,
        payment_reference=payroll.payment_reference if payroll else None,
    )
    return EmployeeListItemOut(
        id=emp.id,
        full_name=emp.full_name,
        notes=getattr(emp, "notes", None),
        phone=emp.phone,
        bank_name=getattr(emp, "bank_name", None),
        account_number=emp.account_number,
        base_salary=base,
        user_id=emp.user_id,
        period=ctx.period_out,
        payment=pay,
        salary=salary,
    )


def _aggregates_for_period(
    db: Session, period_id: int
) -> tuple[dict[int, int], dict[int, int], dict[int, Decimal], dict[int, Decimal]]:
    period = db.query(models.SalaryPeriod).filter(models.SalaryPeriod.id == period_id).first()
    if period and period.is_active:
        for e in _employees_for_period(db, period):
            _sync_absence_entries_for_period(db, e.id, period)
        db.flush()

    lateness_rows = (
        db.query(models.EmployeeLatenessEntry.employee_id, func.count(models.EmployeeLatenessEntry.id))
        .filter(
            models.EmployeeLatenessEntry.period_id == period_id,
            models.EmployeeLatenessEntry.voided_at.is_(None),
        )
        .group_by(models.EmployeeLatenessEntry.employee_id)
        .all()
    )
    lateness_map = {int(eid): int(c) for eid, c in lateness_rows}
    absence_rows = (
        db.query(models.EmployeeAbsenceEntry.employee_id, func.count(models.EmployeeAbsenceEntry.id))
        .filter(
            models.EmployeeAbsenceEntry.period_id == period_id,
            models.EmployeeAbsenceEntry.voided_at.is_(None),
        )
        .group_by(models.EmployeeAbsenceEntry.employee_id)
        .all()
    )
    absence_map = {int(eid): int(c) for eid, c in absence_rows}
    pen_rows = (
        db.query(models.EmployeePenalty.employee_id, func.coalesce(func.sum(models.EmployeePenalty.amount), 0))
        .filter(
            models.EmployeePenalty.period_id == period_id,
            models.EmployeePenalty.voided_at.is_(None),
        )
        .group_by(models.EmployeePenalty.employee_id)
        .all()
    )
    pen_map = {int(eid): Decimal(str(total)) for eid, total in pen_rows}
    bon_rows = (
        db.query(models.EmployeeBonus.employee_id, func.coalesce(func.sum(models.EmployeeBonus.amount), 0))
        .filter(
            models.EmployeeBonus.period_id == period_id,
            models.EmployeeBonus.voided_at.is_(None),
        )
        .group_by(models.EmployeeBonus.employee_id)
        .all()
    )
    bon_map = {int(eid): Decimal(str(total)) for eid, total in bon_rows}
    return lateness_map, absence_map, pen_map, bon_map


def _payroll_map_for_period(db: Session, period_id: int) -> dict[int, models.EmployeePeriodPayroll]:
    rows = db.query(models.EmployeePeriodPayroll).filter(models.EmployeePeriodPayroll.period_id == period_id).all()
    return {r.employee_id: r for r in rows}


def _assert_can_view(user, emp: models.Employee) -> None:
    if _is_admin(user):
        return
    if emp.user_id is not None and emp.user_id == user.id:
        return
    raise HTTPException(status_code=403, detail="Not authorized")


def _assert_can_edit_self_profile(user, emp: models.Employee) -> None:
    if emp.user_id is None or emp.user_id != user.id:
        raise HTTPException(status_code=403, detail="Not authorized")


@router.get("/periods", response_model=PayrollPeriodsNavOut)
def payroll_periods_nav(
    db: Session = Depends(get_db),
    current_user=Depends(require_role(["admin"])),
):
    out = _build_nav_out(db)
    db.commit()
    return out


@router.post("/periods/mark-month-paid", response_model=SalaryPeriodOut)
def mark_period_month_paid(
    db: Session = Depends(get_db),
    current_user=Depends(require_role(["admin"])),
    period_year: int = Query(..., ge=2000, le=2100),
    period_month: int = Query(..., ge=1, le=12),
):
    """Mark an entire payroll month as paid and sync unpaid roster employees in that month only."""
    period = get_or_create_period(db, period_year, period_month)
    if period.month_payment_status == MONTH_PAYMENT_PAID:
        raise HTTPException(status_code=400, detail="This month is already marked paid.")
    paid_count, total = _period_payment_counts(db, period)
    if total == 0:
        raise HTTPException(status_code=400, detail="This payroll month has no employees.")
    if paid_count >= total:
        raise HTTPException(status_code=400, detail="All employees in this month are already paid.")
    employees_updated = _mark_unpaid_roster_employees_paid(db, period, current_user)
    period.month_payment_status = MONTH_PAYMENT_PAID
    period.month_paid_at = now_utc_naive()
    period.month_paid_by_id = current_user.id
    _log_payroll(
        db,
        "payroll_mark_month_paid",
        period.id,
        current_user,
        {
            "period_id": period.id,
            "year": period.year,
            "month": period.month,
            "label": period.label,
            "employees_updated": employees_updated,
        },
    )
    db.commit()
    db.refresh(period)
    return _salary_period_out(db, period)


@router.post("/periods/start-next-month", response_model=PayrollPeriodsNavOut)
def start_next_payroll_month(
    db: Session = Depends(get_db),
    current_user=Depends(require_role(["admin"])),
):
    """Advance to the next calendar month and mark it active. Prior month stays in the archive (unchanged)."""
    if _first_operational_payroll_month(db) is None:
        raise HTTPException(status_code=404, detail="Add a monthly employee before starting payroll months.")
    ensure_payroll_periods_current(db)
    active = get_active_period(db)
    if active:
        _snapshot_period_roster(db, active)
        ny, nm = _next_calendar_month(active.year, active.month)
    else:
        rows = (
            db.query(models.SalaryPeriod)
            .order_by(models.SalaryPeriod.year.desc(), models.SalaryPeriod.month.desc())
            .limit(1)
            .all()
        )
        if rows:
            p = rows[0]
            ny, nm = _next_calendar_month(p.year, p.month)
        else:
            today = lagos_today()
            ny, nm = today.year, today.month

    new_p = get_or_create_period(db, ny, nm)
    db.query(models.SalaryPeriod).update({models.SalaryPeriod.is_active: False}, synchronize_session=False)
    new_p.is_active = True
    _log_payroll(
        db,
        "payroll_start_new_month",
        new_p.id,
        current_user,
        {"period_id": new_p.id, "year": new_p.year, "month": new_p.month, "label": new_p.label},
    )
    db.commit()
    db.refresh(new_p)
    return _build_nav_out(db)


@router.get("/payroll/summary", response_model=PayrollSummaryOut)
def payroll_summary(
    db: Session = Depends(get_db),
    current_user=Depends(require_role(["admin"])),
    period_year: Optional[int] = Query(None, ge=2000, le=2100),
    period_month: Optional[int] = Query(None, ge=1, le=12),
):
    period = resolve_period(db, period_year, period_month)
    ctx = _PayrollListContext.build(db, period)
    total_base = Decimal("0")
    total_lat = Decimal("0")
    total_early = Decimal("0")
    total_abs = Decimal("0")
    total_pen = Decimal("0")
    total_bon = Decimal("0")
    total_net = Decimal("0")
    total_ded = Decimal("0")
    for e in ctx.emps:
        pt = ctx.pen_map.get(e.id, Decimal("0"))
        bt = ctx.bon_map.get(e.id, Decimal("0"))
        br = ctx.salary_for(e, pt, bt, ctx.payroll_map.get(e.id))
        total_base += br.base_salary_used
        total_lat += br.lateness_deduction
        total_early += br.early_sign_out_deduction
        total_abs += br.absence_deduction
        total_pen += br.penalties_total
        total_bon += br.bonuses_total
        total_net += br.final_payable
        total_ded += br.total_deductions
    return PayrollSummaryOut(
        period=ctx.period_out,
        employee_count=len(ctx.emps),
        total_base_salary=total_base,
        total_lateness_deductions=total_lat,
        total_early_sign_out_deductions=total_early,
        total_absence_deductions=total_abs,
        total_penalties=total_pen,
        total_bonuses=total_bon,
        total_deductions=total_ded,
        net_payroll=total_net,
    )


@router.get("", response_model=list[EmployeeListItemOut])
def list_employees(
    db: Session = Depends(get_db),
    current_user=Depends(require_role(["admin"])),
    period_year: Optional[int] = Query(None, ge=2000, le=2100),
    period_month: Optional[int] = Query(None, ge=1, le=12),
    search: str = Query("", max_length=200),
    payment_status: Optional[str] = Query(None, description="paid | unpaid"),
):
    period = resolve_period(db, period_year, period_month)
    ctx = _PayrollListContext.build(db, period, search=search, payment_status=payment_status)
    emps = sorted(ctx.emps, key=lambda e: e.id, reverse=True)
    return [
        _list_item(
            ctx,
            e,
            ctx.pen_map.get(e.id, Decimal("0")),
            ctx.bon_map.get(e.id, Decimal("0")),
            ctx.payroll_map.get(e.id),
        )
        for e in emps
    ]


@router.get("/export")
def export_employees_csv(
    db: Session = Depends(get_db),
    current_user=Depends(require_role(["admin"])),
    period_year: Optional[int] = Query(None, ge=2000, le=2100),
    period_month: Optional[int] = Query(None, ge=1, le=12),
):
    period = resolve_period(db, period_year, period_month)
    ctx = _PayrollListContext.build(db, period)
    emps = sorted(ctx.emps, key=lambda e: (e.full_name or "").lower())
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(
        [
            "Period",
            "Employee name",
            "Account number",
            "Base salary (NGN)",
            "Payment status",
            "Payment date",
            "Payment reference",
            "Lateness count",
            "Lateness deductions (NGN)",
            "Absence count",
            "Absence deductions (NGN)",
            "Penalties total (NGN)",
            "Bonuses total (NGN)",
            "Final payable (NGN)",
        ]
    )
    for e in emps:
        pt = ctx.pen_map.get(e.id, Decimal("0"))
        bt = ctx.bon_map.get(e.id, Decimal("0"))
        s = ctx.salary_for(e, pt, bt, ctx.payroll_map.get(e.id))
        pr = ctx.payroll_map.get(e.id)
        w.writerow(
            [
                period.label,
                e.full_name or "",
                e.account_number or "",
                str(s.base_salary),
                pr.payment_status if pr else "unpaid",
                pr.payment_date.isoformat() if pr and pr.payment_date else "",
                pr.payment_reference or "" if pr else "",
                s.lateness_count,
                str(s.lateness_deduction),
                s.absence_count,
                str(s.absence_deduction),
                str(s.penalties_total),
                str(s.bonuses_total),
                str(s.final_payable),
            ]
        )
    buf.seek(0)
    safe_label = period.label.replace(" ", "_")
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="employees_payroll_{safe_label}.csv"'},
    )


@router.get("/me", response_model=EmployeeOut)
def get_my_employee(
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    emp = (
        db.query(models.Employee)
        .filter(models.Employee.user_id == current_user.id, models.Employee.deleted_at.is_(None))
        .first()
    )
    if emp is None:
        raise HTTPException(
            status_code=404,
            detail="No employee profile linked to your account. Contact an administrator.",
        )
    period = resolve_period(db, None, None)
    lateness, penalties, bonuses, payroll = _load_rows_for_period(db, emp.id, period)
    return _employee_to_out(emp, db, period, lateness, penalties, bonuses, payroll)


@router.get("/me/transactions", response_model=list[EmployeeTransactionOut])
def list_my_employee_transactions(
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
    period_year: Optional[int] = Query(None, ge=2000, le=2100),
    period_month: Optional[int] = Query(None, ge=1, le=12),
):
    """Linked monthly employees (including Staff role): read-only payment ledger for their own record."""
    emp = (
        db.query(models.Employee)
        .filter(models.Employee.user_id == current_user.id, models.Employee.deleted_at.is_(None))
        .first()
    )
    if emp is None:
        raise HTTPException(
            status_code=404,
            detail="No employee profile linked to your account. Contact an administrator.",
        )

    period_id: Optional[int] = None
    if period_year is not None or period_month is not None:
        if period_year is None or period_month is None:
            raise HTTPException(status_code=400, detail="Provide both period_year and period_month, or neither.")
        p = get_or_create_period(db, int(period_year), int(period_month))
        period_id = p.id

    q = db.query(models.EmployeeTransaction).filter(models.EmployeeTransaction.employee_id == emp.id)
    if period_id is not None:
        q = q.filter(models.EmployeeTransaction.period_id == period_id)

    rows = q.order_by(models.EmployeeTransaction.created_at.asc(), models.EmployeeTransaction.id.asc()).all()
    outs: list[EmployeeTransactionOut] = [EmployeeTransactionOut.model_validate(r) for r in rows]
    if period_id is not None:
        period = db.query(models.SalaryPeriod).filter(models.SalaryPeriod.id == period_id).first()
        if period:
            lateness, penalties, bonuses, payroll = _load_rows_for_period(db, emp.id, period)
            pen = sum((p.amount for p in penalties), Decimal("0"))
            bon = sum((b.amount for b in bonuses), Decimal("0"))
            salary = _payroll_salary_for_employee(db, emp, period, pen, bon, payroll=payroll)
            due = salary.final_payable
            paid_total = Decimal("0")
            for o in outs:
                if o.txn_type == "payment" and o.status == "paid":
                    paid_total += Decimal(str(o.amount or 0))
                o.running_balance = due - paid_total
    outs.sort(key=lambda x: (x.created_at, x.id), reverse=True)
    return outs


@router.post("/me/attendance/clock-in", response_model=EmployeeClockInOut)
def clock_in_my_attendance(
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Monthly employees only: record manual attendance for today (one per day; Sundays excluded).

    When late (after 08:15), automatically creates one EmployeeLatenessEntry linked to this attendance row.
    """
    emp = (
        db.query(models.Employee)
        .filter(models.Employee.user_id == current_user.id, models.Employee.deleted_at.is_(None))
        .first()
    )
    if emp is None:
        raise HTTPException(status_code=404, detail="No employee profile linked to your account.")

    now = now_lagos()
    today = now.date()
    if _is_sunday(today):
        return EmployeeClockInOut(
            status="sunday",
            message="Sundays are excluded. No attendance is required today.",
            entry=None,
        )

    existing = (
        db.query(models.EmployeeAttendanceEntry)
        .filter(
            models.EmployeeAttendanceEntry.employee_id == emp.id,
            models.EmployeeAttendanceEntry.attendance_date == today,
        )
        .first()
    )
    if existing:
        late_id = getattr(getattr(existing, "lateness_entry", None), "id", None)
        out = _attendance_row_to_history(existing, lateness_entry_id=int(late_id) if late_id is not None else None)
        if existing.check_out_at is not None:
            return EmployeeClockInOut(
                status="already_checked_out",
                message=(
                    f"Attendance already completed. Signed out at "
                    f"{to_lagos(existing.check_out_at).strftime('%I:%M %p').lstrip('0')}."
                ),
                entry=out,
            )
        return EmployeeClockInOut(
            status="already_checked_in",
            message=(
                f"Already checked in at {to_lagos(existing.check_in_at).strftime('%I:%M %p').lstrip('0')}. "
                "Sign out when you leave."
            ),
            entry=out,
        )

    ensure_payroll_periods_current(db)
    period = get_or_create_period(db, today.year, today.month)
    loc = None
    if emp.work_location_id is not None:
        loc = db.query(models.CompanyLocation).filter(models.CompanyLocation.id == emp.work_location_id).first()
    cutoff_t = getattr(loc, "attendance_cutoff_time", None) if loc is not None else None
    if cutoff_t is not None and now.time() >= cutoff_t:
        display = datetime(2000, 1, 1, cutoff_t.hour, cutoff_t.minute).strftime("%I:%M %p").lstrip("0")
        raise HTTPException(
            status_code=409,
            detail=(
                f"Attendance cannot be marked. Today's attendance closed at {display} and you have already been recorded as absent."
            ),
        )
    if loc is not None and bool(getattr(loc, "shift_mode_enabled", False)):
        raise HTTPException(
            status_code=400,
            detail="This location requires shift selection. Use geo check-in with a selected shift.",
        )
    late_t = loc.late_attendance_time if loc is not None else time(8, 15)
    close_t = loc.check_out_time if loc is not None else time(17, 0)
    mins = _late_minutes(now, cutoff=late_t)
    is_late = mins > 0

    att = models.EmployeeAttendanceEntry(
        employee_id=emp.id,
        period_id=period.id,
        attendance_date=today,
        check_in_at=utc_naive_from(now),
        expected_late_time=late_t,
        expected_check_out_time=close_t,
        is_late=is_late,
        late_minutes=mins if is_late else 0,
        work_location_id=loc.id if loc is not None else None,
    )
    db.add(att)
    db.flush()
    _remove_absence_for_date(db, emp.id, today)

    lateness_entry_id: Optional[int] = None
    if is_late and emp.work_location_id is not None and loc is not None:
        late_note = f"Late attendance: {today.isoformat()} (clock-in {to_lagos(now).strftime('%H:%M')})"
        le = _create_lateness_entry(
            db,
            emp=emp,
            period_id=period.id,
            attendance_id=att.id,
            note=late_note,
            fee=_location_late_fee(loc),
        )
        lateness_entry_id = int(le.id)

    # Lightweight action log for audit (no retention issues since action_logs are already managed).
    _log_payroll(
        db,
        "employee_attendance_clock_in",
        att.id,
        current_user,
        {
            "employee_id": emp.id,
            "attendance_date": today.isoformat(),
            "check_in_at": now.isoformat(),
            "is_late": is_late,
            "late_minutes": mins,
            "period_id": period.id,
            "lateness_entry_id": lateness_entry_id,
        },
    )
    db.commit()
    db.refresh(att)

    out = _attendance_row_to_history(att, lateness_entry_id=lateness_entry_id)
    return EmployeeClockInOut(
        status="late" if is_late else "present",
        message="Check-in recorded.",
        entry=out,
    )


@router.post("/me/attendance/clock-in-geo", response_model=EmployeeClockInOut)
def clock_in_my_attendance_geo(
    body: EmployeeClockInGeoIn,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Geo-validated monthly attendance clock-in (manual, one/day; Sundays excluded).

    - Requires the employee to have an assigned CompanyLocation (work_location_id).
    - Stores the employee coordinates and computed distance.
    - When late (after 08:15), creates one EmployeeLatenessEntry linked to this attendance row (₦500 deduction is derived from lateness count).
    """
    emp = (
        db.query(models.Employee)
        .filter(models.Employee.user_id == current_user.id, models.Employee.deleted_at.is_(None))
        .first()
    )
    if emp is None:
        raise HTTPException(status_code=404, detail="No employee profile linked to your account.")
    if emp.work_location_id is None:
        raise HTTPException(status_code=409, detail="No work location assigned. Contact an administrator.")

    loc = db.query(models.CompanyLocation).filter(models.CompanyLocation.id == emp.work_location_id).first()
    if loc is None:
        raise HTTPException(status_code=409, detail="Your assigned work location no longer exists. Contact an administrator.")
    db.refresh(loc)

    now = now_lagos()
    cutoff_t = getattr(loc, "attendance_cutoff_time", None)
    if cutoff_t is not None and now.time() >= cutoff_t:
        display = datetime(2000, 1, 1, cutoff_t.hour, cutoff_t.minute).strftime("%I:%M %p").lstrip("0")
        raise HTTPException(
            status_code=409,
            detail=(
                f"Attendance cannot be marked. Today's attendance closed at {display} and you have already been recorded as absent."
            ),
        )
    today = now.date()
    if _is_sunday(today):
        return EmployeeClockInOut(
            status="sunday",
            message="Sundays are excluded. No attendance is required today.",
            entry=None,
        )

    existing = (
        db.query(models.EmployeeAttendanceEntry)
        .filter(
            models.EmployeeAttendanceEntry.employee_id == emp.id,
            models.EmployeeAttendanceEntry.attendance_date == today,
        )
        .first()
    )
    if existing:
        late_id = getattr(getattr(existing, "lateness_entry", None), "id", None)
        out = _attendance_row_to_history(existing, lateness_entry_id=int(late_id) if late_id is not None else None)
        if existing.check_out_at is not None:
            return EmployeeClockInOut(
                status="already_checked_out",
                message=(
                    f"Attendance already completed. Signed out at "
                    f"{to_lagos(existing.check_out_at).strftime('%I:%M %p').lstrip('0')}."
                ),
                entry=out,
            )
        return EmployeeClockInOut(
            status="already_checked_in",
            message=(
                f"Already checked in at {to_lagos(existing.check_in_at).strftime('%I:%M %p').lstrip('0')}. "
                "Sign out when you leave."
            ),
            entry=out,
        )

    gps_accuracy = float(body.accuracy_meters) if body.accuracy_meters is not None else None
    distance, allowed = _validate_geo_clock_in_distance(
        float(body.latitude),
        float(body.longitude),
        loc,
        gps_accuracy_meters=gps_accuracy,
        employee_id=int(emp.id),
    )

    ensure_payroll_periods_current(db)
    period = get_or_create_period(db, today.year, today.month)
    late_t, close_t, selected_shift = _attendance_times_for_check_in(loc, body.shift)
    mins = _late_minutes(now, cutoff=late_t)
    is_late = mins > 0

    att = models.EmployeeAttendanceEntry(
        employee_id=emp.id,
        period_id=period.id,
        attendance_date=today,
        check_in_at=utc_naive_from(now),
        selected_shift=selected_shift,
        expected_late_time=late_t,
        expected_check_out_time=close_t,
        is_late=is_late,
        late_minutes=mins if is_late else 0,
        work_location_id=loc.id,
        employee_latitude=float(body.latitude),
        employee_longitude=float(body.longitude),
        distance_meters=float(distance),
    )
    db.add(att)
    db.flush()
    _remove_absence_for_date(db, emp.id, today)

    lateness_entry_id: Optional[int] = None
    if is_late:
        late_note = f"Late attendance: {today.isoformat()} (clock-in {to_lagos(now).strftime('%H:%M')})"
        le = _create_lateness_entry(
            db,
            emp=emp,
            period_id=period.id,
            attendance_id=att.id,
            note=late_note,
            fee=_location_late_fee(loc),
        )
        lateness_entry_id = int(le.id)

    _log_payroll(
        db,
        "employee_attendance_clock_in_geo",
        att.id,
        current_user,
        {
            "employee_id": emp.id,
            "attendance_date": today.isoformat(),
            "check_in_at": now.isoformat(),
            "is_late": is_late,
            "late_minutes": mins,
            "period_id": period.id,
            "lateness_entry_id": lateness_entry_id,
            "work_location_id": int(loc.id),
            "employee_latitude": float(body.latitude),
            "employee_longitude": float(body.longitude),
            "distance_meters": float(distance),
            "allowed_radius_meters": allowed,
            "geo_validation_buffer_meters": _GEO_VALIDATION_BUFFER_METERS,
            "gps_accuracy_meters": gps_accuracy,
            "effective_radius_meters": _effective_geo_radius_meters(allowed, gps_accuracy),
        },
    )
    db.commit()
    db.refresh(att)

    out = _attendance_row_to_history(att, lateness_entry_id=lateness_entry_id)
    return EmployeeClockInOut(
        status="late" if is_late else "present",
        message="Check-in recorded.",
        entry=out,
    )


@router.post("/me/attendance/clock-out-geo", response_model=EmployeeClockOutOut)
def clock_out_my_attendance_geo(
    body: EmployeeClockInGeoIn,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Geo-validated monthly attendance check-out (one per day; Sundays excluded).

    Requires a prior check-in for today and validates the employee is still within the assigned location radius.
    """
    emp = (
        db.query(models.Employee)
        .filter(models.Employee.user_id == current_user.id, models.Employee.deleted_at.is_(None))
        .first()
    )
    if emp is None:
        raise HTTPException(status_code=404, detail="No employee profile linked to your account.")
    if emp.work_location_id is None:
        raise HTTPException(status_code=409, detail="No work location assigned. Contact an administrator.")

    loc = db.query(models.CompanyLocation).filter(models.CompanyLocation.id == emp.work_location_id).first()
    if loc is None:
        raise HTTPException(status_code=409, detail="Your assigned work location no longer exists. Contact an administrator.")
    db.refresh(loc)

    now = now_lagos()
    today = now.date()
    if _is_sunday(today):
        return EmployeeClockOutOut(
            status="sunday",
            message="Sundays are excluded. No attendance is required today.",
            entry=None,
        )

    att = (
        db.query(models.EmployeeAttendanceEntry)
        .filter(
            models.EmployeeAttendanceEntry.employee_id == emp.id,
            models.EmployeeAttendanceEntry.attendance_date == today,
        )
        .first()
    )
    if att is None:
        return EmployeeClockOutOut(
            status="not_checked_in",
            message="You have not checked in today. Check in first before signing out.",
            entry=None,
        )
    if att.check_out_at is not None:
        late_id = getattr(getattr(att, "lateness_entry", None), "id", None)
        out = _attendance_row_to_history(att, lateness_entry_id=int(late_id) if late_id is not None else None)
        return EmployeeClockOutOut(
            status="already_checked_out",
            message=(
                f"Already signed out at {to_lagos(att.check_out_at).strftime('%I:%M %p').lstrip('0')}."
            ),
            entry=out,
        )

    gps_accuracy = float(body.accuracy_meters) if body.accuracy_meters is not None else None
    distance, allowed = _validate_geo_clock_in_distance(
        float(body.latitude),
        float(body.longitude),
        loc,
        gps_accuracy_meters=gps_accuracy,
        employee_id=int(emp.id),
    )

    att.check_out_at = utc_naive_from(now)
    att.check_out_latitude = float(body.latitude)
    att.check_out_longitude = float(body.longitude)
    att.check_out_distance_meters = float(distance)
    if att.work_location_id is None:
        att.work_location_id = loc.id

    expected_check_out = _closing_time_for_attendance_row(att, loc)
    early_mins = _early_check_out_minutes(att.check_out_at, cutoff=expected_check_out)
    att.is_early_check_out = early_mins > 0
    att.early_check_out_minutes = early_mins if early_mins > 0 else None
    if att.expected_check_out_time is None:
        att.expected_check_out_time = expected_check_out

    early_sign_out_entry_id: Optional[int] = None
    if att.is_early_check_out and emp.work_location_id is not None:
        shift_part = f" ({_shift_label(att.selected_shift)})" if att.selected_shift else ""
        early_note = (
            f"Early sign-out: {today.isoformat()}{shift_part} "
            f"(clock-out {to_lagos(now).strftime('%H:%M')}, closing {expected_check_out.strftime('%H:%M')})"
        )
        ese = _create_early_sign_out_entry(
            db,
            emp=emp,
            period_id=att.period_id,
            attendance_id=att.id,
            note=early_note,
            fee=_location_early_sign_out_fee(loc),
        )
        early_sign_out_entry_id = int(ese.id)

    _log_payroll(
        db,
        "employee_attendance_clock_out_geo",
        att.id,
        current_user,
        {
            "employee_id": emp.id,
            "attendance_date": today.isoformat(),
            "check_out_at": now.isoformat(),
            "work_location_id": int(loc.id),
            "employee_latitude": float(body.latitude),
            "employee_longitude": float(body.longitude),
            "distance_meters": float(distance),
            "allowed_radius_meters": allowed,
            "geo_validation_buffer_meters": _GEO_VALIDATION_BUFFER_METERS,
            "gps_accuracy_meters": gps_accuracy,
            "effective_radius_meters": _effective_geo_radius_meters(allowed, gps_accuracy),
            "expected_check_out_time": expected_check_out.strftime("%H:%M"),
            "is_early_check_out": att.is_early_check_out,
            "early_check_out_minutes": att.early_check_out_minutes,
            "early_sign_out_entry_id": early_sign_out_entry_id,
        },
    )
    db.commit()
    db.refresh(att)

    late_id = getattr(getattr(att, "lateness_entry", None), "id", None)
    out = _attendance_row_to_history(att, lateness_entry_id=int(late_id) if late_id is not None else None)
    message = "Check-out recorded."
    if att.is_early_check_out:
        fee = _location_early_sign_out_fee(loc)
        message = (
            f"Check-out recorded. Early sign-out before closing time; "
            f"a deduction of ₦{fee:,.0f} may apply."
        )
    return EmployeeClockOutOut(
        status="checked_out",
        message=message,
        entry=out,
    )


@router.get("/me/attendance/sign-out-preview", response_model=EmployeeSignOutPreviewOut)
def preview_sign_out_my_attendance(
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Preview sign-out confirmation using the shift locked at check-in."""
    emp = (
        db.query(models.Employee)
        .filter(models.Employee.user_id == current_user.id, models.Employee.deleted_at.is_(None))
        .first()
    )
    if emp is None:
        raise HTTPException(status_code=404, detail="No employee profile linked to your account.")
    if emp.work_location_id is None:
        raise HTTPException(status_code=409, detail="No work location assigned.")

    loc = db.query(models.CompanyLocation).filter(models.CompanyLocation.id == emp.work_location_id).first()
    if loc is None:
        raise HTTPException(status_code=409, detail="Your assigned work location no longer exists.")

    now = now_lagos()
    today = now.date()
    att = (
        db.query(models.EmployeeAttendanceEntry)
        .filter(
            models.EmployeeAttendanceEntry.employee_id == emp.id,
            models.EmployeeAttendanceEntry.attendance_date == today,
        )
        .first()
    )
    if att is None:
        raise HTTPException(status_code=409, detail="You have not checked in today.")
    if att.check_out_at is not None:
        raise HTTPException(status_code=409, detail="You have already signed out for today.")

    closing = _closing_time_for_attendance_row(att, loc)
    early_mins = _early_check_out_minutes(utc_naive_from(now), cutoff=closing)
    is_early = early_mins > 0
    fee = _location_early_sign_out_fee(loc) if is_early else Decimal("0")
    shift_label = _shift_label(getattr(att, "selected_shift", None))
    closing_label = closing.strftime("%I:%M %p").lstrip("0")
    current_label = now.strftime("%I:%M %p").lstrip("0")
    if is_early:
        message = (
            "This will be recorded as an early sign-out and a deduction may apply."
        )
    else:
        message = "You are signing out at or after your closing time."
    return EmployeeSignOutPreviewOut(
        shift_label=shift_label,
        closing_time=closing_label,
        current_time=current_label,
        is_early_sign_out=is_early,
        early_sign_out_fee_naira=fee,
        message=message,
    )


@router.patch("/{employee_id}/work-location", response_model=EmployeeOut)
def assign_employee_work_location(
    employee_id: int,
    body: EmployeeWorkLocationAssignIn,
    db: Session = Depends(get_db),
    current_user=Depends(require_role(["admin"])),
    period_year: Optional[int] = Query(None, ge=2000, le=2100),
    period_month: Optional[int] = Query(None, ge=1, le=12),
):
    emp = (
        db.query(models.Employee)
        .filter(models.Employee.id == employee_id, models.Employee.deleted_at.is_(None))
        .first()
    )
    if emp is None:
        raise HTTPException(status_code=404, detail="Employee not found")

    loc_id = body.location_id
    if loc_id is not None:
        loc = db.query(models.CompanyLocation).filter(models.CompanyLocation.id == int(loc_id)).first()
        if loc is None:
            raise HTTPException(status_code=404, detail="Location not found")
        _set_work_location_assignment(emp, int(loc.id))
    else:
        _set_work_location_assignment(emp, None)

    emp.updated_at = now_utc_naive()
    db.commit()

    period = resolve_period(db, period_year, period_month)
    lateness, penalties, bonuses, payroll = _load_rows_for_period(db, employee_id, period)
    return _employee_to_out(emp, db, period, lateness, penalties, bonuses, payroll)


@router.get("/location-assignments", response_model=list[EmployeeLocationAssignmentItemOut])
def list_employee_location_assignments(
    db: Session = Depends(get_db),
    current_user=Depends(require_role(["admin"])),
    search: str = Query("", max_length=200),
):
    q = db.query(models.Employee).filter(models.Employee.deleted_at.is_(None))
    s = (search or "").strip()
    if s:
        q = q.filter(models.Employee.full_name.ilike(f"%{s}%"))
    rows = q.order_by(models.Employee.full_name.asc(), models.Employee.id.asc()).all()
    return [
        EmployeeLocationAssignmentItemOut(
            id=e.id,
            full_name=e.full_name,
            work_location_id=getattr(e, "work_location_id", None),
            work_location=CompanyLocationOut.model_validate(e.work_location) if getattr(e, "work_location", None) else None,
        )
        for e in rows
    ]


@router.patch("/{employee_id}/location-assignment", response_model=EmployeeLocationAssignmentPatchOut)
def patch_employee_location_assignment(
    employee_id: int,
    body: EmployeeWorkLocationAssignIn,
    db: Session = Depends(get_db),
    current_user=Depends(require_role(["admin"])),
):
    emp = (
        db.query(models.Employee)
        .filter(models.Employee.id == employee_id, models.Employee.deleted_at.is_(None))
        .first()
    )
    if emp is None:
        raise HTTPException(status_code=404, detail="Employee not found")

    loc_id = body.location_id
    if loc_id is not None:
        loc = db.query(models.CompanyLocation).filter(models.CompanyLocation.id == int(loc_id)).first()
        if loc is None:
            raise HTTPException(status_code=404, detail="Location not found")
        _set_work_location_assignment(emp, int(loc.id))
    else:
        _set_work_location_assignment(emp, None)

    emp.updated_at = now_utc_naive()
    db.commit()
    db.refresh(emp)
    return EmployeeLocationAssignmentPatchOut(
        id=emp.id,
        full_name=emp.full_name,
        work_location_id=getattr(emp, "work_location_id", None),
        work_location=CompanyLocationOut.model_validate(emp.work_location) if getattr(emp, "work_location", None) else None,
    )


@router.get("/attendance/monitor/summary", response_model=AttendanceMonitorSummaryOut)
def attendance_monitor_summary(
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
    target_date: Optional[date_type] = Query(None, alias="date"),
):
    _require_attendance_oversight(current_user)
    day = target_date or lagos_today()
    monitor = _build_attendance_monitor(db, target_date=day)
    return monitor.summary


@router.get("/attendance/monitor", response_model=AttendanceMonitorOut)
def attendance_monitor(
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
    target_date: Optional[date_type] = Query(None, alias="date"),
    search: str = Query("", max_length=200),
    status: Optional[str] = Query(None, description="present | late | early_sign_out | absent | checked_in | incomplete_day"),
    location_id: Optional[int] = Query(None, ge=1),
    limit: Optional[int] = Query(None, ge=1, le=500),
    offset: int = Query(0, ge=0),
):
    _require_attendance_oversight(current_user)
    day = target_date or lagos_today()
    status_filter = (status or "").strip().lower() or None
    if status_filter and status_filter not in MONITOR_FILTER_STATUSES:
        raise HTTPException(status_code=400, detail="Invalid status filter")
    return _build_attendance_monitor(
        db,
        target_date=day,
        search=search,
        status_filter=status_filter,
        location_id=location_id,
        limit=limit,
        offset=offset,
    )


@router.get("/me/attendance", response_model=list[EmployeeAttendanceHistoryOut])
def list_my_attendance(
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
    limit: int = Query(60, ge=1, le=366),
    offset: int = Query(0, ge=0),
):
    emp = (
        db.query(models.Employee)
        .filter(models.Employee.user_id == current_user.id, models.Employee.deleted_at.is_(None))
        .first()
    )
    if emp is None:
        raise HTTPException(status_code=404, detail="No employee profile linked to your account.")

    history = _build_attendance_history(db, emp.id, limit=limit, offset=offset)
    db.commit()
    return history


@router.get("/{employee_id}/attendance/overview", response_model=EmployeeAttendanceOverviewOut)
def employee_attendance_overview(
    employee_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
    year: Optional[int] = Query(None, ge=2000, le=2100),
    month: Optional[int] = Query(None, ge=1, le=12),
):
    _require_attendance_oversight(current_user)
    emp = (
        db.query(models.Employee)
        .filter(models.Employee.id == employee_id, models.Employee.deleted_at.is_(None))
        .first()
    )
    if emp is None:
        raise HTTPException(status_code=404, detail="Employee not found")

    today = lagos_today()
    stats_year = year or today.year
    stats_month = month or today.month
    stats = _attendance_stats_for_month(db, employee_id, year=stats_year, month=stats_month)
    db.commit()
    return EmployeeAttendanceOverviewOut(
        employee_id=emp.id,
        full_name=emp.full_name or "",
        work_location=CompanyLocationOut.model_validate(emp.work_location) if emp.work_location else None,
        stats=stats,
    )


@router.get("/{employee_id}/attendance/months", response_model=list[EmployeeAttendanceMonthSummaryOut])
def employee_attendance_months(
    employee_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    _require_attendance_oversight(current_user)
    emp = (
        db.query(models.Employee)
        .filter(models.Employee.id == employee_id, models.Employee.deleted_at.is_(None))
        .first()
    )
    if emp is None:
        raise HTTPException(status_code=404, detail="Employee not found")

    months = _attendance_month_summaries(db, employee_id)
    db.commit()
    return months


@router.get("/{employee_id}/attendance/history", response_model=EmployeeAttendanceHistoryPageOut)
def employee_attendance_history_page(
    employee_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
    year: int = Query(..., ge=2000, le=2100),
    month: int = Query(..., ge=1, le=12),
    limit: int = Query(15, ge=1, le=100),
    offset: int = Query(0, ge=0),
):
    _require_attendance_oversight(current_user)
    emp = (
        db.query(models.Employee)
        .filter(models.Employee.id == employee_id, models.Employee.deleted_at.is_(None))
        .first()
    )
    if emp is None:
        raise HTTPException(status_code=404, detail="Employee not found")

    items, total = _build_attendance_history_page(
        db,
        employee_id,
        year=year,
        month=month,
        limit=limit,
        offset=offset,
    )
    db.commit()
    return EmployeeAttendanceHistoryPageOut(
        year=year,
        month=month,
        items=items,
        total=total,
        limit=limit,
        offset=offset,
    )


@router.get("/{employee_id}/attendance", response_model=list[EmployeeAttendanceHistoryOut])
def list_employee_attendance(
    employee_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
    limit: int = Query(60, ge=1, le=366),
    offset: int = Query(0, ge=0),
):
    emp = (
        db.query(models.Employee)
        .filter(models.Employee.id == employee_id, models.Employee.deleted_at.is_(None))
        .first()
    )
    if emp is None:
        raise HTTPException(status_code=404, detail="Employee not found")
    _assert_can_view(current_user, emp)

    history = _build_attendance_history(db, employee_id, limit=limit, offset=offset)
    db.commit()
    return history


@router.patch("/me", response_model=EmployeeOut)
def patch_my_employee(
    body: EmployeeSelfUpdate,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    emp = (
        db.query(models.Employee)
        .filter(models.Employee.user_id == current_user.id, models.Employee.deleted_at.is_(None))
        .first()
    )
    if emp is None:
        raise HTTPException(status_code=404, detail="No employee profile linked to your account.")
    data = body.model_dump(exclude_unset=True)
    for k, v in data.items():
        setattr(emp, k, v)
    emp.updated_at = now_utc_naive()
    db.commit()
    db.refresh(emp)
    period = resolve_period(db, None, None)
    lateness, penalties, bonuses, payroll = _load_rows_for_period(db, emp.id, period)
    return _employee_to_out(emp, db, period, lateness, penalties, bonuses, payroll)


@router.post("", response_model=EmployeeOut)
def create_employee(
    body: EmployeeCreate,
    db: Session = Depends(get_db),
    current_user=Depends(require_role(["admin", "factory"])),
):
    if body.user_id is not None:
        u = db.query(models.User).filter(models.User.id == body.user_id).first()
        if not u:
            raise HTTPException(status_code=400, detail="Linked user does not exist")
        taken = (
            db.query(models.Employee)
            .filter(models.Employee.user_id == body.user_id, models.Employee.deleted_at.is_(None))
            .first()
        )
        if taken:
            raise HTTPException(status_code=400, detail="That user is already linked to another employee")
        # Ensure DB-required employee.full_name is present even if omitted (linked user completes later).
        full_name = (body.full_name or "").strip() or (getattr(u, "name", None) or "").strip() or (getattr(u, "email", None) or "").strip()
    else:
        full_name = (body.full_name or "").strip()
        if not full_name:
            # This should be caught by schema validation, but keep a clear API error for safety.
            raise HTTPException(status_code=400, detail="full_name is required for standalone employees")
    emp = models.Employee(
        full_name=full_name,
        address=body.address,
        phone=body.phone,
        bank_name=body.bank_name,
        account_number=body.account_number,
        notes=body.notes,
        base_salary=body.base_salary,
        user_id=body.user_id,
        documents=[],
    )
    db.add(emp)
    db.flush()
    _bootstrap_employee_payroll(db, emp)
    db.commit()
    db.refresh(emp)
    period = resolve_period(db, None, None)
    lateness, penalties, bonuses, payroll = _load_rows_for_period(db, emp.id, period)
    return _employee_to_out(emp, db, period, lateness, penalties, bonuses, payroll)


@router.get("/{employee_id}", response_model=EmployeeOut)
def get_employee(
    employee_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
    period_year: Optional[int] = Query(None, ge=2000, le=2100),
    period_month: Optional[int] = Query(None, ge=1, le=12),
):
    emp = (
        db.query(models.Employee)
        .filter(models.Employee.id == employee_id, models.Employee.deleted_at.is_(None))
        .first()
    )
    if emp is None:
        raise HTTPException(status_code=404, detail="Employee not found")
    _assert_can_view(current_user, emp)
    period = resolve_period(db, period_year, period_month)
    lateness, penalties, bonuses, payroll = _load_rows_for_period(db, employee_id, period)
    return _employee_to_out(emp, db, period, lateness, penalties, bonuses, payroll)


@router.patch("/{employee_id}/payment", response_model=EmployeeOut)
def patch_employee_period_payment(
    employee_id: int,
    body: EmployeePaymentUpdate,
    db: Session = Depends(get_db),
    current_user=Depends(require_role(["admin"])),
    period_year: int = Query(..., ge=2000, le=2100),
    period_month: int = Query(..., ge=1, le=12),
):
    emp = (
        db.query(models.Employee)
        .filter(models.Employee.id == employee_id, models.Employee.deleted_at.is_(None))
        .first()
    )
    if emp is None:
        raise HTTPException(status_code=404, detail="Employee not found")
    period = get_or_create_period(db, period_year, period_month)
    _assert_period_is_editable(period)
    lateness, penalties, bonuses, payroll = _load_rows_for_period(db, employee_id, period)
    salary = _payroll_salary_for_employee(
        db,
        emp,
        period,
        sum((p.amount for p in penalties), Decimal("0")),
        sum((b.amount for b in bonuses), Decimal("0")),
        payroll=payroll,
    )
    _validate_breakdown(salary)

    row = _get_or_create_payroll_row(db, employee_id, period.id)

    if body.payment_status == "paid":
        if row.payment_status == "paid":
            raise HTTPException(status_code=400, detail="Salary is already marked paid for this period.")
        row.payment_status = "paid"
        row.payment_date = body.payment_date or now_utc_naive()
        row.payment_reference = body.payment_reference
        row.updated_at = now_utc_naive()
        row.updated_by_id = current_user.id
        _log_payroll(
            db,
            "employee_mark_paid",
            row.id,
            current_user,
            {"employee_id": employee_id, "period_id": period.id, "period_label": period.label},
        )
        _try_auto_mark_period_month_paid(db, period.id, current_user)
    else:
        row.payment_status = "unpaid"
        row.payment_date = None
        row.payment_reference = None
        row.updated_at = now_utc_naive()
        row.updated_by_id = current_user.id
        _log_payroll(
            db,
            "employee_mark_unpaid",
            row.id,
            current_user,
            {"employee_id": employee_id, "period_id": period.id},
        )

    db.commit()
    lateness, penalties, bonuses, payroll = _load_rows_for_period(db, employee_id, period)
    return _employee_to_out(emp, db, period, lateness, penalties, bonuses, payroll)


@router.patch("/{employee_id}/payroll-adjustments", response_model=EmployeeOut)
def patch_employee_payroll_adjustments(
    employee_id: int,
    body: EmployeePayrollAdjustmentIn,
    db: Session = Depends(get_db),
    current_user=Depends(require_role(["admin"])),
    period_year: int = Query(..., ge=2000, le=2100),
    period_month: int = Query(..., ge=1, le=12),
):
    """Update per-period payroll adjustments (base override, bonuses, deductions, late penalties)."""
    emp = (
        db.query(models.Employee)
        .filter(models.Employee.id == employee_id, models.Employee.deleted_at.is_(None))
        .first()
    )
    if emp is None:
        raise HTTPException(status_code=404, detail="Employee not found")
    period = get_or_create_period(db, period_year, period_month)
    _assert_period_is_editable(period)
    _assert_financial_mutable(db, employee_id, period.id, body.confirm_financial_edit)

    payroll = _get_or_create_payroll_row(db, employee_id, period.id)
    lateness, penalties, bonuses, _ = _load_rows_for_period(db, employee_id, period)
    lateness_count = _lateness_count_for_payroll(db, emp, period.id)
    ac = _absence_count_for_period(db, employee_id, period)
    apply_att = _attendance_deductions_apply(db, emp, period.id)
    auto_lateness = _lateness_deduction_sum_for_payroll(db, emp, period.id)
    auto_early = _early_sign_out_deduction_sum_for_payroll(db, emp, period.id)
    auto_absence = _absence_deduction_sum_for_payroll(db, emp, period)

    if body.period_base_salary is not None:
        payroll.period_base_salary = body.period_base_salary
    if body.bonus is not None:
        payroll.adjustment_bonus = body.bonus
    if body.deduction is not None:
        payroll.adjustment_deduction = body.deduction
    if body.lateness_deduction is not None:
        payroll.lateness_deduction_override = (
            body.lateness_deduction if body.lateness_deduction != auto_lateness else None
        )
        payroll.adjustment_late_penalty = Decimal("0")
    elif body.late_penalty is not None:
        payroll.adjustment_late_penalty = body.late_penalty
    if body.absence_deduction is not None:
        payroll.absence_deduction_override = (
            body.absence_deduction if body.absence_deduction != auto_absence else None
        )
    if body.early_sign_out_deduction is not None:
        payroll.early_sign_out_deduction_override = (
            body.early_sign_out_deduction
            if body.early_sign_out_deduction != auto_early
            else None
        )
    if body.note is not None:
        payroll.adjustment_note = body.note

    payroll.updated_at = now_utc_naive()
    payroll.updated_by_id = current_user.id
    emp.updated_at = now_utc_naive()

    pen_entries = sum((p.amount for p in penalties), Decimal("0"))
    bon_entries = sum((b.amount for b in bonuses), Decimal("0"))
    projected = _payroll_salary_for_employee(db, emp, period, pen_entries, bon_entries, payroll=payroll)
    _validate_breakdown(projected)

    _log_payroll(
        db,
        "employee_payroll_adjustments_update",
        payroll.id,
        current_user,
        {
            "employee_id": employee_id,
            "period_id": period.id,
            "period_label": period.label,
            "period_base_salary": str(payroll.period_base_salary) if payroll.period_base_salary is not None else None,
            "bonus": str(payroll.adjustment_bonus or 0),
            "deduction": str(payroll.adjustment_deduction or 0),
            "late_penalty": str(payroll.adjustment_late_penalty or 0),
            "lateness_deduction_override": (
                str(payroll.lateness_deduction_override)
                if payroll.lateness_deduction_override is not None
                else None
            ),
            "absence_deduction_override": (
                str(payroll.absence_deduction_override)
                if payroll.absence_deduction_override is not None
                else None
            ),
        },
    )

    db.commit()
    db.refresh(emp)
    lateness, penalties, bonuses, payroll = _load_rows_for_period(db, employee_id, period)
    return _employee_to_out(emp, db, period, lateness, penalties, bonuses, payroll)


@router.patch("/{employee_id}", response_model=EmployeeOut)
def patch_employee_admin(
    employee_id: int,
    body: EmployeeAdminUpdate,
    db: Session = Depends(get_db),
    current_user=Depends(require_role(["admin"])),
    period_year: Optional[int] = Query(None, ge=2000, le=2100),
    period_month: Optional[int] = Query(None, ge=1, le=12),
):
    emp = (
        db.query(models.Employee)
        .filter(models.Employee.id == employee_id, models.Employee.deleted_at.is_(None))
        .first()
    )
    if emp is None:
        raise HTTPException(status_code=404, detail="Employee not found")
    data = body.model_dump(exclude_unset=True)
    if "user_id" in data:
        new_uid = data["user_id"]
        if new_uid is not None:
            u = db.query(models.User).filter(models.User.id == new_uid).first()
            if not u:
                raise HTTPException(status_code=400, detail="Linked user does not exist")
            taken = (
                db.query(models.Employee)
                .filter(
                    models.Employee.user_id == new_uid,
                    models.Employee.id != employee_id,
                    models.Employee.deleted_at.is_(None),
                )
                .first()
            )
            if taken:
                raise HTTPException(status_code=400, detail="That user is already linked to another employee")
    for k, v in data.items():
        setattr(emp, k, v)
    emp.updated_at = now_utc_naive()
    period = resolve_period(db, period_year, period_month)
    lateness, penalties, bonuses, payroll = _load_rows_for_period(db, employee_id, period)
    br = _employee_to_out(emp, db, period, lateness, penalties, bonuses, payroll)
    try:
        _validate_breakdown(br.salary)
    except HTTPException:
        db.rollback()
        raise
    db.commit()
    return br


@router.delete("/{employee_id}")
def delete_employee(
    employee_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(require_role(["admin"])),
):
    emp = (
        db.query(models.Employee)
        .filter(models.Employee.id == employee_id, models.Employee.deleted_at.is_(None))
        .first()
    )
    if emp is None:
        raise HTTPException(status_code=404, detail="Employee not found")
    emp.deleted_at = now_utc_naive()
    emp.deleted_by_id = current_user.id
    emp.updated_at = now_utc_naive()
    db.commit()
    return {"message": "Employee removed"}


@router.post("/{employee_id}/lateness", response_model=EmployeeOut)
def add_lateness_entry(
    employee_id: int,
    body: EmployeeLatenessCreate,
    db: Session = Depends(get_db),
    current_user=Depends(require_role(["admin"])),
    period_year: Optional[int] = Query(None, ge=2000, le=2100),
    period_month: Optional[int] = Query(None, ge=1, le=12),
):
    emp = (
        db.query(models.Employee)
        .filter(models.Employee.id == employee_id, models.Employee.deleted_at.is_(None))
        .first()
    )
    if emp is None:
        raise HTTPException(status_code=404, detail="Employee not found")
    period = resolve_period(db, period_year, period_month)
    _assert_period_is_editable(period)
    _assert_financial_mutable(db, employee_id, period.id, body.confirm_financial_edit)

    lateness, penalties, bonuses, payroll = _load_rows_for_period(db, employee_id, period)
    pen = sum((p.amount for p in penalties), Decimal("0"))
    bon = sum((b.amount for b in bonuses), Decimal("0"))
    loc = None
    if emp.work_location_id is not None:
        loc = db.query(models.CompanyLocation).filter(models.CompanyLocation.id == emp.work_location_id).first()
    late_fee = _location_late_fee(loc)
    apply_att = _attendance_deductions_apply(db, emp, period.id)
    projected = _payroll_salary_for_employee(db, emp, period, pen, bon, payroll=payroll)
    if apply_att:
        projected = _salary_breakdown(
            emp.base_salary if emp.base_salary is not None else Decimal("0"),
            _lateness_count_for_payroll(db, emp, period.id) + 1,
            pen,
            bon,
            lateness_auto=_lateness_deduction_sum_for_payroll(db, emp, period.id) + late_fee,
            early_sign_out_count=_early_sign_out_count_for_payroll(db, emp, period.id),
            early_sign_out_auto=_early_sign_out_deduction_sum_for_payroll(db, emp, period.id),
            absence_count=_absence_count_for_period(db, emp.id, period),
            absence_auto=_absence_deduction_sum_for_payroll(db, emp, period),
            lateness_rate=_location_late_fee(loc),
            early_sign_out_rate=_location_early_sign_out_fee(loc),
            absence_rate=_location_absence_fee(loc),
            apply_attendance_deductions=True,
            **_payroll_breakdown_kwargs(payroll),
        )
    _validate_breakdown(projected)

    row = models.EmployeeLatenessEntry(
        employee_id=employee_id,
        period_id=period.id,
        note=body.note,
        deduction_amount_naira=late_fee if apply_att else None,
    )
    db.add(row)
    emp.updated_at = now_utc_naive()
    db.flush()
    lateness, penalties, bonuses, payroll = _load_rows_for_period(db, employee_id, period)
    out = _employee_to_out(emp, db, period, lateness, penalties, bonuses, payroll)
    _log_payroll(db, "employee_lateness_add", row.id, current_user, {"employee_id": employee_id, "period_id": period.id})
    db.commit()
    return out


@router.delete("/{employee_id}/lateness/{entry_id}", response_model=EmployeeOut)
def delete_lateness_entry(
    employee_id: int,
    entry_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(require_role(["admin"])),
    confirm_financial_edit: bool = Query(False),
    period_year: Optional[int] = Query(None, ge=2000, le=2100),
    period_month: Optional[int] = Query(None, ge=1, le=12),
):
    period = resolve_period(db, period_year, period_month)
    _assert_period_is_editable(period)
    _assert_financial_mutable(db, employee_id, period.id, confirm_financial_edit)
    row = (
        db.query(models.EmployeeLatenessEntry)
        .filter(
            models.EmployeeLatenessEntry.id == entry_id,
            models.EmployeeLatenessEntry.employee_id == employee_id,
            models.EmployeeLatenessEntry.period_id == period.id,
            models.EmployeeLatenessEntry.voided_at.is_(None),
        )
        .first()
    )
    if row is None:
        raise HTTPException(status_code=404, detail="Lateness entry not found")
    row.voided_at = now_utc_naive()
    row.voided_by_id = current_user.id
    row.void_reason = "void_via_delete_endpoint"
    log_financial_action(
        db,
        action="payroll_lateness_void",
        entity_type="employee_lateness_entry",
        entity_id=row.id,
        actor_user=current_user,
        meta={"employee_id": employee_id, "period_id": period.id},
    )
    emp = (
        db.query(models.Employee)
        .filter(models.Employee.id == employee_id, models.Employee.deleted_at.is_(None))
        .first()
    )
    if emp:
        emp.updated_at = now_utc_naive()
    db.commit()
    lateness, penalties, bonuses, payroll = _load_rows_for_period(db, employee_id, period)
    return _employee_to_out(emp, db, period, lateness, penalties, bonuses, payroll)


@router.post("/{employee_id}/lateness/{entry_id}/void", response_model=EmployeeOut)
def void_lateness_entry(
    employee_id: int,
    entry_id: int,
    reason: str = Query("", max_length=4000),
    db: Session = Depends(get_db),
    current_user=Depends(require_role(["admin"])),
    confirm_financial_edit: bool = Query(False),
    period_year: Optional[int] = Query(None, ge=2000, le=2100),
    period_month: Optional[int] = Query(None, ge=1, le=12),
):
    period = resolve_period(db, period_year, period_month)
    _assert_period_is_editable(period)
    _assert_financial_mutable(db, employee_id, period.id, confirm_financial_edit)
    row = (
        db.query(models.EmployeeLatenessEntry)
        .filter(
            models.EmployeeLatenessEntry.id == entry_id,
            models.EmployeeLatenessEntry.employee_id == employee_id,
            models.EmployeeLatenessEntry.period_id == period.id,
            models.EmployeeLatenessEntry.voided_at.is_(None),
        )
        .first()
    )
    if row is None:
        raise HTTPException(status_code=404, detail="Lateness entry not found")
    row.voided_at = now_utc_naive()
    row.voided_by_id = current_user.id
    row.void_reason = (reason or "").strip() or None
    log_financial_action(
        db,
        action="payroll_lateness_void",
        entity_type="employee_lateness_entry",
        entity_id=row.id,
        actor_user=current_user,
        meta={"employee_id": employee_id, "period_id": period.id, "reason": row.void_reason},
    )
    emp = (
        db.query(models.Employee)
        .filter(models.Employee.id == employee_id, models.Employee.deleted_at.is_(None))
        .first()
    )
    if emp:
        emp.updated_at = now_utc_naive()
    db.commit()
    lateness, penalties, bonuses, payroll = _load_rows_for_period(db, employee_id, period)
    return _employee_to_out(emp, db, period, lateness, penalties, bonuses, payroll)


@router.post("/{employee_id}/penalties", response_model=EmployeeOut)
def add_penalty(
    employee_id: int,
    body: EmployeePenaltyCreate,
    db: Session = Depends(get_db),
    current_user=Depends(require_role(["admin"])),
    period_year: Optional[int] = Query(None, ge=2000, le=2100),
    period_month: Optional[int] = Query(None, ge=1, le=12),
):
    emp = (
        db.query(models.Employee)
        .filter(models.Employee.id == employee_id, models.Employee.deleted_at.is_(None))
        .first()
    )
    if emp is None:
        raise HTTPException(status_code=404, detail="Employee not found")
    period = resolve_period(db, period_year, period_month)
    _assert_period_is_editable(period)
    _assert_financial_mutable(db, employee_id, period.id, body.confirm_financial_edit)

    lateness, penalties, bonuses, payroll = _load_rows_for_period(db, employee_id, period)
    pen = sum((p.amount for p in penalties), Decimal("0")) + body.amount
    bon = sum((b.amount for b in bonuses), Decimal("0"))
    projected = _payroll_salary_for_employee(db, emp, period, pen, bon, payroll=payroll)
    _validate_breakdown(projected)

    row = models.EmployeePenalty(
        employee_id=employee_id,
        period_id=period.id,
        description=body.description.strip(),
        amount=body.amount,
    )
    db.add(row)
    emp.updated_at = now_utc_naive()
    db.flush()
    lateness, penalties, bonuses, payroll = _load_rows_for_period(db, employee_id, period)
    out = _employee_to_out(emp, db, period, lateness, penalties, bonuses, payroll)
    _log_payroll(db, "employee_penalty_add", row.id, current_user, {"employee_id": employee_id, "period_id": period.id})
    db.commit()
    return out


@router.delete("/{employee_id}/penalties/{penalty_id}", response_model=EmployeeOut)
def delete_penalty(
    employee_id: int,
    penalty_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(require_role(["admin"])),
    confirm_financial_edit: bool = Query(False),
    period_year: Optional[int] = Query(None, ge=2000, le=2100),
    period_month: Optional[int] = Query(None, ge=1, le=12),
):
    period = resolve_period(db, period_year, period_month)
    _assert_period_is_editable(period)
    _assert_financial_mutable(db, employee_id, period.id, confirm_financial_edit)
    row = (
        db.query(models.EmployeePenalty)
        .filter(
            models.EmployeePenalty.id == penalty_id,
            models.EmployeePenalty.employee_id == employee_id,
            models.EmployeePenalty.period_id == period.id,
            models.EmployeePenalty.voided_at.is_(None),
        )
        .first()
    )
    if row is None:
        raise HTTPException(status_code=404, detail="Penalty not found")
    row.voided_at = now_utc_naive()
    row.voided_by_id = current_user.id
    row.void_reason = "void_via_delete_endpoint"
    log_financial_action(
        db,
        action="payroll_penalty_void",
        entity_type="employee_penalty",
        entity_id=row.id,
        actor_user=current_user,
        meta={"employee_id": employee_id, "period_id": period.id},
    )
    emp = (
        db.query(models.Employee)
        .filter(models.Employee.id == employee_id, models.Employee.deleted_at.is_(None))
        .first()
    )
    if emp:
        emp.updated_at = now_utc_naive()
    db.commit()
    lateness, penalties, bonuses, payroll = _load_rows_for_period(db, employee_id, period)
    return _employee_to_out(emp, db, period, lateness, penalties, bonuses, payroll)


@router.post("/{employee_id}/penalties/{penalty_id}/void", response_model=EmployeeOut)
def void_penalty(
    employee_id: int,
    penalty_id: int,
    reason: str = Query("", max_length=4000),
    db: Session = Depends(get_db),
    current_user=Depends(require_role(["admin"])),
    confirm_financial_edit: bool = Query(False),
    period_year: Optional[int] = Query(None, ge=2000, le=2100),
    period_month: Optional[int] = Query(None, ge=1, le=12),
):
    period = resolve_period(db, period_year, period_month)
    _assert_period_is_editable(period)
    _assert_financial_mutable(db, employee_id, period.id, confirm_financial_edit)
    row = (
        db.query(models.EmployeePenalty)
        .filter(
            models.EmployeePenalty.id == penalty_id,
            models.EmployeePenalty.employee_id == employee_id,
            models.EmployeePenalty.period_id == period.id,
            models.EmployeePenalty.voided_at.is_(None),
        )
        .first()
    )
    if row is None:
        raise HTTPException(status_code=404, detail="Penalty not found")
    row.voided_at = now_utc_naive()
    row.voided_by_id = current_user.id
    row.void_reason = (reason or "").strip() or None
    log_financial_action(
        db,
        action="payroll_penalty_void",
        entity_type="employee_penalty",
        entity_id=row.id,
        actor_user=current_user,
        meta={"employee_id": employee_id, "period_id": period.id, "reason": row.void_reason},
    )
    emp = (
        db.query(models.Employee)
        .filter(models.Employee.id == employee_id, models.Employee.deleted_at.is_(None))
        .first()
    )
    if emp:
        emp.updated_at = now_utc_naive()
    db.commit()
    lateness, penalties, bonuses, payroll = _load_rows_for_period(db, employee_id, period)
    return _employee_to_out(emp, db, period, lateness, penalties, bonuses, payroll)


@router.post("/{employee_id}/bonuses", response_model=EmployeeOut)
def add_bonus(
    employee_id: int,
    body: EmployeeBonusCreate,
    db: Session = Depends(get_db),
    current_user=Depends(require_role(["admin"])),
    period_year: Optional[int] = Query(None, ge=2000, le=2100),
    period_month: Optional[int] = Query(None, ge=1, le=12),
):
    emp = (
        db.query(models.Employee)
        .filter(models.Employee.id == employee_id, models.Employee.deleted_at.is_(None))
        .first()
    )
    if emp is None:
        raise HTTPException(status_code=404, detail="Employee not found")
    period = resolve_period(db, period_year, period_month)
    _assert_period_is_editable(period)
    _assert_financial_mutable(db, employee_id, period.id, body.confirm_financial_edit)

    lateness, penalties, bonuses, payroll = _load_rows_for_period(db, employee_id, period)
    pen = sum((p.amount for p in penalties), Decimal("0"))
    bon = sum((b.amount for b in bonuses), Decimal("0")) + body.amount
    projected = _payroll_salary_for_employee(db, emp, period, pen, bon, payroll=payroll)
    _validate_breakdown(projected)

    row = models.EmployeeBonus(
        employee_id=employee_id,
        period_id=period.id,
        description=body.description.strip(),
        amount=body.amount,
    )
    db.add(row)
    emp.updated_at = now_utc_naive()
    db.flush()
    lateness, penalties, bonuses, payroll = _load_rows_for_period(db, employee_id, period)
    out = _employee_to_out(emp, db, period, lateness, penalties, bonuses, payroll)
    _log_payroll(db, "employee_bonus_add", row.id, current_user, {"employee_id": employee_id, "period_id": period.id})
    db.commit()
    return out


@router.delete("/{employee_id}/bonuses/{bonus_id}", response_model=EmployeeOut)
def delete_bonus(
    employee_id: int,
    bonus_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(require_role(["admin"])),
    confirm_financial_edit: bool = Query(False),
    period_year: Optional[int] = Query(None, ge=2000, le=2100),
    period_month: Optional[int] = Query(None, ge=1, le=12),
):
    period = resolve_period(db, period_year, period_month)
    _assert_period_is_editable(period)
    _assert_financial_mutable(db, employee_id, period.id, confirm_financial_edit)
    row = (
        db.query(models.EmployeeBonus)
        .filter(
            models.EmployeeBonus.id == bonus_id,
            models.EmployeeBonus.employee_id == employee_id,
            models.EmployeeBonus.period_id == period.id,
            models.EmployeeBonus.voided_at.is_(None),
        )
        .first()
    )
    if row is None:
        raise HTTPException(status_code=404, detail="Bonus not found")
    row.voided_at = now_utc_naive()
    row.voided_by_id = current_user.id
    row.void_reason = "void_via_delete_endpoint"
    log_financial_action(
        db,
        action="payroll_bonus_void",
        entity_type="employee_bonus",
        entity_id=row.id,
        actor_user=current_user,
        meta={"employee_id": employee_id, "period_id": period.id},
    )
    emp = (
        db.query(models.Employee)
        .filter(models.Employee.id == employee_id, models.Employee.deleted_at.is_(None))
        .first()
    )
    if emp:
        emp.updated_at = now_utc_naive()
    db.commit()
    lateness, penalties, bonuses, payroll = _load_rows_for_period(db, employee_id, period)
    return _employee_to_out(emp, db, period, lateness, penalties, bonuses, payroll)


@router.post("/{employee_id}/bonuses/{bonus_id}/void", response_model=EmployeeOut)
def void_bonus(
    employee_id: int,
    bonus_id: int,
    reason: str = Query("", max_length=4000),
    db: Session = Depends(get_db),
    current_user=Depends(require_role(["admin"])),
    confirm_financial_edit: bool = Query(False),
    period_year: Optional[int] = Query(None, ge=2000, le=2100),
    period_month: Optional[int] = Query(None, ge=1, le=12),
):
    period = resolve_period(db, period_year, period_month)
    _assert_period_is_editable(period)
    _assert_financial_mutable(db, employee_id, period.id, confirm_financial_edit)
    row = (
        db.query(models.EmployeeBonus)
        .filter(
            models.EmployeeBonus.id == bonus_id,
            models.EmployeeBonus.employee_id == employee_id,
            models.EmployeeBonus.period_id == period.id,
            models.EmployeeBonus.voided_at.is_(None),
        )
        .first()
    )
    if row is None:
        raise HTTPException(status_code=404, detail="Bonus not found")
    row.voided_at = now_utc_naive()
    row.voided_by_id = current_user.id
    row.void_reason = (reason or "").strip() or None
    log_financial_action(
        db,
        action="payroll_bonus_void",
        entity_type="employee_bonus",
        entity_id=row.id,
        actor_user=current_user,
        meta={"employee_id": employee_id, "period_id": period.id, "reason": row.void_reason},
    )
    emp = (
        db.query(models.Employee)
        .filter(models.Employee.id == employee_id, models.Employee.deleted_at.is_(None))
        .first()
    )
    if emp:
        emp.updated_at = now_utc_naive()
    db.commit()
    lateness, penalties, bonuses, payroll = _load_rows_for_period(db, employee_id, period)
    return _employee_to_out(emp, db, period, lateness, penalties, bonuses, payroll)


@router.post("/{employee_id}/documents", response_model=EmployeeOut)
async def upload_document(
    employee_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
    file: UploadFile = File(...),
    label: Optional[str] = Form(None),
    period_year: Optional[int] = Query(None, ge=2000, le=2100),
    period_month: Optional[int] = Query(None, ge=1, le=12),
):
    emp = (
        db.query(models.Employee)
        .filter(models.Employee.id == employee_id, models.Employee.deleted_at.is_(None))
        .first()
    )
    if emp is None:
        raise HTTPException(status_code=404, detail="Employee not found")
    _assert_can_view(current_user, emp)
    if _is_admin(current_user):
        pass
    else:
        _assert_can_edit_self_profile(current_user, emp)

    url = upload_asset(file, folder="employee_documents")
    docs = list(emp.documents or [])
    doc_id = str(uuid.uuid4())
    docs.append(
        {
            "id": doc_id,
            "url": url,
            "label": (label or "").strip() or None,
            "uploaded_at": now_utc_naive().replace(microsecond=0).isoformat() + "Z",
        }
    )
    emp.documents = docs
    emp.updated_at = now_utc_naive()
    db.commit()
    period = resolve_period(db, period_year, period_month)
    lateness, penalties, bonuses, payroll = _load_rows_for_period(db, employee_id, period)
    return _employee_to_out(emp, db, period, lateness, penalties, bonuses, payroll)


@router.delete("/{employee_id}/documents/{doc_id}", response_model=EmployeeOut)
def delete_document(
    employee_id: int,
    doc_id: str,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
    period_year: Optional[int] = Query(None, ge=2000, le=2100),
    period_month: Optional[int] = Query(None, ge=1, le=12),
):
    emp = (
        db.query(models.Employee)
        .filter(models.Employee.id == employee_id, models.Employee.deleted_at.is_(None))
        .first()
    )
    if emp is None:
        raise HTTPException(status_code=404, detail="Employee not found")
    _assert_can_view(current_user, emp)
    if _is_admin(current_user):
        pass
    else:
        _assert_can_edit_self_profile(current_user, emp)

    docs = [d for d in (emp.documents or []) if isinstance(d, dict) and d.get("id") != doc_id]
    if len(docs) == len(emp.documents or []):
        raise HTTPException(status_code=404, detail="Document not found")
    emp.documents = docs
    emp.updated_at = now_utc_naive()
    db.commit()
    period = resolve_period(db, period_year, period_month)
    lateness, penalties, bonuses, payroll = _load_rows_for_period(db, employee_id, period)
    return _employee_to_out(emp, db, period, lateness, penalties, bonuses, payroll)


@router.post("/{employee_id}/payments/send-to-finance", response_model=EmployeeTransactionOut)
def send_monthly_payment_to_finance(
    employee_id: int,
    body: EmployeeSendPaymentToFinance,
    db: Session = Depends(get_db),
    current_user=Depends(require_role(["admin"])),
    period_year: int = Query(..., ge=2000, le=2100),
    period_month: int = Query(..., ge=1, le=12),
):
    """Create a pending payment transaction for Finance to confirm.

    This does NOT mark the payroll period paid until confirmed.
    """
    emp = (
        db.query(models.Employee)
        .filter(models.Employee.id == employee_id, models.Employee.deleted_at.is_(None))
        .first()
    )
    if emp is None:
        raise HTTPException(status_code=404, detail="Employee not found")
    period = get_or_create_period(db, period_year, period_month)
    _assert_period_is_editable(period)

    existing = (
        db.query(models.EmployeeTransaction)
        .filter(
            models.EmployeeTransaction.employee_id == employee_id,
            models.EmployeeTransaction.period_id == period.id,
            models.EmployeeTransaction.txn_type == "payment",
            models.EmployeeTransaction.status == "pending",
        )
        .first()
    )
    if existing:
        raise HTTPException(status_code=409, detail="This employee already has a pending payment for this period.")

    # Do not allow send-to-finance if already marked paid.
    if _period_paid(db, employee_id, period.id):
        raise HTTPException(status_code=409, detail="This period is already marked paid.")

    txn = models.EmployeeTransaction(
        employee_id=employee_id,
        period_id=period.id,
        txn_type="payment",
        amount=body.amount,
        status="pending",
        note=body.note,
        created_by_id=current_user.id,
    )
    db.add(txn)
    db.flush()
    log_financial_action(
        db,
        action="send_to_finance",
        entity_type="employee_transaction",
        entity_id=txn.id,
        actor_user=current_user,
        meta={
            "employee_kind": "monthly",
            "employee_id": employee_id,
            "period_id": period.id,
            "period_label": period.label,
            "amount": str(body.amount),
            "note": body.note,
        },
    )
    db.commit()
    db.refresh(txn)
    return EmployeeTransactionOut.model_validate(txn)


@router.get("/{employee_id}/transactions", response_model=list[EmployeeTransactionOut])
def list_employee_transactions(
    employee_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(require_role(["admin", "finance"])),
    period_year: Optional[int] = Query(None, ge=2000, le=2100),
    period_month: Optional[int] = Query(None, ge=1, le=12),
):
    period_id: Optional[int] = None
    if period_year is not None or period_month is not None:
        if period_year is None or period_month is None:
            raise HTTPException(status_code=400, detail="Provide both period_year and period_month, or neither.")
        p = get_or_create_period(db, int(period_year), int(period_month))
        period_id = p.id

    q = db.query(models.EmployeeTransaction).filter(models.EmployeeTransaction.employee_id == employee_id)
    if period_id is not None:
        q = q.filter(models.EmployeeTransaction.period_id == period_id)
    role = normalize_role(getattr(current_user, "role", None))
    if role == "finance":
        q = q.filter(
            models.EmployeeTransaction.txn_type == "payment",
            models.EmployeeTransaction.status == "pending",
        )
    # For monthly employees, compute a "remaining salary balance" running value within the selected period.
    # This allows showing a running balance after each transaction even though monthly salaries aren't stored as a ledger.
    rows = q.order_by(models.EmployeeTransaction.created_at.asc(), models.EmployeeTransaction.id.asc()).all()
    outs: list[EmployeeTransactionOut] = [EmployeeTransactionOut.model_validate(r) for r in rows]
    if period_id is not None and role != "finance":
        emp = (
            db.query(models.Employee)
            .filter(models.Employee.id == employee_id, models.Employee.deleted_at.is_(None))
            .first()
        )
        period = db.query(models.SalaryPeriod).filter(models.SalaryPeriod.id == period_id).first()
        if emp and period:
            lateness, penalties, bonuses, payroll = _load_rows_for_period(db, employee_id, period)
            pen = sum((p.amount for p in penalties), Decimal("0"))
            bon = sum((b.amount for b in bonuses), Decimal("0"))
            salary = _payroll_salary_for_employee(db, emp, period, pen, bon, payroll=payroll)
            due = salary.final_payable
            paid_total = Decimal("0")
            for o in outs:
                if o.txn_type == "payment" and o.status == "paid":
                    paid_total += Decimal(str(o.amount or 0))
                o.running_balance = due - paid_total
    # Return newest-first for UI display, while keeping computed balances.
    outs.sort(key=lambda x: (x.created_at, x.id), reverse=True)
    return outs
