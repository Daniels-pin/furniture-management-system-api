"""Production material tracking for contract employees (Painters Dept, MDF Section)."""
from __future__ import annotations

from datetime import datetime
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session, joinedload

from app import models
from app.auth.auth import require_role
from app.database import get_db
from app.schemas import (
    ProductionMaterialAssignmentCreate,
    ProductionMaterialAssignmentOut,
    ProductionMaterialContractEmployeeOption,
    ProductionMaterialEmployeeRowOut,
    ProductionMaterialDisplayColumnOut,
    ProductionMaterialSectionOverviewOut,
    ProductionMaterialTotalOut,
    ProductionMaterialTransactionCreate,
    ProductionMaterialTransactionOut,
    ProductionMaterialTransactionReverse,
    ProductionMaterialTransactionUpdate,
    ProductionMaterialTransactionVoid,
    ProductionMaterialTypeCreate,
    ProductionMaterialTypeOut,
    ProductionMaterialTypeUpdate,
)
from app.utils.activity_log import (
    PRODUCTION_MATERIAL_ALLOCATED,
    PRODUCTION_MATERIAL_ASSIGNED,
    PRODUCTION_MATERIAL_REVERSED,
    PRODUCTION_MATERIAL_TYPE_CREATED,
    PRODUCTION_MATERIAL_TYPE_DELETED,
    PRODUCTION_MATERIAL_TYPE_UPDATED,
    PRODUCTION_MATERIAL_UNASSIGNED,
    PRODUCTION_MATERIAL_UPDATED,
    PRODUCTION_MATERIAL_VOIDED,
    log_activity,
)
from app.utils.production_materials import (
    SECTION_LABELS,
    build_display_material_columns,
    compute_employee_material_totals,
    compute_section_material_totals,
    transaction_effective_quantity,
    validate_section,
)
from app.utils.user_account import historical_attribution_label

router = APIRouter(prefix="/production-materials", tags=["Production Materials"])


def _parse_section(section: str) -> str:
    try:
        return validate_section(section)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


def _material_type_alive(section: str):
    return (
        models.ProductionMaterialType.section == section,
        models.ProductionMaterialType.deleted_at.is_(None),
    )


def _get_material_type(
    db: Session,
    *,
    section: str,
    material_type_id: int,
    allow_deleted: bool = False,
) -> models.ProductionMaterialType:
    filters = [
        models.ProductionMaterialType.id == material_type_id,
        models.ProductionMaterialType.section == section,
    ]
    if not allow_deleted:
        filters.append(models.ProductionMaterialType.deleted_at.is_(None))
    row = db.query(models.ProductionMaterialType).filter(*filters).first()
    if row is None:
        raise HTTPException(status_code=404, detail="Material type not found")
    return row


def _get_active_assignment(
    db: Session,
    *,
    section: str,
    contract_employee_id: int,
) -> models.ProductionMaterialSectionAssignment | None:
    return (
        db.query(models.ProductionMaterialSectionAssignment)
        .filter(
            models.ProductionMaterialSectionAssignment.section == section,
            models.ProductionMaterialSectionAssignment.contract_employee_id == contract_employee_id,
            models.ProductionMaterialSectionAssignment.removed_at.is_(None),
        )
        .first()
    )


def _get_assignment_by_id(
    db: Session,
    *,
    section: str,
    assignment_id: int,
) -> models.ProductionMaterialSectionAssignment:
    row = (
        db.query(models.ProductionMaterialSectionAssignment)
        .options(joinedload(models.ProductionMaterialSectionAssignment.contract_employee))
        .filter(
            models.ProductionMaterialSectionAssignment.id == assignment_id,
            models.ProductionMaterialSectionAssignment.section == section,
            models.ProductionMaterialSectionAssignment.removed_at.is_(None),
        )
        .first()
    )
    if row is None:
        raise HTTPException(status_code=404, detail="Assignment not found")
    return row


def _txn_status(txn: models.ProductionMaterialTransaction) -> str:
    if txn.voided_at is not None:
        return "voided"
    if txn.superseded_at is not None:
        return "superseded"
    return "active"


