"""Attendance deduction waiver API routes."""

from __future__ import annotations

from datetime import date as date_type
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session, joinedload

from app import models
from app.auth.auth import get_current_user, has_admin_privileges, require_role
from app.database import get_db
from app.schemas import (
    AttendanceDailyWaiverIn,
    AttendanceDailyWaiverPreviewOut,
    AttendanceIndividualWaiverIn,
    AttendanceIndividualWaiverPreviewOut,
    AttendanceWaiverApplyOut,
    AttendanceWaiverAuditOut,
    AttendanceWaiverDeductionPreviewOut,
    AttendanceWaiverInfoOut,
    AttendanceWaiverReasonOptionOut,
    AttendanceWaiverReverseIn,
    CompanyLocationOut,
)
from app.routes.employees import get_or_create_period
from app.utils.attendance_waiver import (
    WAIVER_REASON_LABELS,
    apply_daily_waiver,
    create_deduction_waiver,
    format_waiver_reason,
    preview_daily_waiver,
    preview_individual_waiver,
    reverse_deduction_waiver,
    waiver_info_dict,
)

router = APIRouter(prefix="/employees/attendance", tags=["Attendance Waivers"])


def _require_waiver_admin(current_user) -> None:
    if not has_admin_privileges(current_user):
        raise HTTPException(status_code=403, detail="Only administrators can adjust attendance deductions.")


@router.get("/waiver-reasons", response_model=list[AttendanceWaiverReasonOptionOut])
def list_waiver_reasons(current_user=Depends(require_role(["admin"]))):
    return [AttendanceWaiverReasonOptionOut(code=code, label=label) for code, label in WAIVER_REASON_LABELS.items()]


@router.get("/waiver-preview", response_model=AttendanceIndividualWaiverPreviewOut)
def individual_waiver_preview(
    employee_id: int = Query(..., ge=1),
    attendance_date: date_type = Query(..., alias="date"),
    waive_late: bool = Query(False),
    waive_early_sign_out: bool = Query(False),
    waive_absence: bool = Query(False),
    db: Session = Depends(get_db),
    current_user=Depends(require_role(["admin"])),
):
    preview = preview_individual_waiver(
        db,
        employee_id=employee_id,
        attendance_date=attendance_date,
        waive_late=waive_late,
        waive_early_sign_out=waive_early_sign_out,
        waive_absence=waive_absence,
    )
    loc = preview.get("work_location")
    return AttendanceIndividualWaiverPreviewOut(
        employee_id=preview["employee_id"],
        full_name=preview["full_name"],
        attendance_date=preview["attendance_date"],
        check_in_at=preview.get("check_in_at"),
        check_out_at=preview.get("check_out_at"),
        work_location=CompanyLocationOut.model_validate(loc) if loc is not None else None,
        shift_label=preview.get("shift_label"),
        status=preview["status"],
        deductions=[AttendanceWaiverDeductionPreviewOut(**d) for d in preview["deductions"]],
        total_credit_naira=preview["total_credit_naira"],
        payroll_finalized=preview.get("payroll_finalized", False),
    )


@router.post("/waiver", response_model=AttendanceWaiverApplyOut)
def apply_individual_waiver(
    body: AttendanceIndividualWaiverIn,
    db: Session = Depends(get_db),
    current_user=Depends(require_role(["admin"])),
):
    _require_waiver_admin(current_user)
    if not body.waive_late and not body.waive_early_sign_out and not body.waive_absence:
        raise HTTPException(status_code=400, detail="Select at least one deduction type to waive.")

    period = get_or_create_period(db, body.attendance_date.year, body.attendance_date.month)
    waivers: list[models.AttendanceDeductionWaiver] = []
    flags = [
        ("late", body.waive_late),
        ("early_sign_out", body.waive_early_sign_out),
        ("absence", body.waive_absence),
    ]
    for dtype, selected in flags:
        if not selected:
            continue
        waiver = create_deduction_waiver(
            db,
            employee_id=body.employee_id,
            period_id=period.id,
            attendance_date=body.attendance_date,
            deduction_type=dtype,  # type: ignore[arg-type]
            reason_code=body.reason_code,
            reason_text=body.reason_text,
            actor=current_user,
            waiver_kind="individual",
        )
        waivers.append(waiver)

    db.commit()
    for w in waivers:
        db.refresh(w)
    return AttendanceWaiverApplyOut(
        waivers=[AttendanceWaiverInfoOut(**waiver_info_dict(w)) for w in waivers],
        message=f"{len(waivers)} deduction(s) waived successfully.",
    )


