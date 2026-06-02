from __future__ import annotations

from dataclasses import dataclass
from datetime import date as date_type, datetime, time
from decimal import Decimal
from typing import Optional

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app import models
from app.routes.employees import ensure_payroll_periods_current, get_or_create_period
from app.utils.timezone import lagos_date_of, now_lagos, utc_naive_from


@dataclass(frozen=True)
class CutoffProcessResult:
    attendance_date: date_type
    locations_processed: int
    employees_marked_absent: int


def _period_paid(db: Session, employee_id: int, period_id: int) -> bool:
    r = db.query(models.EmployeePeriodPayroll).filter_by(employee_id=employee_id, period_id=period_id).first()
    return r is not None and r.payment_status == "paid"


def _format_cutoff_12h(t: time) -> str:
    return datetime(2000, 1, 1, t.hour, t.minute).strftime("%I:%M %p").lstrip("0")


def process_due_attendance_cutoffs(db: Session, *, at: Optional[datetime] = None) -> CutoffProcessResult:
    """Process due per-location cutoffs for *today* (Africa/Lagos).

    Idempotent:
    - Uses `attendance_cutoff_runs` unique (location_id, attendance_date)
    - Uses `employee_absence_entries` unique (employee_id, absence_date)
    """
    now = at if at is not None else now_lagos()
    today = now.date()

    due_locations = (
        db.query(models.CompanyLocation)
        .filter(models.CompanyLocation.attendance_cutoff_time.isnot(None))
        .order_by(models.CompanyLocation.id.asc())
        .all()
    )

    locations_processed = 0
    employees_marked_absent = 0

    for loc in due_locations:
        cutoff: Optional[time] = getattr(loc, "attendance_cutoff_time", None)
        if cutoff is None:
            continue
        # Cutoff closes attendance at the exact cutoff time.
        if now.time() < cutoff:
            continue

        # Ensure run is created once (idempotency). Use a SAVEPOINT so a duplicate
        # doesn't rollback any prior location processing in the same session.
        try:
            with db.begin_nested():
                run = models.AttendanceCutoffRun(
                    location_id=int(loc.id),
                    attendance_date=today,
                    cutoff_time_used=cutoff,
                    processed_at=utc_naive_from(now),
                    meta={
                        "cutoff_display": _format_cutoff_12h(cutoff),
                        "absence_fee_naira": str(getattr(loc, "absence_fee_naira", 0) or 0),
                    },
                )
                db.add(run)
                db.flush()
        except IntegrityError:
            continue

        ensure_payroll_periods_current(db)
        period = get_or_create_period(db, today.year, today.month)

        # Only evaluate employees assigned to this location, and only active employees.
        emps = (
            db.query(models.Employee)
            .filter(
                models.Employee.deleted_at.is_(None),
                models.Employee.work_location_id == int(loc.id),
            )
            .order_by(models.Employee.id.asc())
            .all()
        )

        loc_absence_fee = Decimal(str(getattr(loc, "absence_fee_naira", 0) or 0))

        for emp in emps:
            # Expected to work today: match existing system behavior (Sundays excluded).
            if today.weekday() == 6:
                continue

            assigned_at = getattr(emp, "work_location_assigned_at", None)
            if assigned_at is not None and lagos_date_of(assigned_at) > today:
                continue

            # If period is already marked paid, never mutate payroll history.
            if _period_paid(db, int(emp.id), int(period.id)):
                continue

            existing_attendance = (
                db.query(models.EmployeeAttendanceEntry.id)
                .filter(
                    models.EmployeeAttendanceEntry.employee_id == int(emp.id),
                    models.EmployeeAttendanceEntry.attendance_date == today,
                )
                .first()
            )
            if existing_attendance is not None:
                continue

            # Idempotent per employee/day via unique constraint.
            note = (
                f"Absent (auto): no attendance marked by cutoff {cutoff.strftime('%H:%M')} "
                f"for location {loc.name} on {today.isoformat()}."
            )
            absence = models.EmployeeAbsenceEntry(
                employee_id=int(emp.id),
                period_id=int(period.id),
                absence_date=today,
                deduction_amount_naira=loc_absence_fee,
                note=note,
                location_id_used=int(loc.id),
                attendance_cutoff_time_used=cutoff,
                processed_at=utc_naive_from(now),
            )
            try:
                with db.begin_nested():
                    db.add(absence)
                    db.flush()
            except IntegrityError:
                continue
            employees_marked_absent += 1

        locations_processed += 1

    return CutoffProcessResult(
        attendance_date=today,
        locations_processed=locations_processed,
        employees_marked_absent=employees_marked_absent,
    )