def _txn_to_out(txn: models.ProductionMaterialTransaction) -> ProductionMaterialTransactionOut:
    return ProductionMaterialTransactionOut(
        id=txn.id,
        section=txn.section,
        contract_employee_id=txn.contract_employee_id,
        material_type_id=txn.material_type_id,
        material_name=txn.material_name,
        quantity=Decimal(str(txn.quantity)),
        unit=txn.unit,
        txn_type=txn.txn_type,
        notes=txn.notes,
        given_by=historical_attribution_label(txn.given_by_user),
        transaction_at=txn.transaction_at,
        created_at=txn.created_at,
        status=_txn_status(txn),
        effective_quantity=transaction_effective_quantity(txn),
        reversal_of_id=txn.reversal_of_id,
        supersedes_id=txn.supersedes_id,
        superseded_by_id=txn.superseded_by_id,
        void_reason=txn.void_reason,
    )


def _get_transaction(db: Session, transaction_id: int) -> models.ProductionMaterialTransaction:
    row = (
        db.query(models.ProductionMaterialTransaction)
        .options(joinedload(models.ProductionMaterialTransaction.given_by_user))
        .filter(models.ProductionMaterialTransaction.id == transaction_id)
        .first()
    )
    if row is None:
        raise HTTPException(status_code=404, detail="Transaction not found")
    return row


def _ensure_active_allocation(txn: models.ProductionMaterialTransaction) -> None:
    if txn.txn_type != "allocation":
        raise HTTPException(status_code=400, detail="Only allocation entries can be edited or voided directly")
    if txn.voided_at is not None:
        raise HTTPException(status_code=400, detail="Transaction is voided")
    if txn.superseded_at is not None:
        raise HTTPException(status_code=400, detail="Transaction has been superseded")


@router.get("/sections", response_model=list[dict[str, str]])
def list_sections(
    _current_user=Depends(require_role(["admin", "factory"])),
):
    return [{"key": key, "label": SECTION_LABELS[key]} for key in SECTION_LABELS]


@router.get("/sections/{section}/material-types", response_model=list[ProductionMaterialTypeOut])
def list_material_types(
    section: str,
    db: Session = Depends(get_db),
    _current_user=Depends(require_role(["admin", "factory"])),
    include_inactive: bool = Query(False),
):
    section = _parse_section(section)
    q = db.query(models.ProductionMaterialType).filter(
        models.ProductionMaterialType.section == section,
        models.ProductionMaterialType.deleted_at.is_(None),
    )
    if not include_inactive:
        q = q.filter(models.ProductionMaterialType.is_active.is_(True))
    rows = q.order_by(models.ProductionMaterialType.name.asc()).all()
    return rows


@router.post("/sections/{section}/material-types", response_model=ProductionMaterialTypeOut)
def create_material_type(
    section: str,
    body: ProductionMaterialTypeCreate,
    db: Session = Depends(get_db),
    current_user=Depends(require_role(["admin", "factory"])),
):
    section = _parse_section(section)
    name = body.name.strip()
    existing = (
        db.query(models.ProductionMaterialType)
        .filter(
            models.ProductionMaterialType.section == section,
            models.ProductionMaterialType.name == name,
            models.ProductionMaterialType.deleted_at.is_(None),
        )
        .first()
    )
    if existing is not None:
        raise HTTPException(status_code=409, detail="Material type already exists in this section")
    archived = (
        db.query(models.ProductionMaterialType)
        .filter(
            models.ProductionMaterialType.section == section,
            models.ProductionMaterialType.name == name,
            models.ProductionMaterialType.deleted_at.isnot(None),
        )
        .first()
    )
    if archived is not None:
        archived.deleted_at = None
        archived.deleted_by_id = None
        archived.is_active = True
        archived.default_unit = (body.default_unit or "").strip() or archived.default_unit
        log_activity(
            db,
            action=PRODUCTION_MATERIAL_TYPE_CREATED,
            entity_type="production_material_type",
            entity_id=archived.id,
            actor_user=current_user,
            meta={"section": section, "name": name, "reactivated": True},
        )
        db.commit()
        db.refresh(archived)
        return archived
    row = models.ProductionMaterialType(
        section=section,
        name=name,
        default_unit=(body.default_unit or "").strip() or None,
        is_active=True,
        created_by_id=current_user.id,
    )
    db.add(row)
    db.flush()
    log_activity(
        db,
        action=PRODUCTION_MATERIAL_TYPE_CREATED,
        entity_type="production_material_type",
        entity_id=row.id,
        actor_user=current_user,
        meta={"section": section, "name": name},
    )
    db.commit()
    db.refresh(row)
    return row