@router.get("/daily-waiver-preview", response_model=AttendanceDailyWaiverPreviewOut)
def daily_waiver_preview(
    attendance_date: date_type = Query(..., alias="date"),
    waive_late: bool = Query(False),
    waive_early_sign_out: bool = Query(False),
    waive_absence: bool = Query(False),
    db: Session = Depends(get_db),
    current_user=Depends(require_role(["admin"])),
):
    preview = preview_daily_waiver(
        db,
        attendance_date=attendance_date,
        waive_late=waive_late,
        waive_early_sign_out=waive_early_sign_out,
        waive_absence=waive_absence,
    )
    counts = preview["counts"]
    return AttendanceDailyWaiverPreviewOut(
        attendance_date=preview["attendance_date"],
        late_count=counts.get("late", 0),
        early_sign_out_count=counts.get("early_sign_out", 0),
        absence_count=counts.get("absence", 0),
        payroll_finalized_any=preview.get("payroll_finalized_any", False),
    )


@router.post("/daily-waiver", response_model=AttendanceWaiverApplyOut)
def apply_daily_waiver_route(
    body: AttendanceDailyWaiverIn,
    db: Session = Depends(get_db),
    current_user=Depends(require_role(["admin"])),
):
    _require_waiver_admin(current_user)
    if not body.waive_late and not body.waive_early_sign_out and not body.waive_absence:
        raise HTTPException(status_code=400, detail="Select at least one deduction type to waive.")

    _batch, waivers = apply_daily_waiver(
        db,
        attendance_date=body.attendance_date,
        waive_late=body.waive_late,
        waive_early_sign_out=body.waive_early_sign_out,
        waive_absence=body.waive_absence,
        reason_code=body.reason_code,
        reason_text=body.reason_text,
        actor=current_user,
    )
    db.commit()
    return AttendanceWaiverApplyOut(
        waivers=[AttendanceWaiverInfoOut(**waiver_info_dict(w)) for w in waivers],
        message=f"Daily waiver applied to {len(waivers)} deduction(s).",
    )


@router.post("/waivers/{waiver_id}/reverse", response_model=AttendanceWaiverInfoOut)
def reverse_waiver_route(
    waiver_id: int,
    body: AttendanceWaiverReverseIn,
    db: Session = Depends(get_db),
    current_user=Depends(require_role(["admin"])),
):
    _require_waiver_admin(current_user)
    waiver = reverse_deduction_waiver(db, waiver_id, reversal_reason=body.reversal_reason, actor=current_user)
    db.commit()
    db.refresh(waiver)
    return AttendanceWaiverInfoOut(**waiver_info_dict(waiver))


@router.get("/waivers", response_model=list[AttendanceWaiverAuditOut])
def list_waiver_audit(
    db: Session = Depends(get_db),
    current_user=Depends(require_role(["admin"])),
    employee_id: Optional[int] = Query(None, ge=1),
    attendance_date: Optional[date_type] = Query(None, alias="date"),
    include_reversed: bool = Query(True),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
):
    q = (
        db.query(models.AttendanceDeductionWaiver)
        .options(joinedload(models.AttendanceDeductionWaiver.employee))
        .options(joinedload(models.AttendanceDeductionWaiver.created_by))
        .options(joinedload(models.AttendanceDeductionWaiver.reversed_by))
        .order_by(models.AttendanceDeductionWaiver.created_at.desc())
    )
    if employee_id is not None:
        q = q.filter(models.AttendanceDeductionWaiver.employee_id == employee_id)
    if attendance_date is not None:
        q = q.filter(models.AttendanceDeductionWaiver.attendance_date == attendance_date)
    if not include_reversed:
        q = q.filter(models.AttendanceDeductionWaiver.reversed_at.is_(None))
    rows = q.offset(offset).limit(limit).all()
    out: list[AttendanceWaiverAuditOut] = []
    for row in rows:
        emp_name = row.employee.full_name if row.employee else ""
        admin_name = (row.created_by.name if row.created_by and row.created_by.name else None) or (
            row.created_by.email if row.created_by else "Admin"
        )
        reversed_by_name = None
        if row.reversed_by is not None:
            reversed_by_name = row.reversed_by.name or row.reversed_by.email
        out.append(
            AttendanceWaiverAuditOut(
                id=row.id,
                employee_id=row.employee_id,
                employee_name=emp_name or "",
                attendance_date=row.attendance_date,
                deduction_type=row.deduction_type,  # type: ignore[arg-type]
                original_amount_naira=row.original_amount_naira,
                credited_amount_naira=row.credited_amount_naira,
                reason=format_waiver_reason(row.reason_code, row.reason_text),
                admin_name=admin_name or "Admin",
                created_at=row.created_at,
                waiver_kind=row.waiver_kind,  # type: ignore[arg-type]
                reversed_at=row.reversed_at,
                reversed_by_name=reversed_by_name,
                reversal_reason=row.reversal_reason,
            )
        )
    return out
