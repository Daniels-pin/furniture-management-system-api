"""Attendance deduction waiver business logic."""

from __future__ import annotations

from collections import defaultdict
from datetime import date as date_type
from decimal import Decimal
from typing import Literal, Optional

from fastapi import HTTPException
from sqlalchemy import and_, or_
from sqlalchemy.orm import Session, joinedload

from app import models
from app.utils.financial_audit import log_financial_action
from app.utils.timezone import now_utc_naive

DeductionType = Literal["late", "early_sign_out", "absence"]
WaiverKind = Literal["individual", "daily"]

WAIVER_REASON_LABELS: dict[str, str] = {
    "heavy_rain": "Heavy Rain",
    "medical_emergency": "Medical Emergency",
    "official_assignment": "Official Assignment",
    "approved_leave": "Approved Leave",
    "public_holiday": "Public Holiday",
    "vehicle_breakdown": "Vehicle Breakdown",
    "management_approval": "Management Approval",
    "other": "Other",
}

MONTH_PAYMENT_PAID = "paid"


def format_waiver_reason(reason_code: str, reason_text: Optional[str] = None) -> str:
    code = (reason_code or "").strip().lower()
    if code == "other":
        custom = (reason_text or "").strip()
        if not custom:
            return "Other"
        return custom
    return WAIVER_REASON_LABELS.get(code, reason_code.replace("_", " ").title())


def validate_waiver_reason(reason_code: str, reason_text: Optional[str]) -> tuple[str, Optional[str]]:
    code = (reason_code or "").strip().lower()
    if code not in WAIVER_REASON_LABELS:
        raise HTTPException(status_code=400, detail="Invalid waiver reason.")
    text = (reason_text or "").strip() or None
    if code == "other" and not text:
        raise HTTPException(status_code=400, detail="Custom reason text is required when reason is Other.")
    return code, text


def _decimal_amount(value: object) -> Decimal:
    if value is None:
        return Decimal("0")
    return Decimal(str(value))


def _user_display_name(user: Optional[models.User]) -> str:
    if user is None:
        return "Admin"
    name = (getattr(user, "name", None) or "").strip()
    if name:
        return name
    return getattr(user, "email", None) or "Admin"


def active_waiver_filter():
    return models.AttendanceDeductionWaiver.reversed_at.is_(None)


def waived_lateness_entry_ids_query(db: Session, *, period_id: Optional[int] = None):
    q = db.query(models.AttendanceDeductionWaiver.lateness_entry_id).filter(
        active_waiver_filter(),
        models.AttendanceDeductionWaiver.lateness_entry_id.isnot(None),
    )
    if period_id is not None:
        q = q.filter(models.AttendanceDeductionWaiver.period_id == period_id)
    return q


def waived_early_sign_out_entry_ids_query(db: Session, *, period_id: Optional[int] = None):
    q = db.query(models.AttendanceDeductionWaiver.early_sign_out_entry_id).filter(
        active_waiver_filter(),
        models.AttendanceDeductionWaiver.early_sign_out_entry_id.isnot(None),
    )
    if period_id is not None:
        q = q.filter(models.AttendanceDeductionWaiver.period_id == period_id)
    return q


def waived_absence_entry_ids_query(db: Session, *, period_id: Optional[int] = None):
    q = db.query(models.AttendanceDeductionWaiver.absence_entry_id).filter(
        active_waiver_filter(),
        models.AttendanceDeductionWaiver.absence_entry_id.isnot(None),
    )
    if period_id is not None:
        q = q.filter(models.AttendanceDeductionWaiver.period_id == period_id)
    return q


def exclude_waived_lateness(q, db: Session, *, period_id: Optional[int] = None):
    waived_ids = [row[0] for row in waived_lateness_entry_ids_query(db, period_id=period_id).all() if row[0] is not None]
    if waived_ids:
        q = q.filter(~models.EmployeeLatenessEntry.id.in_(waived_ids))
    return q


def exclude_waived_early_sign_out(q, db: Session, *, period_id: Optional[int] = None):
    waived_ids = [
        row[0] for row in waived_early_sign_out_entry_ids_query(db, period_id=period_id).all() if row[0] is not None
    ]
    if waived_ids:
        q = q.filter(~models.EmployeeEarlySignOutEntry.id.in_(waived_ids))
    return q