@router.put("/material-types/{material_type_id}", response_model=ProductionMaterialTypeOut)
def update_material_type(
    material_type_id: int,
    body: ProductionMaterialTypeUpdate,
    db: Session = Depends(get_db),
    current_user=Depends(require_role(["admin", "factory"])),
):
    row = (
        db.query(models.ProductionMaterialType)
        .filter(
            models.ProductionMaterialType.id == material_type_id,
            models.ProductionMaterialType.deleted_at.is_(None),
        )
        .first()
    )
    if row is None:
        raise HTTPException(status_code=404, detail="Material type not found")
    if body.name is not None:
        name = body.name.strip()
        dup = (
            db.query(models.ProductionMaterialType)
            .filter(
                models.ProductionMaterialType.section == row.section,
                models.ProductionMaterialType.name == name,
                models.ProductionMaterialType.id != row.id,
                models.ProductionMaterialType.deleted_at.is_(None),
            )
            .first()
        )
        if dup is not None:
            raise HTTPException(status_code=409, detail="Material type already exists in this section")
        row.name = name
    if body.default_unit is not None:
        row.default_unit = body.default_unit.strip() or None
    if body.is_active is not None:
        row.is_active = body.is_active
    log_activity(
        db,
        action=PRODUCTION_MATERIAL_TYPE_UPDATED,
        entity_type="production_material_type",
        entity_id=row.id,
        actor_user=current_user,
        meta={"section": row.section, "name": row.name},
    )
    db.commit()
    db.refresh(row)
    return row


@router.delete("/material-types/{material_type_id}", response_model=ProductionMaterialTypeOut)
def delete_material_type(
    material_type_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(require_role(["admin", "factory"])),
):
    row = (
        db.query(models.ProductionMaterialType)
        .filter(
            models.ProductionMaterialType.id == material_type_id,
            models.ProductionMaterialType.deleted_at.is_(None),
        )
        .first()
    )
    if row is None:
        raise HTTPException(status_code=404, detail="Material type not found")
    row.deleted_at = datetime.utcnow()
    row.deleted_by_id = current_user.id
    row.is_active = False
    log_activity(
        db,
        action=PRODUCTION_MATERIAL_TYPE_DELETED,
        entity_type="production_material_type",
        entity_id=row.id,
        actor_user=current_user,
        meta={"section": row.section, "name": row.name},
    )
    db.commit()
    db.refresh(row)
    return row


@router.get("/sections/{section}/contract-employees", response_model=list[ProductionMaterialContractEmployeeOption])
def list_contract_employee_options(
    section: str,
    db: Session = Depends(get_db),
    _current_user=Depends(require_role(["admin", "factory"])),
    search: str = Query("", max_length=200),
):
    section = _parse_section(section)
    q = db.query(models.ContractEmployee).filter(models.ContractEmployee.status == "active")
    s = (search or "").strip()
    if s:
        q = q.filter(models.ContractEmployee.full_name.ilike(f"%{s}%"))
    employees = q.order_by(models.ContractEmployee.full_name.asc()).all()
    assigned_ids = {
        int(row.contract_employee_id)
        for row in db.query(models.ProductionMaterialSectionAssignment.contract_employee_id)
        .filter(
            models.ProductionMaterialSectionAssignment.section == section,
            models.ProductionMaterialSectionAssignment.removed_at.is_(None),
        )
        .all()
    }
    return [
        ProductionMaterialContractEmployeeOption(
            id=emp.id,
            full_name=emp.full_name,
            status=emp.status,
            assigned_to_section=int(emp.id) in assigned_ids,
        )
        for emp in employees
    ]


