"""PDF worker isolation, document numbers, and read-only quotation loads."""
from __future__ import annotations

import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor

import pytest

from app import models
from app.utils.browser_pdf import _PdfRenderWorker
from app.utils.company_settings import get_company_settings_row
from app.utils.pdf_token import create_pdf_render_token
from app.utils.invoices import next_invoice_number
from app.utils.presales_order import next_proforma_number, next_quotation_number
from app.routes.waybill import next_waybill_number
from sqlalchemy.orm import sessionmaker


def _quote_payload(name: str) -> dict:
    return {
        "customer_name": name,
        "phone": f"080{uuid.uuid4().hex[:8]}",
        "address": "Street",
        "items": [{"item_name": "Item", "description": "Desc", "quantity": 1, "amount": "100.00"}],
        "save_as_draft": False,
    }


def test_quotation_and_proforma_numbers_are_not_reused_after_delete(client, admin_token, db_session):
    headers = {"Authorization": f"Bearer {admin_token}"}

    def create_quote() -> str:
        res = client.post("/quotations", json=_quote_payload("Number Quote"), headers=headers)
        assert res.status_code == 200, res.text
        return res.json()["quote_number"]

    def create_proforma() -> str:
        res = client.post("/proforma", json=_quote_payload("Number Proforma"), headers=headers)
        assert res.status_code == 200, res.text
        return res.json()["proforma_number"]

    q1 = create_quote()
    q2 = create_quote()
    p1 = create_proforma()
    p2 = create_proforma()
    assert q1 != q2
    assert p1 != p2

    db_session.query(models.QuotationItem).delete()
    db_session.query(models.Quotation).delete()
    db_session.query(models.ProformaItem).delete()
    db_session.query(models.ProformaInvoice).delete()
    db_session.commit()

    q3 = create_quote()
    p3 = create_proforma()
    assert int(q3.split("-")[1]) == int(q2.split("-")[1]) + 1
    assert int(p3.split("-")[1]) == int(p2.split("-")[1]) + 1


def test_sequential_numbers_under_concurrent_sessions(tmp_path):
    from sqlalchemy import create_engine

    from app.db.base_class import Base

    engine = create_engine(
        f"sqlite:///{tmp_path / 'numbers.db'}",
        connect_args={"check_same_thread": False, "timeout": 30},
    )
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine)

    def allocate(kind: str) -> str:
        db = session_factory()
        try:
            number = next_quotation_number(db) if kind == "quotation" else next_proforma_number(db)
            db.commit()
            return number
        finally:
            db.close()

    try:
        with ThreadPoolExecutor(max_workers=4) as pool:
            quotes = list(pool.map(lambda _: allocate("quotation"), range(4)))
            proformas = list(pool.map(lambda _: allocate("proforma"), range(4)))
    finally:
        engine.dispose()

    assert len(set(quotes)) == 4
    assert len(set(proformas)) == 4
    assert sorted(int(n.split("-")[1]) for n in quotes) == list(range(1, 5))


def test_invoice_and_waybill_numbers_do_not_rewind_after_delete(tmp_path):
    from sqlalchemy import create_engine

    from app.db.base_class import Base

    engine = create_engine(f"sqlite:///{tmp_path / 'doc-numbers.db'}")
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine)
    db = session_factory()
    try:
        user = models.User(name="num", email="num@example.com", password="x", role="admin")
        customer = models.Customer(name="Cust", phone="08000000000", address="Street")
        db.add_all([user, customer])
        db.flush()
        orders = [models.Order(customer_id=customer.id, created_by=user.id) for _ in range(2)]
        db.add_all(orders)
        db.flush()
        db.add(models.Invoice(invoice_number="INV-001", order_id=orders[0].id, customer_id=customer.id))
        db.add(models.Invoice(invoice_number="INV-002", order_id=orders[1].id, customer_id=customer.id))
        db.add(
            models.Waybill(
                waybill_number="WB-0001",
                order_id=orders[0].id,
                delivery_status="pending",
                created_by=user.id,
            )
        )
        db.commit()

        assert next_invoice_number(db) == "INV-003"
        assert next_waybill_number(db) == "WB-0002"
        db.query(models.Invoice).filter(models.Invoice.invoice_number == "INV-002").delete()
        db.query(models.Waybill).delete()
        db.commit()

        assert next_invoice_number(db) == "INV-004"
        assert next_waybill_number(db) == "WB-0003"
    finally:
        db.close()
        engine.dispose()


def test_pdf_token_get_does_not_write_quotation(client, admin_token, db_session):
    headers = {"Authorization": f"Bearer {admin_token}"}
    created = client.post("/quotations", json=_quote_payload("Pdf Read"), headers=headers)
    assert created.status_code == 200, created.text
    qid = created.json()["id"]
    before = db_session.query(models.Quotation).filter(models.Quotation.id == qid).one()
    updated_by = before.updated_by
    status = before.status

    token = create_pdf_render_token("quotation", qid)
    loaded = client.get(f"/quotations/{qid}", headers={"Authorization": f"Bearer {token}"})
    assert loaded.status_code == 200, loaded.text

    db_session.expire_all()
    after = db_session.query(models.Quotation).filter(models.Quotation.id == qid).one()
    assert after.status == status
    assert after.updated_by == updated_by
    assert after.updated_by != 0


def test_company_settings_read_does_not_commit_pending_changes(db_session):
    user = db_session.query(models.User).first()
    assert user is not None
    user.name = "pending-name-change"
    get_company_settings_row(db_session)
    user_id = user.id
    db_session.rollback()
    db_session.expire_all()
    again = db_session.query(models.User).filter(models.User.id == user_id).one()
    assert again.name != "pending-name-change"


def test_pdf_worker_serializes_renders_and_survives_failures():
    current = 0
    peak = 0
    lock = threading.Lock()

    def render_impl(url: str) -> bytes:
        nonlocal current, peak
        with lock:
            current += 1
            peak = max(peak, current)
        try:
            time.sleep(0.05)
            if url.endswith("/fail"):
                raise RuntimeError("render failed")
            return b"%PDF-1.4 test"
        finally:
            with lock:
                current -= 1

    worker = _PdfRenderWorker(render_impl=render_impl, queue_max=1)
    try:
        with ThreadPoolExecutor(max_workers=4) as pool:
            results = list(pool.map(lambda i: _capture(worker, f"http://pdf.local/doc/{i}"), range(4)))
        successes = [item for item in results if isinstance(item, bytes)]
        failures = [item for item in results if isinstance(item, RuntimeError)]
        assert successes
        assert all(item.startswith(b"%PDF-") for item in successes)
        assert peak == 1
        assert len(successes) + len(failures) == 4

        with pytest.raises(RuntimeError, match="render failed"):
            worker.render("http://pdf.local/doc/fail")
        assert worker.render("http://pdf.local/doc/after").startswith(b"%PDF-")
    finally:
        worker.shutdown()


def _capture(worker: _PdfRenderWorker, url: str):
    try:
        return worker.render(url)
    except RuntimeError as exc:
        return exc