def exclude_waived_absence(q, db: Session, *, period_id: Optional[int] = None):
    waived_ids = [row[0] for row in waived_absence_entry_ids_query(db, period_id=period_id).all() if row[0] is not None]
    if waived_ids:
        q = q.filter(~models.EmployeeAbsenceEntry.id.in_(waived_ids))
    return q


def is_payroll_finalized_for_waiver(db: Session, employee_id: int, period_id: int) -> tuple[bool, str]:
    period = db.query(models.SalaryPeriod).filter(models.SalaryPeriod.id == period_id).first()
    if period is None:
        return True, "Payroll period not found."
    if (period.month_payment_status or "") == MONTH_PAYMENT_PAID:
        return (
            True,
            "This payroll month has already been marked as paid. Reopen the month or create a payroll adjustment before waiving attendance deductions.",
        )
    if not period.is_active and (period.month_payment_status or "") == MONTH_PAYMENT_PAID:
        return (
            True,
            "This archived payroll month has been finalized. Reopen the month or create a payroll adjustment before waiving attendance deductions.",
        )
    payroll = (
        db.query(models.EmployeePeriodPayroll)
        .filter_by(employee_id=employee_id, period_id=period_id)
        .first()
    )
    if payroll is not None and payroll.payment_status == "paid":
        return (
            True,
            "This employee's payroll for this month is already marked paid. Create a payroll adjustment or reopen payment before waiving deductions.",
        )
    return False, ""


def assert_waiver_financial_mutable(db: Session, employee_id: int, period_id: int) -> None:
    blocked, detail = is_payroll_finalized_for_waiver(db, employee_id, period_id)
    if blocked:
        raise HTTPException(status_code=409, detail=detail)


def _find_lateness_entry(db: Session, employee_id: int, attendance_date: date_type) -> Optional[models.EmployeeLatenessEntry]:
    att = (
        db.query(models.EmployeeAttendanceEntry)
        .filter(
            models.EmployeeAttendanceEntry.employee_id == employee_id,
            models.EmployeeAttendanceEntry.attendance_date == attendance_date,
        )
        .first()
    )
    if att is not None:
        row = (
            db.query(models.EmployeeLatenessEntry)
            .filter(
                models.EmployeeLatenessEntry.employee_id == employee_id,
                models.EmployeeLatenessEntry.attendance_id == att.id,
                models.EmployeeLatenessEntry.voided_at.is_(None),
            )
            .first()
        )
        if row is not None:
            return row
    return (
        db.query(models.EmployeeLatenessEntry)
        .outerjoin(
            models.EmployeeAttendanceEntry,
            models.EmployeeLatenessEntry.attendance_id == models.EmployeeAttendanceEntry.id,
        )
        .filter(
            models.EmployeeLatenessEntry.employee_id == employee_id,
            models.EmployeeLatenessEntry.voided_at.is_(None),
            or_(
                models.EmployeeAttendanceEntry.attendance_date == attendance_date,
                and_(
                    models.EmployeeLatenessEntry.attendance_id.is_(None),
                    models.EmployeeLatenessEntry.created_at >= attendance_date,
                ),
            ),
        )
        .order_by(models.EmployeeLatenessEntry.id.desc())
        .first()
    )


def _find_early_sign_out_entry(
    db: Session, employee_id: int, attendance_date: date_type
) -> Optional[models.EmployeeEarlySignOutEntry]:
    att = (
        db.query(models.EmployeeAttendanceEntry)
        .filter(
            models.EmployeeAttendanceEntry.employee_id == employee_id,
            models.EmployeeAttendanceEntry.attendance_date == attendance_date,
        )
        .first()
    )
    if att is None:
        return None
    return (
        db.query(models.EmployeeEarlySignOutEntry)
        .filter(
            models.EmployeeEarlySignOutEntry.employee_id == employee_id,
            models.EmployeeEarlySignOutEntry.attendance_id == att.id,
            models.EmployeeEarlySignOutEntry.voided_at.is_(None),
        )
        .first()
    )