@router.get("/sections/{section}/overview", response_model=ProductionMaterialSectionOverviewOut)
def get_section_overview(
    section: str,
    db: Session = Depends(get_db),
    _current_user=Depends(require_role(["admin", "factory"])),
):
    section = _parse_section(section)
    material_types = (
        db.query(models.ProductionMaterialType)
        .filter(
            models.ProductionMaterialType.section == section,
            models.ProductionMaterialType.deleted_at.is_(None),
            models.ProductionMaterialType.is_active.is_(True),
        )
        .order_by(models.ProductionMaterialType.name.asc())
        .all()
    )
    assignments = (
        db.query(models.ProductionMaterialSectionAssignment)
        .options(joinedload(models.ProductionMaterialSectionAssignment.contract_employee))
        .options(joinedload(models.ProductionMaterialSectionAssignment.assigned_by_user))
        .filter(
            models.ProductionMaterialSectionAssignment.section == section,
            models.ProductionMaterialSectionAssignment.removed_at.is_(None),
        )
        .order_by(models.ContractEmployee.full_name.asc())
        .join(
            models.ContractEmployee,
            models.ContractEmployee.id == models.ProductionMaterialSectionAssignment.contract_employee_id,
        )
        .all()
    )
    employee_rows: list[ProductionMaterialEmployeeRowOut] = []
    for assignment in assignments:
        emp = assignment.contract_employee
        totals = compute_employee_material_totals(
            db,
            section=section,
            contract_employee_id=int(assignment.contract_employee_id),
        )
        employee_rows.append(
            ProductionMaterialEmployeeRowOut(
                assignment_id=assignment.id,
                contract_employee_id=assignment.contract_employee_id,
                full_name=emp.full_name if emp else f"Employee #{assignment.contract_employee_id}",
                material_totals=[ProductionMaterialTotalOut(**row) for row in totals],
            )
        )
    section_totals = compute_section_material_totals(db, section=section)
    combined_totals = list(section_totals)
    for employee_row in employee_rows:
        for total in employee_row.material_totals:
            combined_totals.append(
                {
                    "material_type_id": total.material_type_id,
                    "material_name": total.material_name,
                    "unit": total.unit,
                    "total_quantity": total.total_quantity,
                }
            )
    display_columns = build_display_material_columns(
        active_material_types=material_types,
        material_totals=combined_totals,
    )
    return ProductionMaterialSectionOverviewOut(
        section=section,
        section_label=SECTION_LABELS[section],
        material_types=material_types,
        display_columns=[ProductionMaterialDisplayColumnOut(**row) for row in display_columns],
        employees=employee_rows,
        section_totals=[ProductionMaterialTotalOut(**row) for row in section_totals],
    )


@router.post("/sections/{section}/assignments", response_model=ProductionMaterialAssignmentOut)
def assign_contract_employee(
    section: str,
    body: ProductionMaterialAssignmentCreate,
    db: Session = Depends(get_db),
    current_user=Depends(require_role(["admin", "factory"])),
):
    section = _parse_section(section)
    emp = (
        db.query(models.ContractEmployee)
        .filter(
            models.ContractEmployee.id == body.contract_employee_id,
            models.ContractEmployee.status == "active",
        )
        .first()
    )
    if emp is None:
        raise HTTPException(status_code=404, detail="Active contract employee not found")
    existing = _get_active_assignment(db, section=section, contract_employee_id=body.contract_employee_id)
    if existing is not None:
        raise HTTPException(status_code=409, detail="Employee is already assigned to this section")

    prior = (
        db.query(models.ProductionMaterialSectionAssignment)
        .filter(
            models.ProductionMaterialSectionAssignment.section == section,
            models.ProductionMaterialSectionAssignment.contract_employee_id == body.contract_employee_id,
            models.ProductionMaterialSectionAssignment.removed_at.isnot(None),
        )
        .first()
    )
    if prior is not None:
        prior.removed_at = None
        prior.removed_by_id = None
        prior.assigned_at = datetime.utcnow()
        prior.assigned_by_id = current_user.id
        row = prior
    else:
        row = models.ProductionMaterialSectionAssignment(
            section=section,
            contract_employee_id=body.contract_employee_id,
            assigned_by_id=current_user.id,
        )
        db.add(row)
    db.flush()
    log_activity(
        db,
        action=PRODUCTION_MATERIAL_ASSIGNED,
        entity_type="production_material_assignment",
        entity_id=row.id,
        actor_user=current_user,
        meta={"section": section, "contract_employee_id": body.contract_employee_id},
    )
    db.commit()
    db.refresh(row)
    return ProductionMaterialAssignmentOut(
        id=row.id,
        section=row.section,
        contract_employee_id=row.contract_employee_id,
        full_name=emp.full_name,
        assigned_at=row.assigned_at,
        assigned_by=historical_attribution_label(current_user),
    )


