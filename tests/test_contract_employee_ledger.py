"""Contract employee account ledger: running balance derivation."""

from __future__ import annotations

from datetime import datetime, timedelta
from decimal import Decimal

from app import models
from app.utils.contract_employee_ledger import build_contract_employee_ledger


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _make_ce(db_session, *, name: str = "Ledger Worker") -> models.ContractEmployee:
    ce = models.ContractEmployee(
        full_name=name,
        status="active",
        balance=Decimal("0"),
        total_owed=Decimal("0"),
        total_paid=Decimal("0"),
    )
    db_session.add(ce)
    db_session.flush()
    return ce


def test_ledger_running_balance_chronological(db_session):
    ce = _make_ce(db_session)
    base = datetime(2026, 6, 1, 10, 0, 0)

    t1 = models.EmployeeTransaction(
        contract_employee_id=ce.id,
        txn_type="owed_increase",
        amount=Decimal("120000"),
        status="paid",
        created_at=base,
        paid_at=base,
        note="Manual increase",
    )
    t2 = models.EmployeeTransaction(
        contract_employee_id=ce.id,
        txn_type="payment",
        amount=Decimal("30000"),
        status="paid",
        created_at=base + timedelta(hours=1),
        paid_at=base + timedelta(hours=1),
        processed_by_role="finance",
    )
    t3 = models.EmployeeTransaction(
        contract_employee_id=ce.id,
        txn_type="owed_decrease",
        amount=Decimal("20000"),
        status="paid",
        created_at=base + timedelta(hours=2),
        paid_at=base + timedelta(hours=2),
        note="Manual deduction",
    )
    db_session.add_all([t1, t2, t3])
    db_session.commit()

    entries = build_contract_employee_ledger(db_session, ce.id)
    assert len(entries) == 3

    assert entries[0].balance_before == Decimal("0")
    assert entries[0].balance_after == Decimal("120000")
    assert entries[0].credit == Decimal("120000")
    assert entries[0].debit == Decimal("0")

    assert entries[1].balance_before == Decimal("120000")
    assert entries[1].balance_after == Decimal("90000")
    assert entries[1].debit == Decimal("30000")

    assert entries[2].balance_before == Decimal("90000")
    assert entries[2].balance_after == Decimal("70000")
    assert entries[2].debit == Decimal("20000")


def test_ledger_pending_payment_does_not_change_balance(db_session):
    ce = _make_ce(db_session)
    base = datetime(2026, 6, 2, 10, 0, 0)

    db_session.add(
        models.EmployeeTransaction(
            contract_employee_id=ce.id,
            txn_type="owed_increase",
            amount=Decimal("50000"),
            status="paid",
            created_at=base,
            paid_at=base,
        )
    )
    db_session.add(
        models.EmployeeTransaction(
            contract_employee_id=ce.id,
            txn_type="payment",
            amount=Decimal("15000"),
            status="requested",
            created_at=base + timedelta(hours=1),
        )
    )
    db_session.commit()

    entries = build_contract_employee_ledger(db_session, ce.id)
    assert entries[0].balance_after == Decimal("50000")
    assert entries[1].balance_before == Decimal("50000")
    assert entries[1].balance_after == Decimal("50000")
    assert entries[1].debit == Decimal("15000")


def test_ledger_api_pagination(client, admin_token, db_session):
    ce = _make_ce(db_session, name="Paged Worker")
    base = datetime(2026, 6, 3, 10, 0, 0)
    for i in range(25):
        db_session.add(
            models.EmployeeTransaction(
                contract_employee_id=ce.id,
                txn_type="owed_increase",
                amount=Decimal("1000"),
                status="paid",
                created_at=base + timedelta(minutes=i),
                paid_at=base + timedelta(minutes=i),
            )
        )
    db_session.commit()

    page1 = client.get(
        f"/contract-employees/{ce.id}/ledger",
        params={"limit": 20, "offset": 0, "sort": "newest"},
        headers=_auth(admin_token),
    )
    assert page1.status_code == 200, page1.text
    body1 = page1.json()
    assert body1["total"] == 25
    assert len(body1["items"]) == 20
    assert "balance_before" in body1["items"][0]
    assert "balance_after" in body1["items"][0]
    assert "credit" in body1["items"][0]

    page2 = client.get(
        f"/contract-employees/{ce.id}/ledger",
        params={"limit": 20, "offset": 20, "sort": "newest"},
        headers=_auth(admin_token),
    )
    assert page2.status_code == 200, page2.text
    assert len(page2.json()["items"]) == 5


def test_ledger_export_csv_contract_employee(client, admin_token, db_session):
    ce = _make_ce(db_session, name="Export Worker")
    db_session.add(
        models.EmployeeTransaction(
            contract_employee_id=ce.id,
            txn_type="owed_increase",
            amount=Decimal("10000"),
            status="paid",
            created_at=datetime(2026, 6, 4, 9, 0, 0),
            paid_at=datetime(2026, 6, 4, 9, 0, 0),
            note="Test increase",
        )
    )
    db_session.commit()

    res = client.get(
        "/employee-payments/export",
        params={"contract_employee_id": ce.id},
        headers=_auth(admin_token),
    )
    assert res.status_code == 200, res.text
    text = res.text
    assert "Balance Before" in text
    assert "Balance After" in text
    assert "Credit" in text
    assert "Debit" in text
    assert "Test increase" in text
