"""Finance transaction history: server-side pagination and filters."""

from __future__ import annotations

from datetime import datetime, timedelta
from decimal import Decimal

from app import models


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _paid_contract_payment(db_session, *, name: str, amount: str, when: datetime) -> models.EmployeeTransaction:
    ce = models.ContractEmployee(full_name=name, status="active", balance=Decimal("0"), total_paid=Decimal(amount))
    db_session.add(ce)
    db_session.flush()
    txn = models.EmployeeTransaction(
        contract_employee_id=ce.id,
        txn_type="payment",
        amount=Decimal(amount),
        status="paid",
        created_at=when,
        paid_at=when,
    )
    db_session.add(txn)
    db_session.commit()
    db_session.refresh(txn)
    return txn


def test_payment_history_pagination_newest_first(client, admin_token, db_session):
    base = datetime(2026, 5, 1, 12, 0, 0)
    for i in range(25):
        _paid_contract_payment(
            db_session,
            name=f"Worker {i}",
            amount="100.00",
            when=base + timedelta(hours=i),
        )

    page1 = client.get(
        "/employee-payments/history",
        params={"kind": "contract", "limit": 20, "offset": 0, "sort": "newest"},
        headers=_auth(admin_token),
    )
    assert page1.status_code == 200, page1.text
    body1 = page1.json()
    assert body1["total"] == 25
    assert body1["limit"] == 20
    assert body1["offset"] == 0
    assert len(body1["items"]) == 20
    ids1 = [it["transaction"]["id"] for it in body1["items"]]
    assert ids1 == sorted(ids1, reverse=True)

    page2 = client.get(
        "/employee-payments/history",
        params={"kind": "contract", "limit": 20, "offset": 20, "sort": "newest"},
        headers=_auth(admin_token),
    )
    assert page2.status_code == 200, page2.text
    body2 = page2.json()
    assert len(body2["items"]) == 5
    ids2 = [it["transaction"]["id"] for it in body2["items"]]
    assert set(ids1).isdisjoint(set(ids2))


def test_payment_history_search_no_match_returns_empty(client, admin_token, db_session):
    _paid_contract_payment(
        db_session,
        name="Alice Contractor",
        amount="50.00",
        when=datetime(2026, 5, 10, 9, 0, 0),
    )
    r = client.get(
        "/employee-payments/history",
        params={"kind": "contract", "search": "No Such Name", "limit": 20, "offset": 0},
        headers=_auth(admin_token),
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["total"] == 0
    assert body["items"] == []


def test_payment_history_search_filters_by_name(client, admin_token, db_session):
    _paid_contract_payment(
        db_session,
        name="Alice Contractor",
        amount="50.00",
        when=datetime(2026, 5, 10, 9, 0, 0),
    )
    _paid_contract_payment(
        db_session,
        name="Bob Builder",
        amount="75.00",
        when=datetime(2026, 5, 11, 9, 0, 0),
    )
    r = client.get(
        "/employee-payments/history",
        params={"kind": "contract", "search": "Alice", "limit": 20, "offset": 0},
        headers=_auth(admin_token),
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["total"] == 1
    assert body["items"][0]["employee_name"] == "Alice Contractor"
