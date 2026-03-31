from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from typing import Optional

from fastapi import HTTPException


MAX_TOTAL_PRICE = Decimal("500000000.00")
TWOPLACES = Decimal("0.01")


def _to_decimal(value: object, field_name: str) -> Optional[Decimal]:
    if value is None or value == "":
        return None
    if isinstance(value, Decimal):
        return value
    try:
        return Decimal(str(value))
    except (InvalidOperation, ValueError):
        raise HTTPException(status_code=400, detail=f"Invalid {field_name}")


def _q2(value: Decimal) -> Decimal:
    return value.quantize(TWOPLACES, rounding=ROUND_HALF_UP)


@dataclass(frozen=True)
class PricingResult:
    total_price: Optional[Decimal]
    amount_paid: Optional[Decimal]
    balance: Optional[Decimal]
    payment_status: str


def compute_pricing(total_price_in: object, amount_paid_in: object) -> PricingResult:
    """
    Validates monetary inputs and computes balance/payment_status.

    Rules:
    - total_price >= 0, <= 500,000,000
    - amount_paid >= 0
    - amount_paid <= total_price (when total_price is provided)
    - balance is computed only (never accepted from client)
    - payment_status rules per spec
    """
    total_price = _to_decimal(total_price_in, "total_price")
    amount_paid = _to_decimal(amount_paid_in, "amount_paid")

    if total_price is not None:
        total_price = _q2(total_price)
        if total_price < 0:
            raise HTTPException(status_code=400, detail="total_price must be >= 0")
        if total_price > MAX_TOTAL_PRICE:
            raise HTTPException(status_code=400, detail="Price exceeds allowed limit")

    if amount_paid is not None:
        amount_paid = _q2(amount_paid)
        if amount_paid < 0:
            raise HTTPException(status_code=400, detail="amount_paid must be >= 0")

    if total_price is not None and amount_paid is not None and amount_paid > total_price:
        raise HTTPException(status_code=400, detail="amount_paid must be <= total_price")

    # Compute balance
    balance = None
    if total_price is not None:
        balance = _q2(total_price - (amount_paid or Decimal("0")))

    # Compute payment_status
    if total_price is None:
        payment_status = "unpaid"
    else:
        paid = amount_paid or Decimal("0")
        if paid == 0:
            payment_status = "unpaid"
        elif paid < total_price:
            payment_status = "partial"
        else:
            payment_status = "paid"

    return PricingResult(
        total_price=total_price,
        amount_paid=amount_paid,
        balance=balance,
        payment_status=payment_status,
    )