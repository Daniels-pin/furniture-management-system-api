"""Finance sales-document create access and order image replace/remove/upload."""

from __future__ import annotations

import uuid

from app.utils.cloudinary import cloudinary_public_id_from_url


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _order_payload(phone: str | None = None) -> dict:
    return {
        "customer": {
            "name": "Finance Customer",
            "phone": phone or f"080{uuid.uuid4().hex[:8]}",
            "address": "Lagos",
        },
        "items": [
            {
                "item_name": "Chair",
                "description": "Walnut",
                "quantity": 1,
                "amount": "2500.00",
            }
        ],
        "due_date": "2026-04-10T00:00:00",
    }


def _presales_payload(name: str) -> dict:
    phone = f"081{uuid.uuid4().hex[:8]}"
    return {
        "customer_name": name,
        "phone": phone,
        "address": "Abuja",
        "items": [
            {
                "item_name": "Table",
                "description": "Oak dining",
                "quantity": 1,
                "amount": "1000.00",
            }
        ],
        "save_as_draft": False,
    }


def test_cloudinary_public_id_from_url():
    assert (
        cloudinary_public_id_from_url("https://res.cloudinary.com/demo/image/upload/v1234/abc.jpg")
        == "abc"
    )
    assert (
        cloudinary_public_id_from_url(
            "https://res.cloudinary.com/demo/image/upload/c_fill,w_400/v1234/folder/abc.jpg"
        )
        == "folder/abc"
    )
    assert cloudinary_public_id_from_url("https://example.com/photo.jpg") is None


def test_finance_can_create_order_quotation_proforma_and_customer(
    client, finance_token, factory_token, showroom_token
):
    headers = _auth(finance_token)

    order = client.post("/orders/json", json=_order_payload(), headers=headers)
    assert order.status_code == 200, order.text
    assert order.json().get("status") == "pending"

    quote = client.post("/quotations", json=_presales_payload("Finance Quote"), headers=headers)
    assert quote.status_code == 200, quote.text
    assert quote.json().get("quote_number")

    proforma = client.post("/proforma", json=_presales_payload("Finance Proforma"), headers=headers)
    assert proforma.status_code == 200, proforma.text
    assert proforma.json().get("proforma_number")

    customer = client.post(
        "/customers",
        json={"name": "Walk-in", "phone": f"070{uuid.uuid4().hex[:8]}", "address": "Ikeja"},
        headers=headers,
    )
    assert customer.status_code == 200, customer.text

    denied = client.post("/orders/json", json=_order_payload(), headers=_auth(factory_token))
    assert denied.status_code == 403

    still_ok = client.post("/orders/json", json=_order_payload(), headers=_auth(showroom_token))
    assert still_ok.status_code == 200, still_ok.text


def test_upload_replace_and_remove_order_images(client, admin_token, finance_token, monkeypatch):
    headers = _auth(admin_token)
    created = client.post("/orders/json", json=_order_payload(), headers=headers)
    assert created.status_code == 200, created.text
    order_id = created.json()["id"]
    detail = client.get(f"/orders/{order_id}", headers=headers)
    assert detail.status_code == 200, detail.text
    assert not detail.json().get("image_url")
    assert not detail.json().get("image_urls")

    urls = {"n": 0}
    destroyed: list[str] = []

    def fake_upload_images(files, folder=None):
        out = []
        for _f in files:
            urls["n"] += 1
            out.append(f"https://res.cloudinary.com/demo/image/upload/v1/order-{urls['n']}.jpg")
        return out

    monkeypatch.setattr("app.routes.orders.upload_images", fake_upload_images)
    monkeypatch.setattr("app.routes.orders.destroy_image_urls", lambda xs: destroyed.extend(xs or []))

    uploaded = client.post(
        f"/orders/{order_id}/images",
        files={"images": ("photo.jpg", b"fake-bytes", "image/jpeg")},
        data={"replace": "true"},
        headers=headers,
    )
    assert uploaded.status_code == 200, uploaded.text
    body = uploaded.json()
    first_url = "https://res.cloudinary.com/demo/image/upload/v1/order-1.jpg"
    assert body.get("image_url") == first_url
    assert body.get("image_urls") == [first_url]

    replaced = client.post(
        f"/orders/{order_id}/images",
        files={"images": ("photo2.jpg", b"fake-bytes-2", "image/jpeg")},
        data={"replace": "true"},
        headers=headers,
    )
    assert replaced.status_code == 200, replaced.text
    second_url = "https://res.cloudinary.com/demo/image/upload/v1/order-2.jpg"
    body2 = replaced.json()
    assert body2.get("image_url") == second_url
    assert body2.get("image_urls") == [second_url]
    assert first_url in destroyed
    assert first_url not in (body2.get("image_urls") or [])

    removed = client.delete(f"/orders/{order_id}/images", headers=headers)
    assert removed.status_code == 200, removed.text
    body3 = removed.json()
    assert not body3.get("image_url")
    assert not body3.get("image_urls")
    assert second_url in destroyed

    finance_denied = client.post(
        f"/orders/{order_id}/images",
        files={"images": ("photo3.jpg", b"x", "image/jpeg")},
        data={"replace": "true"},
        headers=_auth(finance_token),
    )
    assert finance_denied.status_code == 403