def _find_absence_entry(db: Session, employee_id: int, attendance_date: date_type) -> Optional[models.EmployeeAbsenceEntry]:
    return (
        db.query(models.EmployeeAbsenceEntry)
        .filter(
            models.EmployeeAbsenceEntry.employee_id == employee_id,
            models.EmployeeAbsenceEntry.absence_date == attendance_date,
            models.EmployeeAbsenceEntry.voided_at.is_(None),
        )
        .first()
    )


def _existing_active_waiver(
    db: Session,
    *,
    deduction_type: DeductionType,
    lateness_entry_id: Optional[int] = None,
    early_sign_out_entry_id: Optional[int] = None,
    absence_entry_id: Optional[int] = None,
) -> Optional[models.AttendanceDeductionWaiver]:
    q = db.query(models.AttendanceDeductionWaiver).filter(
        active_waiver_filter(),
        models.AttendanceDeductionWaiver.deduction_type == deduction_type,
    )
    if deduction_type == "late" and lateness_entry_id is not None:
        q = q.filter(models.AttendanceDeductionWaiver.lateness_entry_id == lateness_entry_id)
    elif deduction_type == "early_sign_out" and early_sign_out_entry_id is not None:
        q = q.filter(models.AttendanceDeductionWaiver.early_sign_out_entry_id == early_sign_out_entry_id)
    elif deduction_type == "absence" and absence_entry_id is not None:
        q = q.filter(models.AttendanceDeductionWaiver.absence_entry_id == absence_entry_id)
    else:
        return None
    return q.first()


def _resolve_deduction_entry(
    db: Session,
    employee_id: int,
    attendance_date: date_type,
    deduction_type: DeductionType,
) -> tuple[Optional[object], Decimal]:
    if deduction_type == "late":
        entry = _find_lateness_entry(db, employee_id, attendance_date)
        if entry is None:
            return None, Decimal("0")
        return entry, _decimal_amount(entry.deduction_amount_naira)
    if deduction_type == "early_sign_out":
        entry = _find_early_sign_out_entry(db, employee_id, attendance_date)
        if entry is None:
            return None, Decimal("0")
        return entry, _decimal_amount(entry.deduction_amount_naira)
    entry = _find_absence_entry(db, employee_id, attendance_date)
    if entry is None:
        return None, Decimal("0")
    return entry, _decimal_amount(entry.deduction_amount_naira)


def _entry_ids_from_row(entry: object, deduction_type: DeductionType) -> dict[str, Optional[int]]:
    if deduction_type == "late":
        return {"lateness_entry_id": int(entry.id), "early_sign_out_entry_id": None, "absence_entry_id": None}
    if deduction_type == "early_sign_out":
        return {"lateness_entry_id": None, "early_sign_out_entry_id": int(entry.id), "absence_entry_id": None}
    return {"lateness_entry_id": None, "early_sign_out_entry_id": None, "absence_entry_id": int(entry.id)}


def _create_waiver_financial_transaction(
    db: Session,
    *,
    employee_id: int,
    period_id: int,
    amount: Decimal,
    reason_display: str,
    actor: models.User,
    reversal_of_id: Optional[int] = None,
    is_reversal: bool = False,
) -> models.EmployeeTransaction:
    if is_reversal:
        note = (
            f"Attendance Waiver Reversed\n"
            f"Deduction: ₦{amount:,.2f}\n"
            f"Reference: Attendance Adjustment\n"
            f"Reason: {reason_display}"
        )
        txn_type = "reversal"
    else:
        note = (
            f"Attendance Deduction Waived\n"
            f"Credit: ₦{amount:,.2f}\n"
            f"Reference: Attendance Adjustment\n"
            f"Reason: {reason_display}"
        )
        txn_type = "owed_increase"
    now = now_utc_naive()
    txn = models.EmployeeTransaction(
        employee_id=employee_id,
        period_id=period_id,
        txn_type=txn_type,
        amount=amount,
        status="paid",
        paid_at=now,
        note=note,
        created_by_id=actor.id,
        processed_by_id=actor.id,
        processed_by_role="admin",
        reversal_of_id=reversal_of_id,
    )
    db.add(txn)
    db.flush()
    return txn


