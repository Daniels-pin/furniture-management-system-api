"""Resolve per-line unit amounts for display when DB values are missing."""

from decimal import Decimal
from typing import Any

TWOPLACES = Decimal("0.01")


def _qty(it: Any) -> int:
    return int(getattr(it, "quantity", 0) or 0)

def compute_subtotal(items: list[Any]) -> Decimal | None:
    """
    Compute subtotal as sum(quantity * amount) when every line has an amount.
    Returns None if any line is missing amount.
    """
    if not items:
        return None
    subtotal = Decimal("0")
    for it in items:
        raw = getattr(it, "amount", None)
        if raw is None or raw == "":
            return None
        try:
            unit = Decimal(str(raw)).quantize(TWOPLACES)
        except Exception:
            return None
        subtotal += unit * Decimal(_qty(it))
    return subtotal.quantize(TWOPLACES)

def display_unit_amounts(order: Any | None, items: list[Any]) -> list[Decimal | None]:
    """
    Prefer stored order_items.amount. If some or all are missing but order.total_price is set,
    infer missing unit prices so that (sum of qty * unit) matches total_price for the missing
    portion (same per-unit price across missing lines, weighted by quantity).
    """
    if not items:
        return []

    out: list[Decimal | None] = []
    for it in items:
        raw = getattr(it, "amount", None)
        if raw is not None:
            try:
                out.append(Decimal(str(raw)).quantize(TWOPLACES))
            except Exception:
                out.append(None)
        else:
            out.append(None)

    if order is None:
        return out

    tp = getattr(order, "total_price", None)
    if tp is None:
        return out

    try:
        total_price = Decimal(str(tp)).quantize(TWOPLACES)
    except Exception:
        return out

    n = len(items)
    if all(x is not None for x in out):
        return out

    known_sum = Decimal("0")
    for i in range(n):
        u = out[i]
        if u is not None:
            known_sum += u * Decimal(_qty(items[i]))

    missing_qty = sum(_qty(items[i]) for i in range(n) if out[i] is None)
    if missing_qty <= 0:
        return out

    remainder = total_price - known_sum
    if remainder < 0:
        return out

    per_unit = (remainder / Decimal(missing_qty)).quantize(TWOPLACES)
    for i in range(n):
        if out[i] is None:
            out[i] = per_unit
    return out
