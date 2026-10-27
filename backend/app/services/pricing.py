"""Deal desking math. All amounts are integer cents."""
from __future__ import annotations

from typing import Any

DEFAULT_FEES = [
    {"label": "Documentation fee", "amount": 15000, "taxable": True},
    {"label": "Title & registration", "amount": 33500, "taxable": False},
    {"label": "Dealer prep & detailing", "amount": 29500, "taxable": True},
]


def calculate(
    *,
    vehicle_price: int,
    discount: int = 0,
    trade_in_value: int = 0,
    trade_in_payoff: int = 0,
    tax_rate: float,
    fees: list[dict[str, Any]],
    accessories: list[dict[str, Any]],
    deposit: int = 0,
    vehicle_cost: int | None = None,
) -> dict[str, int]:
    """Out-the-door calculation.

    Taxable base follows the common US "trade-in tax credit" rule:
      (price - discount + accessories + taxable fees - trade allowance)
    """
    accessories_total = sum(int(a.get("amount", 0)) for a in accessories)
    fees_total = sum(int(f.get("amount", 0)) for f in fees)
    taxable_fees = sum(int(f.get("amount", 0)) for f in fees if f.get("taxable"))
    selling_price = max(vehicle_price - discount, 0)
    taxable_base = max(selling_price + accessories_total + taxable_fees - trade_in_value, 0)
    tax_total = round(taxable_base * tax_rate)
    net_trade = trade_in_value - trade_in_payoff  # negative equity rolls into the deal
    subtotal = selling_price + accessories_total + fees_total
    total_otd = subtotal + tax_total - net_trade
    gross = (selling_price - vehicle_cost) + round(accessories_total * 0.45) if vehicle_cost is not None else 0
    return {
        "selling_price": selling_price,
        "accessories_total": accessories_total,
        "fees_total": fees_total,
        "taxable_base": taxable_base,
        "subtotal": subtotal,
        "tax_total": tax_total,
        "net_trade": net_trade,
        "total_otd": total_otd,
        "balance_due": total_otd - deposit,
        "gross_profit": gross,
    }
