from __future__ import annotations

import csv
import io
import uuid
from datetime import datetime
from decimal import Decimal
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import StreamingResponse
from sqlalchemy import func
from sqlalchemy.orm import Session

from app import models
from app.auth.auth import get_current_user, normalize_role, require_role
from app.database import get_db
from app.utils.cloudinary import upload_asset
from app.schemas import (
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
    EmployeePenaltyCreate,
    EmployeePenaltyOut,
    EmployeeSalaryBreakdown,
    EmployeeSelfUpdate,
    PayrollPeriodsNavOut,
    PayrollSummaryOut,
    SalaryPeriodOut,
)

router = APIRouter(prefix="/employees", tags=["Employees"])

LATENESS_DEDUCTION_NAIRA = Decimal("500")

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


def _is_admin(user) -> bool:
    return normalize_role(getattr(user, "role", None)) == "admin"


def get_or_create_period(db: Session, year: int, month: int) -> models.SalaryPeriod:
    if month < 1 or month > 12:
        raise HTTPException(status_code=400, detail="month must be between 1 and 12")
    p = db.query(models.SalaryPeriod).filter_by(year=year, month=month).first()
    if p:
        return p
    p = models.SalaryPeriod(year=year, month=month, label=_month_label(year, month), is_active=False)
    db.add(p)
    db.flush()
    return p


def get_active_period(db: Session) -> Optional[models.SalaryPeriod]:
    return db.query(models.SalaryPeriod).filter(models.SalaryPeriod.is_active.is_(True)).first()


def _next_calendar_month(year: int, month: int) -> tuple[int, int]:
    if month == 12:
        return year + 1, 1
    return year, month + 1


def _period_ids_with_any_data(db: Session) -> set[int]:
    s: set[int] = set()
    for (pid,) in db.query(models.EmployeeLatenessEntry.period_id).distinct():
        s.add(int(pid))
    for (pid,) in db.query(models.EmployeePenalty.period_id).distinct():
        s.add(int(pid))
    for (pid,) in db.query(models.EmployeeBonus.period_id).distinct():
        s.add(int(pid))
    for (pid,) in db.query(models.EmployeePeriodPayroll.period_id).distinct():
        s.add(int(pid))
    return s


def _periods_for_nav(db: Session) -> list[models.SalaryPeriod]:
    """Dropdown: active month OR any month that has lateness, penalties, bonuses, or payment rows."""
    all_p = (
        db.query(models.SalaryPeriod)
        .order_by(models.SalaryPeriod.year.desc(), models.SalaryPeriod.month.desc())
        .all()
    )
    data_ids = _period_ids_with_any_data(db)
    return [p for p in all_p if p.is_active or p.id in data_ids]


