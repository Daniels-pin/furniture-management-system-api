"""Helpers for production material tracking totals and ledger integrity."""
from __future__ import annotations

from collections import defaultdict
from decimal import Decimal

from sqlalchemy import case, func
from sqlalchemy.orm import Session

from app import models

PRODUCTION_MATERIAL_SECTIONS = ("painters_dept", "mdf_section")

SECTION_LABELS = {
    "painters_dept": "Painters Dept",
    "mdf_section": "MDF Section",
}


def validate_section(section: str) -> str:
    s = (section or "").strip()
    if s not in PRODUCTION_MATERIAL_SECTIONS:
        raise ValueError(f"Invalid section: {section}")
    return s


def _as_dec(value: object | None) -> Decimal:
    if value is None:
        return Decimal("0")
    return Decimal(str(value))


def transaction_effective_quantity(txn: models.ProductionMaterialTransaction) -> Decimal:
    if txn.voided_at is not None or txn.superseded_at is not None:
        return Decimal("0")
    qty = _as_dec(txn.quantity)
    if txn.txn_type == "reversal":
        return -qty
    return qty


def active_transaction_filter():
    return (
        models.ProductionMaterialTransaction.voided_at.is_(None),
        models.ProductionMaterialTransaction.superseded_at.is_(None),
    )


def signed_quantity_expr():
    return case(
        (models.ProductionMaterialTransaction.txn_type == "reversal", -models.ProductionMaterialTransaction.quantity),
        else_=models.ProductionMaterialTransaction.quantity,
    )


def _material_total_key(material_type_id: object | None, material_name: object | None) -> str:
    if material_type_id is not None:
        return f"id:{material_type_id}"
    return f"name:{material_name or ''}"


def _merge_material_total_rows(rows: list[tuple]) -> list[dict[str, object]]:
    """Merge split SQL groups into one total per material (by type id, else name)."""
    merged: dict[str, dict[str, object]] = {}
    for material_type_id, material_name, unit, total_quantity in rows:
        total = _as_dec(total_quantity)
        if total == 0:
            continue
        key = _material_total_key(material_type_id, material_name)
        entry = merged.get(key)
        if entry is None:
            merged[key] = {
                "material_type_id": material_type_id,
                "material_name": material_name,
                "unit": unit,
                "total_quantity": total,
            }
            continue
        entry["total_quantity"] = _as_dec(entry["total_quantity"]) + total
        if not entry.get("unit") and unit:
            entry["unit"] = unit
    out = list(merged.values())
    out.sort(key=lambda row: str(row.get("material_name") or ""))
    return out


def compute_employee_material_totals(
    db: Session,
    *,
    section: str,
    contract_employee_id: int,
) -> list[dict[str, object]]:
    voided, superseded = active_transaction_filter()
    rows = (
        db.query(
            models.ProductionMaterialTransaction.material_type_id,
            models.ProductionMaterialTransaction.material_name,
            models.ProductionMaterialTransaction.unit,
            func.coalesce(func.sum(signed_quantity_expr()), 0).label("total_quantity"),
        )
        .filter(
            models.ProductionMaterialTransaction.section == section,
            models.ProductionMaterialTransaction.contract_employee_id == contract_employee_id,
            voided,
            superseded,
        )
        .group_by(
            models.ProductionMaterialTransaction.material_type_id,
            models.ProductionMaterialTransaction.material_name,
            models.ProductionMaterialTransaction.unit,
        )
        .all()
    )
    return _merge_material_total_rows(rows)


def compute_all_employee_material_totals_map(
    db: Session,
    *,
    section: str,
    contract_employee_ids: list[int],
) -> dict[int, list[dict[str, object]]]:
    """One grouped query for all assignments in a section (avoids per-employee aggregates)."""
    if not contract_employee_ids:
        return {}
    voided, superseded = active_transaction_filter()
    rows = (
        db.query(
            models.ProductionMaterialTransaction.contract_employee_id,
            models.ProductionMaterialTransaction.material_type_id,
            models.ProductionMaterialTransaction.material_name,
            models.ProductionMaterialTransaction.unit,
            func.coalesce(func.sum(signed_quantity_expr()), 0).label("total_quantity"),
        )
        .filter(
            models.ProductionMaterialTransaction.section == section,
            models.ProductionMaterialTransaction.contract_employee_id.in_(contract_employee_ids),
            voided,
            superseded,
        )
        .group_by(
            models.ProductionMaterialTransaction.contract_employee_id,
            models.ProductionMaterialTransaction.material_type_id,
            models.ProductionMaterialTransaction.material_name,
            models.ProductionMaterialTransaction.unit,
        )
        .all()
    )
    by_emp: dict[int, list[tuple]] = defaultdict(list)
    for ce_id, material_type_id, material_name, unit, total_quantity in rows:
        by_emp[int(ce_id)].append((material_type_id, material_name, unit, total_quantity))
    return {ce_id: _merge_material_total_rows(emp_rows) for ce_id, emp_rows in by_emp.items()}


def compute_section_material_totals(
    db: Session,
    *,
    section: str,
) -> list[dict[str, object]]:
    voided, superseded = active_transaction_filter()
    rows = (
        db.query(
            models.ProductionMaterialTransaction.material_type_id,
            models.ProductionMaterialTransaction.material_name,
            models.ProductionMaterialTransaction.unit,
            func.coalesce(func.sum(signed_quantity_expr()), 0).label("total_quantity"),
        )
        .filter(
            models.ProductionMaterialTransaction.section == section,
            voided,
            superseded,
        )
        .group_by(
            models.ProductionMaterialTransaction.material_type_id,
            models.ProductionMaterialTransaction.material_name,
            models.ProductionMaterialTransaction.unit,
        )
        .all()
    )
    return _merge_material_total_rows(rows)


def build_display_material_columns(
    *,
    active_material_types: list[models.ProductionMaterialType],
    material_totals: list[dict[str, object]],
) -> list[dict[str, object]]:
    """Active types for selection plus archived types that still have historical totals."""
    columns: dict[str, dict[str, object]] = {}
    for mt in active_material_types:
        key = f"id:{mt.id}"
        columns[key] = {
            "material_type_id": mt.id,
            "material_name": mt.name,
            "unit": mt.default_unit,
            "is_selectable": True,
        }
    for row in material_totals:
        material_type_id = row.get("material_type_id")
        material_name = str(row.get("material_name") or "")
        key = f"id:{material_type_id}" if material_type_id is not None else f"name:{material_name}"
        if key in columns:
            continue
        columns[key] = {
            "material_type_id": material_type_id,
            "material_name": material_name,
            "unit": row.get("unit"),
            "is_selectable": False,
        }
    out = list(columns.values())
    out.sort(key=lambda row: str(row.get("material_name") or ""))
    return out
