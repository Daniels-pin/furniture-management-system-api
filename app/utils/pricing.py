from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from typing import Optional

from fastapi import HTTPException


MAX_TOTAL_PRICE = Decimal("500000000.00")
TWOPLACES = Decimal("0.01")
FOURDP = Decimal("0.0001")


def _to_decimal(value: object, field_name: str) -> Optional[Decimal]:
    if value is None or value == "":
        return None
    if isinstance(value, Decimal):
        return value
    try:
        s0 = str(value).strip()
        if not s0:
            return None
        # Accept "1,000" but reject invalid comma placement like "10,00".
        if "," in s0:
            # Valid:
            # - 1000
            # - 1,000
            # - 1,000,000
            # - 1,000.50
            # - 1000.50
            import re

            if not re.fullmatch(r"\d{1,3}(?:,\d{3})*(?:\.\d+)?", s0):
                raise HTTPException(status_code=400, detail=f"Invalid {field_name}")
            s0 = s0.replace(",", "")
        return Decimal(s0)
    except (InvalidOperation, ValueError):
        raise HTTPException(status_code=400, detail=f"Invalid {field_name}")


def _q2(value: Decimal) -> Decimal:
    return value.quantize(TWOPLACES, rounding=ROUND_HALF_UP)


def _q_tax_percent(value: Decimal) -> Decimal:
    return value.quantize(FOURDP, rounding=ROUND_HALF_UP)


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


@dataclass(frozen=True)
class TotalsResult:
    subtotal: Optional[Decimal]
    discount_type: Optional[str]
    discount_value: Optional[Decimal]
    discount_amount: Optional[Decimal]
    after_discount: Optional[Decimal]
    tax: Optional[Decimal]  # monetary amount; None if no tax rate set
    tax_percent: Optional[Decimal]  # e.g. 7.5 for 7.5%; None if no tax
    total: Optional[Decimal]
    paid: Optional[Decimal]
    balance: Optional[Decimal]
    payment_status: str


def compute_totals(
    subtotal_in: object,
    paid_in: object,
    discount_type_in: object,
    discount_value_in: object,
    tax_percent_in: object,
) -> TotalsResult:
    """
    tax_percent_in: optional percentage (e.g. 7.5 = 7.5%), applied to the amount after discount
    (i.e. after_discount, which equals subtotal when there is no discount).
    """
    subtotal = compute_pricing(subtotal_in, None).total_price
    discount = compute_discount(subtotal, discount_type_in, discount_value_in)
    after_discount = discount.final_price

    tax_pct = _to_decimal(tax_percent_in, "tax")
    if tax_pct is not None:
        tax_pct = _q_tax_percent(tax_pct)
        if tax_pct < 0:
            raise HTTPException(status_code=400, detail="tax must be >= 0")
        if tax_pct > Decimal("100"):
            raise HTTPException(status_code=400, detail="tax must be <= 100")

    tax_amount: Optional[Decimal] = None
    total: Optional[Decimal] = None
    if after_discount is not None:
        if tax_pct is None:
            total = _q2(after_discount)
        else:
            tax_amount = _q2(after_discount * (tax_pct / Decimal("100")))
            total = _q2(after_discount + tax_amount)

    pricing = compute_pricing(total, paid_in)

    return TotalsResult(
        subtotal=subtotal,
        discount_type=discount.discount_type,
        discount_value=discount.discount_value,
        discount_amount=discount.discount_amount,
        after_discount=after_discount,
        tax=tax_amount,
        tax_percent=tax_pct,
        total=total,
        paid=pricing.amount_paid,
        balance=pricing.balance,
        payment_status=pricing.payment_status,
    )


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