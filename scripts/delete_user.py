import argparse
import os
import sys
from dataclasses import dataclass
from typing import Callable, Iterable

from sqlalchemy.orm import Session

# Ensure imports work when running as a script (python scripts/delete_user.py ...).
_REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _REPO_ROOT not in sys.path:
    sys.path.insert(0, _REPO_ROOT)

from app import models
from app.database import SessionLocal


@dataclass(frozen=True)
class Ref:
    label: str
    model: type
    column: object


def _refs() -> list[Ref]:
    # Columns that reference users.id in this codebase.
    # Keep this list explicit so a deletion never "misses" a FK silently.
    return [
        Ref("customers.creator_id", models.Customer, models.Customer.creator_id),
        Ref("customers.deleted_by_id", models.Customer, models.Customer.deleted_by_id),
        Ref("products.deleted_by_id", models.Product, models.Product.deleted_by_id),
        Ref("orders.created_by", models.Order, models.Order.created_by),
        Ref("orders.updated_by", models.Order, models.Order.updated_by),
        Ref("orders.deleted_by_id", models.Order, models.Order.deleted_by_id),
        Ref("invoices.deleted_by_id", models.Invoice, models.Invoice.deleted_by_id),
        Ref("action_logs.actor_user_id", models.ActionLog, models.ActionLog.actor_user_id),
        Ref("proforma_invoices.created_by", models.ProformaInvoice, models.ProformaInvoice.created_by),
        Ref("proforma_invoices.updated_by", models.ProformaInvoice, models.ProformaInvoice.updated_by),
        Ref("proforma_invoices.deleted_by_id", models.ProformaInvoice, models.ProformaInvoice.deleted_by_id),
        Ref("quotations.created_by", models.Quotation, models.Quotation.created_by),
        Ref("quotations.updated_by", models.Quotation, models.Quotation.updated_by),
        Ref("quotations.deleted_by_id", models.Quotation, models.Quotation.deleted_by_id),
        Ref("waybills.created_by", models.Waybill, models.Waybill.created_by),
        Ref("waybills.updated_by", models.Waybill, models.Waybill.updated_by),
        Ref("waybills.deleted_by_id", models.Waybill, models.Waybill.deleted_by_id),
        Ref("inventory_materials.created_by_id", models.InventoryMaterial, models.InventoryMaterial.created_by_id),
        Ref("inventory_materials.updated_by_id", models.InventoryMaterial, models.InventoryMaterial.updated_by_id),
        Ref("inventory_materials.deleted_by_id", models.InventoryMaterial, models.InventoryMaterial.deleted_by_id),
        Ref("inventory_material_payments.created_by_id", models.InventoryMaterialPayment, models.InventoryMaterialPayment.created_by_id),
        Ref("inventory_movements.actor_user_id", models.InventoryMovement, models.InventoryMovement.actor_user_id),
    ]


def _find_user_by_email(db: Session, email: str) -> models.User | None:
    return db.query(models.User).filter(models.User.email == email.strip()).first()


def _count_refs(db: Session, user_id: int) -> dict[str, int]:
    counts: dict[str, int] = {}
    for r in _refs():
        counts[r.label] = int(db.query(r.model).filter(r.column == user_id).count())
    return counts


def _apply_updates(
    db: Session,
    user_id: int,
    new_user_id: int,
    dry_run: bool,
    log: Callable[[str], None],
) -> None:
    for r in _refs():
        q = db.query(r.model).filter(r.column == user_id)
        n = int(q.count())
        if n <= 0:
            continue
        log(f"- {r.label}: {n} row(s) -> user_id={new_user_id}")
        if not dry_run:
            q.update({r.column: new_user_id}, synchronize_session=False)


def _anonymize_user(db: Session, user: models.User, dry_run: bool, log: Callable[[str], None]) -> None:
    # Keep the row to preserve audit/history references.
    # Email must remain unique; use a guaranteed-invalid domain.
    replacement_email = f"deleted_user_{user.id}@example.invalid"
    log(f"- users.email: {user.email!r} -> {replacement_email!r}")
    log(f"- users.name: {user.name!r} -> 'Deleted user'")
    log("- users.password: overwritten (unusable)")
    if not dry_run:
        user.email = replacement_email
        user.name = "Deleted user"
        user.password = "!!deleted!!"


def main() -> int:
    p = argparse.ArgumentParser(description="Delete/anonymize a user by email.")
    p.add_argument("email", help="User email to delete/anonymize")
    mode = p.add_mutually_exclusive_group(required=False)
    mode.add_argument(
        "--hard-delete",
        action="store_true",
        help="Hard delete user row (requires --reassign-to).",
    )
    mode.add_argument(
        "--anonymize",
        action="store_true",
        help="Anonymize the user (default; preserves FK references).",
    )
    p.add_argument(
        "--reassign-to",
        default=None,
        help="Email of user that will take over all references (required for --hard-delete).",
    )
    p.add_argument("--apply", action="store_true", help="Actually write changes (default: dry-run).")
    args = p.parse_args()

    email = str(args.email).strip()
    dry_run = not bool(args.apply)
    hard_delete = bool(args.hard_delete)
    anonymize = bool(args.anonymize) or not hard_delete

    def log(s: str) -> None:
        print(s)

    db = SessionLocal()
    try:
        user = _find_user_by_email(db, email)
        if not user:
            log(f"User not found: {email}")
            return 2

        log(f"Target user: id={user.id} email={user.email!r} role={user.role!r}")
        counts = _count_refs(db, user.id)
        total_refs = sum(counts.values())
        log(f"FK references found: {total_refs}")
        for k, v in counts.items():
            if v:
                log(f"  - {k}: {v}")

        if hard_delete:
            if not args.reassign_to:
                log("ERROR: --hard-delete requires --reassign-to <email>")
                return 2
            new_user = _find_user_by_email(db, str(args.reassign_to))
            if not new_user:
                log(f"ERROR: reassign target not found: {args.reassign_to}")
                return 2
            if new_user.id == user.id:
                log("ERROR: --reassign-to user cannot be the same as the target user")
                return 2

            log(f"Reassigning references to user id={new_user.id} email={new_user.email!r}")
            _apply_updates(db, user.id, new_user.id, dry_run=dry_run, log=log)

            log(f"Deleting users row id={user.id}")
            if not dry_run:
                db.delete(user)
                db.commit()
            else:
                log("(dry-run) no changes committed")
            return 0

        if anonymize:
            log("Anonymizing user (recommended when audit/history should be preserved).")
            _anonymize_user(db, user, dry_run=dry_run, log=log)
            if not dry_run:
                db.commit()
            else:
                log("(dry-run) no changes committed")
            return 0

        log("No mode selected.")
        return 2
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())

