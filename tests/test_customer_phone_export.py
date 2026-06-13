"""Tests for Nigerian E.164 phone formatting in customer CSV export."""

from __future__ import annotations

import csv
from io import StringIO

import pytest

from app.utils.phone_format import format_nigerian_phone_e164, sanitize_phone_digits


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("08031234567", "+2348031234567"),
        ("07012345678", "+2347012345678"),
        ("09012345678", "+2349012345678"),
        ("2348031234567", "+2348031234567"),
        ("+2348031234567", "+2348031234567"),
        ("+2347012345678", "+2347012345678"),
    ],
)
def test_format_nigerian_phone_e164_valid_numbers(raw: str, expected: str) -> None:
    assert format_nigerian_phone_e164(raw) == expected


@pytest.mark.parametrize(
    "raw",
    [
        "0803 123 4567",
        "0701-234-5678",
        "(090) 1234-5678",
        "+234 803 123 4567",
        "234-803-123-4567",
        "  08031234567  ",
    ],
)
def test_format_nigerian_phone_e164_strips_formatting(raw: str) -> None:
    result = format_nigerian_phone_e164(raw)
    assert result is not None
    assert result.startswith("+234")
    assert result[1:].isdigit()


def test_sanitize_phone_digits_removes_non_digits() -> None:
    assert sanitize_phone_digits("(080) 3123-4567") == "08031234567"
    assert sanitize_phone_digits("+234 803 123 4567") == "2348031234567"


@pytest.mark.parametrize(
    "raw",
    [
        "",
        "   ",
        "abc",
        "12345",
        "0803123456",
        "080312345678",
        "12345678901",
        "+441234567890",
    ],
)
def test_format_nigerian_phone_e164_invalid_or_empty(raw: str) -> None:
    assert format_nigerian_phone_e164(raw) is None


def test_export_customer_phones_e164_format(client, admin_token, db_session) -> None:
    from app import models

    customers = [
        models.Customer(name="John Doe", phone="08031234567", address="Lagos"),
        models.Customer(name="Jane Doe", phone="07012345678", address="Abuja"),
        models.Customer(name="Peter Doe", phone="2348123456789", address="Port Harcourt"),
        models.Customer(name="Formatted", phone="+2349012345678", address="Kano"),
        models.Customer(name="Spaced", phone="0803 123 4567", address="Ibadan"),
        models.Customer(name="Invalid", phone="not-a-phone", address="Enugu"),
        models.Customer(name="Empty", phone="", address="Benin"),
        models.Customer(name="Duplicate raw", phone="08031234567", address="Owerri"),
        models.Customer(name="Duplicate e164", phone="+2348031234567", address="Calabar"),
    ]
    db_session.add_all(customers)
    db_session.commit()

    response = client.get(
        "/customers/export",
        params={"kind": "phones"},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert response.status_code == 200, response.text

    text = response.content.decode("utf-8-sig")
    rows = list(csv.reader(StringIO(text)))
    assert rows[0] == ["phone"]
    phones = [row[0] for row in rows[1:]]
    assert phones == [
        "+2348031234567",
        "+2347012345678",
        "+2348123456789",
        "+2349012345678",
    ]


def test_export_customer_phones_quoted_as_strings(client, admin_token, db_session) -> None:
    from app import models

    db_session.add(models.Customer(name="Quoted", phone="08031234567", address="Lagos"))
    db_session.commit()

    response = client.get(
        "/customers/export",
        params={"kind": "phones"},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert response.status_code == 200, response.text

    body = response.content.decode("utf-8-sig")
    assert '"+2348031234567"' in body


def test_export_customer_phones_requires_admin(client, showroom_token) -> None:
    response = client.get(
        "/customers/export",
        params={"kind": "phones"},
        headers={"Authorization": f"Bearer {showroom_token}"},
    )
    assert response.status_code == 403
