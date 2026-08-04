#!/usr/bin/env python3
"""
Phase 2 investigation (read-only): find ledger rows where credit/debit is shown
but balance_before == balance_after.

Usage (production/staging — read-only):
  python scripts/investigate_flat_ledger_balances.py

Requires DATABASE_URL in environment. Does NOT modify any data.
"""
from __future__ import annotations

import os
import sys
from decimal import Decimal
from pathlib import Path

_PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_PROJECT_ROOT))

from sqlalchemy.orm import Session

from app.database import SessionLocal
from app.utils.contract_employee_ledger import build_contract_employee_ledger


def _has_amount(entry) -> bool:
    return entry.credit > 0 or entry.debit > 0


def investigate(db: Session) -> list[dict]:
    from app import models

    ce_ids = [int(r[0]) for r in db.query(models.ContractEmployee.id).all()]
    findings: list[dict] = []

    for ce_id in ce_ids:
        entries = build_contract_employee_ledger(db, ce_id)
        reversed_by_orig: dict[int, int | None] = {}
        for e in entries:
            txn = e.transaction
            if txn.txn_type == "reversal" and txn.reversal_of_id:
                reversed_by_orig[int(txn.reversal_of_id)] = int(txn.id)

        for e in entries:
            if not _has_amount(e):
                continue
            if e.balance_before != e.balance_after:
                continue

            txn = e.transaction
            tid = int(txn.id)
            rev_id = reversed_by_orig.get(tid)
            findings.append(
                {
                    "contract_employee_id": ce_id,
                    "transaction_id": tid,
                    "ledger_type": e.ledger_type,
                    "txn_type": txn.txn_type,
                    "status": txn.status,
                    "credit": str(e.credit),
                    "debit": str(e.debit),
                    "balance_before": str(e.balance_before),
                    "balance_after": str(e.balance_after),
                    "has_reversal": rev_id is not None,
                    "reversal_transaction_id": rev_id,
                    "intentional": rev_id is not None or txn.status in ("requested", "approved_by_admin", "sent_to_finance", "pending", "resolved", "cancelled"),
                    "ui_misleading": rev_id is not None and (e.credit > 0 or e.debit > 0),
                }
            )

    return findings


def main() -> int:
    if not (os.getenv("DATABASE_URL") or "").strip():
        print("DATABASE_URL is not set.", file=sys.stderr)
        return 1

    db = SessionLocal()
    try:
        rows = investigate(db)
    finally:
        db.close()

    if not rows:
        print("No flat-balance rows with credit/debit found.")
        return 0

    print(f"Found {len(rows)} row(s):\n")
    for r in rows:
        print("-" * 60)
        for k, v in r.items():
            print(f"  {k}: {v}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