def create_deduction_waiver(
    db: Session,
    *,
    employee_id: int,
    period_id: int,
    attendance_date: date_type,
    deduction_type: DeductionType,
    reason_code: str,
    reason_text: Optional[str],
    actor: models.User,
    waiver_kind: WaiverKind = "individual",
    daily_batch_id: Optional[int] = None,
) -> models.AttendanceDeductionWaiver:
    code, text = validate_waiver_reason(reason_code, reason_text)
    assert_waiver_financial_mutable(db, employee_id, period_id)

    entry, amount = _resolve_deduction_entry(db, employee_id, attendance_date, deduction_type)
    if entry is None:
        raise HTTPException(status_code=404, detail=f"No {deduction_type.replace('_', ' ')} deduction found for this date.")
    if amount <= 0:
        raise HTTPException(status_code=400, detail="This deduction has no amount to waive.")

    entry_ids = _entry_ids_from_row(entry, deduction_type)
    existing = _existing_active_waiver(db, deduction_type=deduction_type, **entry_ids)
    if existing is not None:
        raise HTTPException(status_code=409, detail="This deduction has already been waived.")

    reason_display = format_waiver_reason(code, text)
    txn = _create_waiver_financial_transaction(
        db,
        employee_id=employee_id,
        period_id=period_id,
        amount=amount,
        reason_display=reason_display,
        actor=actor,
    )
    waiver = models.AttendanceDeductionWaiver(
        employee_id=employee_id,
        period_id=period_id,
        attendance_date=attendance_date,
        deduction_type=deduction_type,
        lateness_entry_id=entry_ids["lateness_entry_id"],
        early_sign_out_entry_id=entry_ids["early_sign_out_entry_id"],
        absence_entry_id=entry_ids["absence_entry_id"],
        original_amount_naira=amount,
        credited_amount_naira=amount,
        reason_code=code,
        reason_text=text,
        waiver_kind=waiver_kind,
        daily_batch_id=daily_batch_id,
        financial_transaction_id=txn.id,
        created_by_id=actor.id,
    )
    db.add(waiver)
    db.flush()
    log_financial_action(
        db,
        action="attendance_deduction_waived",
        entity_type="attendance_deduction_waiver",
        entity_id=waiver.id,
        actor_user=actor,
        meta={
            "employee_id": employee_id,
            "period_id": period_id,
            "attendance_date": str(attendance_date),
            "deduction_type": deduction_type,
            "amount": str(amount),
            "waiver_kind": waiver_kind,
            "reason": reason_display,
        },
    )
    return waiver


def reverse_deduction_waiver(
    db: Session,
    waiver_id: int,
    *,
    reversal_reason: str,
    actor: models.User,
) -> models.AttendanceDeductionWaiver:
    reason = (reversal_reason or "").strip()
    if not reason:
        raise HTTPException(status_code=400, detail="Reversal reason is required.")

    waiver = (
        db.query(models.AttendanceDeductionWaiver)
        .options(joinedload(models.AttendanceDeductionWaiver.financial_transaction))
        .filter(models.AttendanceDeductionWaiver.id == waiver_id)
        .first()
    )
    if waiver is None:
        raise HTTPException(status_code=404, detail="Waiver not found.")
    if waiver.reversed_at is not None:
        raise HTTPException(status_code=409, detail="This waiver has already been reversed.")

    assert_waiver_financial_mutable(db, waiver.employee_id, waiver.period_id)

    amount = _decimal_amount(waiver.credited_amount_naira)
    rev_txn = _create_waiver_financial_transaction(
        db,
        employee_id=waiver.employee_id,
        period_id=waiver.period_id,
        amount=amount,
        reason_display=reason,
        actor=actor,
        reversal_of_id=waiver.financial_transaction_id,
        is_reversal=True,
    )
    waiver.reversed_at = now_utc_naive()
    waiver.reversed_by_id = actor.id
    waiver.reversal_reason = reason
    waiver.reversal_transaction_id = rev_txn.id

    log_financial_action(
        db,
        action="attendance_deduction_waiver_reversed",
        entity_type="attendance_deduction_waiver",
        entity_id=waiver.id,
        actor_user=actor,
        meta={
            "employee_id": waiver.employee_id,
            "period_id": waiver.period_id,
            "attendance_date": str(waiver.attendance_date),
            "deduction_type": waiver.deduction_type,
            "amount": str(amount),
            "reason": reason,
        },
    )
    return waiver


