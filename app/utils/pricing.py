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


@dataclass(frozen=True)
class DiscountResult:
    discount_type: Optional[str]
    discount_value: Optional[Decimal]
    discount_amount: Optional[Decimal]
    final_price: Optional[Decimal]


def compute_discount(total_price_in: object, discount_type_in: object, discount_value_in: object) -> DiscountResult:
    validated_total = compute_pricing(total_price_in, None).total_price
    if validated_total is None:
        return DiscountResult(None, None, None, None)

    dt_raw = (str(discount_type_in).strip() if discount_type_in is not None else "").lower()
    if dt_raw == "":
        return DiscountResult(None, None, Decimal("0.00"), validated_total)

    if dt_raw not in {"fixed", "percentage"}:
        raise HTTPException(status_code=400, detail="Invalid discount_type")

    dv = _to_decimal(discount_value_in, "discount_value")
    if dv is None:
        raise HTTPException(status_code=400, detail="discount_value is required")
    dv = _q2(dv)
    if dv < 0:
        raise HTTPException(status_code=400, detail="discount_value must be >= 0")

    if dt_raw == "percentage":
        if dv > Decimal("100.00"):
            raise HTTPException(status_code=400, detail="discount_value must be <= 100 for percentage")
        discount_amount = _q2(validated_total * (dv / Decimal("100")))
    else:
        discount_amount = dv

    final_price = _q2(validated_total - discount_amount)
    if final_price < 0:
        raise HTTPException(status_code=400, detail="final_price must be >= 0")

    return DiscountResult(dt_raw, dv, discount_amount, final_price)


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


def compute_pricing_with_discount(
    total_price_in: object,
    amount_paid_in: object,
    discount_type_in: object,
    discount_value_in: object,
) -> tuple[PricingResult, DiscountResult]:
    discount = compute_discount(total_price_in, discount_type_in, discount_value_in)
    pricing = compute_pricing(discount.final_price, amount_paid_in)
    return pricing, discount