@router.delete("/sections/{section}/assignments/{assignment_id}")
def unassign_contract_employee(
    section: str,
    assignment_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(require_role(["admin", "factory"])),
):
    section = _parse_section(section)
    row = _get_assignment_by_id(db, section=section, assignment_id=assignment_id)
    row.removed_at = datetime.utcnow()
    row.removed_by_id = current_user.id
    log_activity(
        db,
        action=PRODUCTION_MATERIAL_UNASSIGNED,
        entity_type="production_material_assignment",
        entity_id=row.id,
        actor_user=current_user,
        meta={"section": section, "contract_employee_id": row.contract_employee_id},
    )
    db.commit()
    return {"ok": True}


@router.get(
    "/sections/{section}/employees/{contract_employee_id}/transactions",
    response_model=list[ProductionMaterialTransactionOut],
)
def list_employee_transactions(
    section: str,
    contract_employee_id: int,
    db: Session = Depends(get_db),
    _current_user=Depends(require_role(["admin", "factory"])),
    include_inactive: bool = Query(True),
):
    section = _parse_section(section)
    if _get_active_assignment(db, section=section, contract_employee_id=contract_employee_id) is None:
        raise HTTPException(status_code=404, detail="Employee is not assigned to this section")
    q = (
        db.query(models.ProductionMaterialTransaction)
        .options(joinedload(models.ProductionMaterialTransaction.given_by_user))
        .filter(
            models.ProductionMaterialTransaction.section == section,
            models.ProductionMaterialTransaction.contract_employee_id == contract_employee_id,
        )
    )
    if not include_inactive:
        q = q.filter(
            models.ProductionMaterialTransaction.voided_at.is_(None),
            models.ProductionMaterialTransaction.superseded_at.is_(None),
        )
    rows = q.order_by(
        models.ProductionMaterialTransaction.transaction_at.desc(),
        models.ProductionMaterialTransaction.id.desc(),
    ).all()
    return [_txn_to_out(row) for row in rows]


@router.post(
    "/sections/{section}/employees/{contract_employee_id}/transactions",
    response_model=ProductionMaterialTransactionOut,
)
def create_allocation(
    section: str,
    contract_employee_id: int,
    body: ProductionMaterialTransactionCreate,
    db: Session = Depends(get_db),
    current_user=Depends(require_role(["admin", "factory"])),
):
    section = _parse_section(section)
    if _get_active_assignment(db, section=section, contract_employee_id=contract_employee_id) is None:
        raise HTTPException(status_code=404, detail="Employee is not assigned to this section")
    material_type = _get_material_type(db, section=section, material_type_id=body.material_type_id)
    unit = (body.unit or material_type.default_unit or "").strip() or None
    row = models.ProductionMaterialTransaction(
        section=section,
        contract_employee_id=contract_employee_id,
        material_type_id=material_type.id,
        material_name=material_type.name,
        quantity=body.quantity,
        unit=unit,
        txn_type="allocation",
        notes=(body.notes or "").strip() or None,
        given_by_user_id=current_user.id,
        transaction_at=body.transaction_at,
    )
    db.add(row)
    db.flush()
    log_activity(
        db,
        action=PRODUCTION_MATERIAL_ALLOCATED,
        entity_type="production_material_transaction",
        entity_id=row.id,
        actor_user=current_user,
        meta={
            "section": section,
            "contract_employee_id": contract_employee_id,
            "material_name": material_type.name,
            "quantity": str(body.quantity),
        },
    )
    db.commit()
    db.refresh(row)
    return _txn_to_out(row)