def load_active_waivers_for_employees_dates(
    db: Session,
    employee_ids: list[int],
    dates: list[date_type],
) -> dict[tuple[int, date_type], list[models.AttendanceDeductionWaiver]]:
    if not employee_ids or not dates:
        return {}
    rows = (
        db.query(models.AttendanceDeductionWaiver)
        .options(joinedload(models.AttendanceDeductionWaiver.created_by))
        .filter(
            models.AttendanceDeductionWaiver.employee_id.in_(employee_ids),
            models.AttendanceDeductionWaiver.attendance_date.in_(dates),
            active_waiver_filter(),
        )
        .order_by(models.AttendanceDeductionWaiver.created_at.asc())
        .all()
    )
    out: dict[tuple[int, date_type], list[models.AttendanceDeductionWaiver]] = defaultdict(list)
    for row in rows:
        out[(row.employee_id, row.attendance_date)].append(row)
    return out


def waiver_info_dict(waiver: models.AttendanceDeductionWaiver) -> dict:
    return {
        "id": waiver.id,
        "deduction_type": waiver.deduction_type,
        "waived_by_name": _user_display_name(waiver.created_by),
        "reason": format_waiver_reason(waiver.reason_code, waiver.reason_text),
        "waived_at": waiver.created_at,
        "original_amount_naira": waiver.original_amount_naira,
        "credited_amount_naira": waiver.credited_amount_naira,
        "waiver_kind": waiver.waiver_kind,
        "can_reverse": True,
    }


def preview_individual_waiver(
    db: Session,
    *,
    employee_id: int,
    attendance_date: date_type,
    waive_late: bool,
    waive_early_sign_out: bool,
    waive_absence: bool,
) -> dict:
    emp = (
        db.query(models.Employee)
        .options(joinedload(models.Employee.work_location))
        .filter(models.Employee.id == employee_id, models.Employee.deleted_at.is_(None))
        .first()
    )
    if emp is None:
        raise HTTPException(status_code=404, detail="Employee not found.")

    att = (
        db.query(models.EmployeeAttendanceEntry)
        .filter(
            models.EmployeeAttendanceEntry.employee_id == employee_id,
            models.EmployeeAttendanceEntry.attendance_date == attendance_date,
        )
        .first()
    )
    abs_row = _find_absence_entry(db, employee_id, attendance_date)

    deductions: list[dict] = []
    total_credit = Decimal("0")
    flags = [
        ("late", waive_late),
        ("early_sign_out", waive_early_sign_out),
        ("absence", waive_absence),
    ]
    period_id: Optional[int] = None
    payroll_finalized = False
    for dtype, selected in flags:
        if not selected:
            continue
        entry, amount = _resolve_deduction_entry(db, employee_id, attendance_date, dtype)  # type: ignore[arg-type]
        entry_ids = _entry_ids_from_row(entry, dtype) if entry else {}  # type: ignore[arg-type]
        already_waived = (
            _existing_active_waiver(db, deduction_type=dtype, **entry_ids) is not None  # type: ignore[arg-type]
            if entry
            else False
        )
        if entry is not None and period_id is None:
            period_id = int(getattr(entry, "period_id"))
        if period_id is not None:
            finalized, _ = is_payroll_finalized_for_waiver(db, employee_id, period_id)
            payroll_finalized = payroll_finalized or finalized
        deductions.append(
            {
                "deduction_type": dtype,
                "available": entry is not None and amount > 0,
                "amount_naira": amount,
                "already_waived": already_waived,
            }
        )
        if entry is not None and amount > 0 and not already_waived:
            total_credit += amount

    status = "absent"
    check_in_at = None
    check_out_at = None
    shift_label = None
    if att is not None:
        from app.routes.employees import _attendance_history_from_row, _shift_label  # noqa: PLC0415

        history = _attendance_history_from_row(att)
        status = history.status
        check_in_at = history.check_in_at
        check_out_at = history.check_out_at
        shift_label = history.shift_label
    elif abs_row is not None:
        status = "absent"

    return {
        "employee_id": employee_id,
        "full_name": emp.full_name or "",
        "attendance_date": attendance_date,
        "check_in_at": check_in_at,
        "check_out_at": check_out_at,
        "work_location": emp.work_location,
        "shift_label": shift_label,
        "status": status,
        "deductions": deductions,
        "total_credit_naira": total_credit,
        "payroll_finalized": payroll_finalized,
    }


