from __future__ import annotations

from datetime import datetime, timedelta
from decimal import Decimal

from fastapi import APIRouter, Depends
from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload

from app import models
from app.auth.auth import get_current_user, normalize_role
from app.db.alive import customer_alive, order_alive
from app.database import get_db

router = APIRouter()


@router.get("/dashboard")
def get_dashboard(
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    # Core metrics (exclude soft-deleted rows)
    total_orders = db.query(func.count(models.Order.id)).filter(order_alive()).scalar() or 0
    total_customers = (
        db.query(func.count(models.Customer.id)).filter(customer_alive()).scalar() or 0
        if normalize_role(user.role) != "factory"
        else 0
    )

    pending_orders = (
        db.query(func.count(models.Order.id))
        .filter(order_alive())
        .filter(models.Order.status == "pending")
        .scalar()
        or 0
    )
    in_progress_orders = (
        db.query(func.count(models.Order.id))
        .filter(order_alive())
        .filter(models.Order.status == "in_progress")
        .scalar()
        or 0
    )
    completed_orders = (
        db.query(func.count(models.Order.id))
        .filter(order_alive())
        .filter(models.Order.status == "completed")
        .scalar()
        or 0
    )

    # Upcoming due orders (<= 14 days, not completed)
    today = datetime.utcnow()
    upcoming = today + timedelta(days=14)
    due_rows = (
        db.query(models.Order)
        .options(joinedload(models.Order.customer))
        .filter(order_alive())
        .filter(models.Order.due_date.isnot(None))
        .filter(models.Order.due_date <= upcoming)
        .filter(models.Order.status != "completed")
        .order_by(models.Order.due_date.asc())
        .limit(5)
        .all()
    )

    upcoming_due_orders = []
    for o in due_rows:
        upcoming_due_orders.append(
            {
                "order_id": o.id,
                "status": o.status,
                "due_date": o.due_date,
                "customer": None
                if user.role == "factory"
                else {"name": o.customer.name if o.customer else None},
            }
        )

    # Recent orders (last 5)
    recent_rows = (
        db.query(models.Order)
        .options(joinedload(models.Order.customer))
        .filter(order_alive())
        .order_by(models.Order.created_at.desc())
        .limit(5)
        .all()
    )
    recent_orders = []
    for o in recent_rows:
        recent_orders.append(
            {
                "order_id": o.id,
                "status": o.status,
                "due_date": o.due_date,
                "customer": None
                if user.role == "factory"
                else {"name": o.customer.name if o.customer else None},
            }
        )

    resp: dict = {
        "total_orders": total_orders,
        "total_customers": total_customers,
        "pending_orders": pending_orders,
        "in_progress_orders": in_progress_orders,
        "completed_orders": completed_orders,
        "upcoming_due_orders": upcoming_due_orders,
        "recent_orders": recent_orders,
    }

    # Admin-only financials
    if user.role == "admin":
        total_revenue = (
            db.query(
                func.coalesce(
                    func.sum(
                        func.coalesce(models.Order.final_price, models.Order.total_price)
                        + func.coalesce(models.Order.tax, 0)
                    ),
                    0,
                )
            )
            .filter(order_alive())
            .scalar()
        )
        amount_paid = (
            db.query(func.coalesce(func.sum(models.Order.amount_paid), 0)).filter(order_alive()).scalar()
        )
        outstanding_balance = (
            db.query(func.coalesce(func.sum(models.Order.balance), 0)).filter(order_alive()).scalar()
        )

        # Normalize to Decimal (some DB drivers may return Decimal already)
        resp.update(
            {
                "total_revenue": Decimal(str(total_revenue)),
                "amount_paid": Decimal(str(amount_paid)),
                "outstanding_balance": Decimal(str(outstanding_balance)),
            }
        )

    return resp

