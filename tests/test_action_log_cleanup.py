"""Tests for action_logs retention purge."""

from __future__ import annotations

from datetime import datetime, timedelta

from app import models
from app.utils.action_log_cleanup import purge_action_logs_older_than


def test_purge_action_logs_older_than_30_days(db_session):
    old = datetime.utcnow() - timedelta(days=90)
    db_session.add(
        models.ActionLog(
            action="old_event",
            entity_type="order",
            entity_id=1,
            created_at=old,
        )
    )
    db_session.add(
        models.ActionLog(
            action="recent_event",
            entity_type="order",
            entity_id=2,
            created_at=datetime.utcnow(),
        )
    )
    db_session.commit()

    removed = purge_action_logs_older_than(db_session)
    assert removed == 1
    assert db_session.query(models.ActionLog).count() == 1
    remaining = db_session.query(models.ActionLog).first()
    assert remaining is not None
    assert remaining.action == "recent_event"
