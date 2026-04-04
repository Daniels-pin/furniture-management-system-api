"""Unit tests for pricing helpers (no DB)."""

from decimal import Decimal

from app.utils.pricing import compute_totals


def test_tax_percent_applied_after_discount():
    # subtotal 1000, 10% discount -> 900 base; 10% tax on 900 -> 90 tax; total 990
    r = compute_totals(Decimal("1000"), Decimal("0"), "percentage", Decimal("10"), Decimal("10"))
    assert r.subtotal == Decimal("1000.00")
    assert r.discount_amount == Decimal("100.00")
    assert r.after_discount == Decimal("900.00")
    assert r.tax_percent == Decimal("10")
    assert r.tax == Decimal("90.00")
    assert r.total == Decimal("990.00")


def test_tax_percent_no_discount():
    r = compute_totals(Decimal("200"), None, None, None, Decimal("7.5"))
    assert r.after_discount == Decimal("200.00")
    assert r.tax == Decimal("15.00")
    assert r.total == Decimal("215.00")


def test_no_tax_percent_means_zero_tax():
    r = compute_totals(Decimal("100"), None, None, None, None)
    assert r.tax is None
    assert r.tax_percent is None
    assert r.total == Decimal("100.00")