def preview_daily_waiver(
    db: Session,
    *,
    attendance_date: date_type,
    waive_late: bool,
    waive_early_sign_out: bool,
    waive_absence: bool,
) -> dict:
    from app.routes.employees import _attendance_assigned_employees  # noqa: PLC0415

    employees = _attendance_assigned_employees(db)
    counts = {"late": 0, "early_sign_out": 0, "absence": 0}
    payroll_finalized_any = False

    for emp in employees:
        period_id: Optional[int] = None
        for dtype, selected in [
            ("late", waive_late),
            ("early_sign_out", waive_early_sign_out),
            ("absence", waive_absence),
        ]:
            if not selected:
                continue
            entry, amount = _resolve_deduction_entry(db, emp.id, attendance_date, dtype)  # type: ignore[arg-type]
            if entry is None or amount <= 0:
                continue
            entry_ids = _entry_ids_from_row(entry, dtype)  # type: ignore[arg-type]
            if _existing_active_waiver(db, deduction_type=dtype, **entry_ids) is not None:  # type: ignore[arg-type]
                continue
            if period_id is None:
                period_id = int(getattr(entry, "period_id"))
            finalized, _ = is_payroll_finalized_for_waiver(db, emp.id, period_id)
            if finalized:
                payroll_finalized_any = True
                continue
            counts[dtype] += 1

    return {
        "attendance_date": attendance_date,
        "counts": counts,
        "payroll_finalized_any": payroll_finalized_any,
    }


def apply_daily_waiver(
    db: Session,
    *,
    attendance_date: date_type,
    waive_late: bool,
    waive_early_sign_out: bool,
    waive_absence: bool,
    reason_code: str,
    reason_text: Optional[str],
    actor: models.User,
) -> tuple[models.AttendanceDailyWaiverBatch, list[models.AttendanceDeductionWaiver]]:
    from app.routes.employees import _attendance_assigned_employees  # noqa: PLC0415

    code, text = validate_waiver_reason(reason_code, reason_text)
    batch = models.AttendanceDailyWaiverBatch(
        attendance_date=attendance_date,
        waive_late=waive_late,
        waive_early_sign_out=waive_early_sign_out,
        waive_absence=waive_absence,
        reason_code=code,
        reason_text=text,
        created_by_id=actor.id,
    )
    db.add(batch)
    db.flush()

    waivers: list[models.AttendanceDeductionWaiver] = []
    employees = _attendance_assigned_employees(db)
    for emp in employees:
        period_id: Optional[int] = None
        for dtype, selected in [
            ("late", waive_late),
            ("early_sign_out", waive_early_sign_out),
            ("absence", waive_absence),
        ]:
            if not selected:
                continue
            entry, amount = _resolve_deduction_entry(db, emp.id, attendance_date, dtype)  # type: ignore[arg-type]
            if entry is None or amount <= 0:
                continue
            entry_ids = _entry_ids_from_row(entry, dtype)  # type: ignore[arg-type]
            if _existing_active_waiver(db, deduction_type=dtype, **entry_ids) is not None:  # type: ignore[arg-type]
                continue
            if period_id is None:
                period_id = int(getattr(entry, "period_id"))
            try:
                assert_waiver_financial_mutable(db, emp.id, period_id)
            except HTTPException:
                continue
            waiver = create_deduction_waiver(
                db,
                employee_id=emp.id,
                period_id=period_id,
                attendance_date=attendance_date,
                deduction_type=dtype,  # type: ignore[arg-type]
                reason_code=code,
                reason_text=text,
                actor=actor,
                waiver_kind="daily",
                daily_batch_id=batch.id,
            )
            waivers.append(waiver)

    log_financial_action(
        db,
        action="attendance_daily_waiver_applied",
        entity_type="attendance_daily_waiver_batch",
        entity_id=batch.id,
        actor_user=actor,
        meta={
            "attendance_date": str(attendance_date),
            "waivers_created": len(waivers),
            "reason": format_waiver_reason(code, text),
        },
    )
    return batch, waivers