@router.put("/transactions/{transaction_id}", response_model=ProductionMaterialTransactionOut)
def update_allocation(
    transaction_id: int,
    body: ProductionMaterialTransactionUpdate,
    db: Session = Depends(get_db),
    current_user=Depends(require_role(["admin", "factory"])),
):
    original = _get_transaction(db, transaction_id)
    _ensure_active_allocation(original)

    if body.material_type_id is not None:
        material_type = _get_material_type(db, section=original.section, material_type_id=body.material_type_id)
        material_type_id = material_type.id
        material_name = material_type.name
    elif original.material_type_id is not None:
        material_type = _get_material_type(
            db,
            section=original.section,
            material_type_id=original.material_type_id,
            allow_deleted=True,
        )
        material_type_id = material_type.id
        material_name = material_type.name
    else:
        material_type = None
        material_type_id = original.material_type_id
        material_name = original.material_name

    new_quantity = Decimal(str(body.quantity)) if body.quantity is not None else Decimal(str(original.quantity))
    if body.unit is not None:
        new_unit = (body.unit or "").strip() or None
    elif body.material_type_id is not None and material_type is not None:
        new_unit = (material_type.default_unit or original.unit or "").strip() or None
    else:
        new_unit = original.unit
    new_notes = (body.notes or "").strip() or None if body.notes is not None else original.notes
    new_transaction_at = body.transaction_at if body.transaction_at is not None else original.transaction_at

    original.superseded_at = datetime.utcnow()
    original.superseded_by_id = current_user.id

    replacement = models.ProductionMaterialTransaction(
        section=original.section,
        contract_employee_id=original.contract_employee_id,
        material_type_id=material_type_id,
        material_name=material_name,
        quantity=new_quantity,
        unit=new_unit,
        txn_type="allocation",
        notes=new_notes,
        given_by_user_id=current_user.id,
        transaction_at=new_transaction_at,
        supersedes_id=original.id,
    )
    db.add(replacement)
    db.flush()
    log_activity(
        db,
        action=PRODUCTION_MATERIAL_UPDATED,
        entity_type="production_material_transaction",
        entity_id=replacement.id,
        actor_user=current_user,
        meta={"supersedes_id": original.id, "section": original.section},
    )
    db.commit()
    db.refresh(replacement)
    return _txn_to_out(replacement)


@router.post("/transactions/{transaction_id}/reverse", response_model=ProductionMaterialTransactionOut)
def reverse_allocation(
    transaction_id: int,
    body: ProductionMaterialTransactionReverse,
    db: Session = Depends(get_db),
    current_user=Depends(require_role(["admin", "factory"])),
):
    original = _get_transaction(db, transaction_id)
    _ensure_active_allocation(original)
    reverse_qty = Decimal(str(body.quantity)) if body.quantity is not None else Decimal(str(original.quantity))
    if reverse_qty <= 0:
        raise HTTPException(status_code=400, detail="Reversal quantity must be greater than zero")
    if reverse_qty > Decimal(str(original.quantity)):
        raise HTTPException(status_code=400, detail="Reversal quantity cannot exceed original allocation quantity")

    row = models.ProductionMaterialTransaction(
        section=original.section,
        contract_employee_id=original.contract_employee_id,
        material_type_id=original.material_type_id,
        material_name=original.material_name,
        quantity=reverse_qty,
        unit=original.unit,
        txn_type="reversal",
        notes=(body.notes or "").strip() or None,
        given_by_user_id=current_user.id,
        transaction_at=body.transaction_at or datetime.utcnow(),
        reversal_of_id=original.id,
    )
    db.add(row)
    db.flush()
    log_activity(
        db,
        action=PRODUCTION_MATERIAL_REVERSED,
        entity_type="production_material_transaction",
        entity_id=row.id,
        actor_user=current_user,
        meta={"reversal_of_id": original.id, "section": original.section, "quantity": str(reverse_qty)},
    )
    db.commit()
    db.refresh(row)
    return _txn_to_out(row)


@router.post("/transactions/{transaction_id}/void", response_model=ProductionMaterialTransactionOut)
def void_allocation(
    transaction_id: int,
    body: ProductionMaterialTransactionVoid | None = None,
    db: Session = Depends(get_db),
    current_user=Depends(require_role(["admin", "factory"])),
):
    txn = _get_transaction(db, transaction_id)
    if txn.txn_type == "allocation":
        _ensure_active_allocation(txn)
    elif txn.txn_type == "reversal":
        if txn.voided_at is not None:
            raise HTTPException(status_code=400, detail="Transaction is voided")
        if txn.superseded_at is not None:
            raise HTTPException(status_code=400, detail="Transaction has been superseded")
    else:
        raise HTTPException(status_code=400, detail="Unsupported transaction type")

    txn.voided_at = datetime.utcnow()
    txn.voided_by_id = current_user.id
    txn.void_reason = ((body.reason if body else None) or "").strip() or None
    log_activity(
        db,
        action=PRODUCTION_MATERIAL_VOIDED,
        entity_type="production_material_transaction",
        entity_id=txn.id,
        actor_user=current_user,
        meta={"section": txn.section, "txn_type": txn.txn_type},
    )
    db.commit()
    db.refresh(txn)
    return _txn_to_out(txn)