def _build_nav_out(db: Session) -> PayrollPeriodsNavOut:
    ap = get_active_period(db)
    plist = _periods_for_nav(db)
    return PayrollPeriodsNavOut(
        active_period=SalaryPeriodOut.model_validate(ap) if ap else None,
        periods=[SalaryPeriodOut.model_validate(p) for p in plist],
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
    if period_year is None and period_month is None:
        ap = get_active_period(db)
        if ap:
            return ap
        now = datetime.utcnow()
        return get_or_create_period(db, now.year, now.month)
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


def _salary_breakdown(
    base: Decimal,
    lateness_count: int,
    penalties_total: Decimal,
    bonuses_total: Decimal,
) -> EmployeeSalaryBreakdown:
    rate = LATENESS_DEDUCTION_NAIRA
    lateness_ded = rate * Decimal(lateness_count)
    total_ded = lateness_ded + penalties_total
    final = base - lateness_ded - penalties_total + bonuses_total
    return EmployeeSalaryBreakdown(
        base_salary=base,
        lateness_count=lateness_count,
        lateness_deduction=lateness_ded,
        lateness_rate_naira=rate,
        penalties_total=penalties_total,
        bonuses_total=bonuses_total,
        total_deductions=total_ded,
        final_payable=final,
    )


def _validate_breakdown(b: EmployeeSalaryBreakdown) -> None:
    if b.final_payable < 0:
        raise HTTPException(
            status_code=400,
            detail="Total deductions cannot exceed base salary plus bonuses for this period.",
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
        .order_by(models.EmployeeLatenessEntry.id)
        .all()
    )
    penalties = (
        db.query(models.EmployeePenalty)
        .filter_by(employee_id=employee_id, period_id=period.id)
        .order_by(models.EmployeePenalty.id)
        .all()
    )
    bonuses = (
        db.query(models.EmployeeBonus)
        .filter_by(employee_id=employee_id, period_id=period.id)
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
    base = emp.base_salary if emp.base_salary is not None else Decimal("0")
    n = len(lateness)
    pen = sum((p.amount for p in penalties), Decimal("0"))
    bon = sum((b.amount for b in bonuses), Decimal("0"))
    salary = _salary_breakdown(base, n, pen, bon)
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
        account_number=emp.account_number,
        notes=emp.notes,
        base_salary=emp.base_salary,
        documents=emp.documents or [],
        user_id=emp.user_id,
        linked_username=linked_username,
        created_at=emp.created_at,
        updated_at=emp.updated_at,
        period=SalaryPeriodOut.model_validate(period),
        payment=pay,
        lateness_entries=[EmployeeLatenessEntryOut.model_validate(x) for x in lateness],
        penalties=[EmployeePenaltyOut.model_validate(x) for x in penalties],
        bonuses=[EmployeeBonusOut.model_validate(x) for x in bonuses],
        salary=salary,
    )


def _list_item(
    emp: models.Employee,
    period: models.SalaryPeriod,
    lateness_count: int,
    penalties_total: Decimal,
    bonuses_total: Decimal,
    payroll: Optional[models.EmployeePeriodPayroll],
) -> EmployeeListItemOut:
    base = emp.base_salary if emp.base_salary is not None else Decimal("0")
    salary = _salary_breakdown(base, lateness_count, penalties_total, bonuses_total)
    pay = EmployeePaymentOut(
        status=(payroll.payment_status if payroll else "unpaid"),
        payment_date=payroll.payment_date if payroll else None,
        payment_reference=payroll.payment_reference if payroll else None,
    )
    return EmployeeListItemOut(
        id=emp.id,
        full_name=emp.full_name,
        phone=emp.phone,
        account_number=emp.account_number,
        base_salary=base,
        user_id=emp.user_id,
        period=SalaryPeriodOut.model_validate(period),
        payment=pay,
        salary=salary,
    )


def _aggregates_for_period(db: Session, period_id: int) -> tuple[dict[int, int], dict[int, Decimal], dict[int, Decimal]]:
    lateness_rows = (
        db.query(models.EmployeeLatenessEntry.employee_id, func.count(models.EmployeeLatenessEntry.id))
        .filter(models.EmployeeLatenessEntry.period_id == period_id)
        .group_by(models.EmployeeLatenessEntry.employee_id)
        .all()
    )
    lateness_map = {int(eid): int(c) for eid, c in lateness_rows}
    pen_rows = (
        db.query(models.EmployeePenalty.employee_id, func.coalesce(func.sum(models.EmployeePenalty.amount), 0))
        .filter(models.EmployeePenalty.period_id == period_id)
        .group_by(models.EmployeePenalty.employee_id)
        .all()
    )
    pen_map = {int(eid): Decimal(str(total)) for eid, total in pen_rows}
    bon_rows = (
        db.query(models.EmployeeBonus.employee_id, func.coalesce(func.sum(models.EmployeeBonus.amount), 0))
        .filter(models.EmployeeBonus.period_id == period_id)
        .group_by(models.EmployeeBonus.employee_id)
        .all()
    )
    bon_map = {int(eid): Decimal(str(total)) for eid, total in bon_rows}
    return lateness_map, pen_map, bon_map


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
    return _build_nav_out(db)


@router.post("/periods/start-next-month", response_model=PayrollPeriodsNavOut)
def start_next_payroll_month(
    db: Session = Depends(get_db),
    current_user=Depends(require_role(["admin"])),
):
    """Advance to the next calendar month and mark it active. Prior month stays in the archive (unchanged)."""
    active = get_active_period(db)
    if active:
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
            now = datetime.utcnow()
            ny, nm = now.year, now.month

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
    emps = db.query(models.Employee).order_by(models.Employee.id.asc()).all()
    lateness_map, pen_map, bon_map = _aggregates_for_period(db, period.id)
    total_base = Decimal("0")
    total_lat = Decimal("0")
    total_pen = Decimal("0")
    total_bon = Decimal("0")
    total_net = Decimal("0")
    rate = LATENESS_DEDUCTION_NAIRA
    for e in emps:
        base = e.base_salary if e.base_salary is not None else Decimal("0")
        lc = lateness_map.get(e.id, 0)
        pt = pen_map.get(e.id, Decimal("0"))
        bt = bon_map.get(e.id, Decimal("0"))
        br = _salary_breakdown(base, lc, pt, bt)
        total_base += base
        total_lat += br.lateness_deduction
        total_pen += pt
        total_bon += bt
        total_net += br.final_payable
    total_ded = total_lat + total_pen
    return PayrollSummaryOut(
        period=SalaryPeriodOut.model_validate(period),
        employee_count=len(emps),
        total_base_salary=total_base,
        total_lateness_deductions=total_lat,
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
):
    period = resolve_period(db, period_year, period_month)
    lateness_map, pen_map, bon_map = _aggregates_for_period(db, period.id)
    payroll_map = _payroll_map_for_period(db, period.id)
    emps = db.query(models.Employee).order_by(models.Employee.id.desc()).all()
    return [
        _list_item(
            e,
            period,
            lateness_map.get(e.id, 0),
            pen_map.get(e.id, Decimal("0")),
            bon_map.get(e.id, Decimal("0")),
            payroll_map.get(e.id),
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
    lateness_map, pen_map, bon_map = _aggregates_for_period(db, period.id)
    payroll_map = _payroll_map_for_period(db, period.id)
    emps = db.query(models.Employee).order_by(models.Employee.full_name.asc()).all()
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
            "Penalties total (NGN)",
            "Bonuses total (NGN)",
            "Final payable (NGN)",
        ]
    )
    for e in emps:
        lc = lateness_map.get(e.id, 0)
        pt = pen_map.get(e.id, Decimal("0"))
        bt = bon_map.get(e.id, Decimal("0"))
        base = e.base_salary if e.base_salary is not None else Decimal("0")
        s = _salary_breakdown(base, lc, pt, bt)
        pr = payroll_map.get(e.id)
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
    emp = db.query(models.Employee).filter(models.Employee.user_id == current_user.id).first()
    if emp is None:
        raise HTTPException(
            status_code=404,
            detail="No employee profile linked to your account. Contact an administrator.",
        )
    period = resolve_period(db, None, None)
    lateness, penalties, bonuses, payroll = _load_rows_for_period(db, emp.id, period)
    return _employee_to_out(emp, db, period, lateness, penalties, bonuses, payroll)


@router.patch("/me", response_model=EmployeeOut)
def patch_my_employee(
    body: EmployeeSelfUpdate,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    emp = db.query(models.Employee).filter(models.Employee.user_id == current_user.id).first()
    if emp is None:
        raise HTTPException(status_code=404, detail="No employee profile linked to your account.")
    data = body.model_dump(exclude_unset=True)
    for k, v in data.items():
        setattr(emp, k, v)
    emp.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(emp)
    period = resolve_period(db, None, None)
    lateness, penalties, bonuses, payroll = _load_rows_for_period(db, emp.id, period)
    return _employee_to_out(emp, db, period, lateness, penalties, bonuses, payroll)


@router.post("", response_model=EmployeeOut)
def create_employee(
    body: EmployeeCreate,
    db: Session = Depends(get_db),
    current_user=Depends(require_role(["admin"])),
):
    if body.user_id is not None:
        u = db.query(models.User).filter(models.User.id == body.user_id).first()
        if not u:
            raise HTTPException(status_code=400, detail="Linked user does not exist")
        taken = db.query(models.Employee).filter(models.Employee.user_id == body.user_id).first()
        if taken:
            raise HTTPException(status_code=400, detail="That user is already linked to another employee")
    emp = models.Employee(
        full_name=body.full_name.strip(),
        address=body.address,
        phone=body.phone,
        account_number=body.account_number,
        notes=body.notes,
        base_salary=body.base_salary,
        user_id=body.user_id,
        documents=[],
    )
    db.add(emp)
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
    emp = db.query(models.Employee).filter(models.Employee.id == employee_id).first()
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
    emp = db.query(models.Employee).filter(models.Employee.id == employee_id).first()
    if emp is None:
        raise HTTPException(status_code=404, detail="Employee not found")
    period = get_or_create_period(db, period_year, period_month)
    _assert_period_is_editable(period)
    lateness, penalties, bonuses, payroll = _load_rows_for_period(db, employee_id, period)
    salary = _salary_breakdown(
        emp.base_salary if emp.base_salary is not None else Decimal("0"),
        len(lateness),
        sum((p.amount for p in penalties), Decimal("0")),
        sum((b.amount for b in bonuses), Decimal("0")),
    )
    _validate_breakdown(salary)

    row = _get_or_create_payroll_row(db, employee_id, period.id)

    if body.payment_status == "paid":
        if row.payment_status == "paid":
            raise HTTPException(status_code=400, detail="Salary is already marked paid for this period.")
        row.payment_status = "paid"
        row.payment_date = body.payment_date or datetime.utcnow()
        row.payment_reference = body.payment_reference
        row.updated_at = datetime.utcnow()
        row.updated_by_id = current_user.id
        _log_payroll(
            db,
            "employee_mark_paid",
            row.id,
            current_user,
            {"employee_id": employee_id, "period_id": period.id, "period_label": period.label},
        )
    else:
        row.payment_status = "unpaid"
        row.payment_date = None
        row.payment_reference = None
        row.updated_at = datetime.utcnow()
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


@router.patch("/{employee_id}", response_model=EmployeeOut)
def patch_employee_admin(
    employee_id: int,
    body: EmployeeAdminUpdate,
    db: Session = Depends(get_db),
    current_user=Depends(require_role(["admin"])),
    period_year: Optional[int] = Query(None, ge=2000, le=2100),
    period_month: Optional[int] = Query(None, ge=1, le=12),
):
    emp = db.query(models.Employee).filter(models.Employee.id == employee_id).first()
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
                .filter(models.Employee.user_id == new_uid, models.Employee.id != employee_id)
                .first()
            )
            if taken:
                raise HTTPException(status_code=400, detail="That user is already linked to another employee")
    for k, v in data.items():
        setattr(emp, k, v)
    emp.updated_at = datetime.utcnow()
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
    emp = db.query(models.Employee).filter(models.Employee.id == employee_id).first()
    if emp is None:
        raise HTTPException(status_code=404, detail="Employee not found")
    db.delete(emp)
    db.commit()
    return {"message": "Employee deleted"}


@router.post("/{employee_id}/lateness", response_model=EmployeeOut)
def add_lateness_entry(
    employee_id: int,
    body: EmployeeLatenessCreate,
    db: Session = Depends(get_db),
    current_user=Depends(require_role(["admin"])),
    period_year: Optional[int] = Query(None, ge=2000, le=2100),
    period_month: Optional[int] = Query(None, ge=1, le=12),
):
    emp = db.query(models.Employee).filter(models.Employee.id == employee_id).first()
    if emp is None:
        raise HTTPException(status_code=404, detail="Employee not found")
    period = resolve_period(db, period_year, period_month)
    _assert_period_is_editable(period)
    _assert_financial_mutable(db, employee_id, period.id, body.confirm_financial_edit)

    lateness, penalties, bonuses, payroll = _load_rows_for_period(db, employee_id, period)
    base = emp.base_salary if emp.base_salary is not None else Decimal("0")
    pen = sum((p.amount for p in penalties), Decimal("0"))
    bon = sum((b.amount for b in bonuses), Decimal("0"))
    projected = _salary_breakdown(base, len(lateness) + 1, pen, bon)
    _validate_breakdown(projected)

    row = models.EmployeeLatenessEntry(employee_id=employee_id, period_id=period.id, note=body.note)
    db.add(row)
    emp.updated_at = datetime.utcnow()
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
        )
        .first()
    )
    if row is None:
        raise HTTPException(status_code=404, detail="Lateness entry not found")
    db.delete(row)
    emp = db.query(models.Employee).filter(models.Employee.id == employee_id).first()
    if emp:
        emp.updated_at = datetime.utcnow()
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
    emp = db.query(models.Employee).filter(models.Employee.id == employee_id).first()
    if emp is None:
        raise HTTPException(status_code=404, detail="Employee not found")
    period = resolve_period(db, period_year, period_month)
    _assert_period_is_editable(period)
    _assert_financial_mutable(db, employee_id, period.id, body.confirm_financial_edit)

    lateness, penalties, bonuses, payroll = _load_rows_for_period(db, employee_id, period)
    base = emp.base_salary if emp.base_salary is not None else Decimal("0")
    pen = sum((p.amount for p in penalties), Decimal("0")) + body.amount
    bon = sum((b.amount for b in bonuses), Decimal("0"))
    projected = _salary_breakdown(base, len(lateness), pen, bon)
    _validate_breakdown(projected)

    row = models.EmployeePenalty(
        employee_id=employee_id,
        period_id=period.id,
        description=body.description.strip(),
        amount=body.amount,
    )
    db.add(row)
    emp.updated_at = datetime.utcnow()
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
        )
        .first()
    )
    if row is None:
        raise HTTPException(status_code=404, detail="Penalty not found")
    db.delete(row)
    emp = db.query(models.Employee).filter(models.Employee.id == employee_id).first()
    if emp:
        emp.updated_at = datetime.utcnow()
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
    emp = db.query(models.Employee).filter(models.Employee.id == employee_id).first()
    if emp is None:
        raise HTTPException(status_code=404, detail="Employee not found")
    period = resolve_period(db, period_year, period_month)
    _assert_period_is_editable(period)
    _assert_financial_mutable(db, employee_id, period.id, body.confirm_financial_edit)

    lateness, penalties, bonuses, payroll = _load_rows_for_period(db, employee_id, period)
    base = emp.base_salary if emp.base_salary is not None else Decimal("0")
    pen = sum((p.amount for p in penalties), Decimal("0"))
    bon = sum((b.amount for b in bonuses), Decimal("0")) + body.amount
    projected = _salary_breakdown(base, len(lateness), pen, bon)
    _validate_breakdown(projected)

    row = models.EmployeeBonus(
        employee_id=employee_id,
        period_id=period.id,
        description=body.description.strip(),
        amount=body.amount,
    )
    db.add(row)
    emp.updated_at = datetime.utcnow()
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
        )
        .first()
    )
    if row is None:
        raise HTTPException(status_code=404, detail="Bonus not found")
    db.delete(row)
    emp = db.query(models.Employee).filter(models.Employee.id == employee_id).first()
    if emp:
        emp.updated_at = datetime.utcnow()
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
    emp = db.query(models.Employee).filter(models.Employee.id == employee_id).first()
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
            "uploaded_at": datetime.utcnow().replace(microsecond=0).isoformat() + "Z",
        }
    )
    emp.documents = docs
    emp.updated_at = datetime.utcnow()
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
    emp = db.query(models.Employee).filter(models.Employee.id == employee_id).first()
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
    emp.updated_at = datetime.utcnow()
    db.commit()
    period = resolve_period(db, period_year, period_month)
    lateness, penalties, bonuses, payroll = _load_rows_for_period(db, employee_id, period)
    return _employee_to_out(emp, db, period, lateness, penalties, bonuses, payroll)
