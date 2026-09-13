from __future__ import annotations

import csv
import io
import json
from datetime import datetime, timedelta
from decimal import Decimal

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import ValidationError
from sqlalchemy import cast, func, or_, String
from sqlalchemy.orm import Session, joinedload

from app import models
from app.auth.auth import has_admin_privileges, normalize_role, require_role
from app.database import get_db
from app.schemas import (
    FieldVisitCreate,
    FieldVisitDetailOut,
    FieldVisitEmployeeOptionOut,
    FieldVisitListItemOut,
    FieldVisitOptionsOut,
    FieldVisitPageOut,
    FieldVisitSummaryOut,
    FieldVisitUpdate,
)
from app.utils.activity_log import (
    FIELD_VISIT_CREATED,
    FIELD_VISIT_DELETED,
    FIELD_VISIT_UPDATED,
    log_activity,
)
from app.utils.cloudinary import upload_images
from app.utils.field_visits import (
    BOQ_OPTIONS,
    FURNITURE_CATEGORIES,
    MAX_FIELD_VISIT_PHOTOS,
    PROJECT_STAGES,
    PROJECT_TYPES,
    VISIT_OUTCOMES,
    as_decimal,
    employee_display_name,
    google_maps_url,
    next_field_visit_number,
)
from app.utils.timezone import lagos_day_utc_bounds

router = APIRouter(prefix="/field-visits", tags=["Field Visits"])


def _field_visit_alive():
    return models.FieldVisit.deleted_at.is_(None)


def _can_access_field_visits(user) -> bool:
    role = normalize_role(getattr(user, "role", None))
    return role in ("admin", "root_admin", "showroom")


def _require_field_visit_access(user=Depends(require_role(["admin", "showroom"]))):
    return user


def _validate_create_payload(body: FieldVisitCreate) -> FieldVisitCreate:
    if body.project_type not in PROJECT_TYPES:
        raise HTTPException(status_code=422, detail="Invalid project type")
    if body.project_stage not in PROJECT_STAGES:
        raise HTTPException(status_code=422, detail="Invalid project stage")
    if body.boq_available not in BOQ_OPTIONS:
        raise HTTPException(status_code=422, detail="Invalid BOQ option")
    if body.visit_outcome not in VISIT_OUTCOMES:
        raise HTTPException(status_code=422, detail="Invalid visit outcome")
    if body.visit_outcome == "Other":
        if not (body.visit_outcome_other or "").strip():
            raise HTTPException(status_code=422, detail="Visit outcome details required when outcome is Other")
    else:
        body.visit_outcome_other = None
    invalid_furniture = [x for x in body.furniture_needed if x not in FURNITURE_CATEGORIES]
    if invalid_furniture:
        raise HTTPException(status_code=422, detail="Invalid furniture category")
    return body


def _parse_payload(raw: str, *, update: bool = False) -> FieldVisitCreate | FieldVisitUpdate:
    try:
        data = json.loads(raw or "{}")
    except json.JSONDecodeError as e:
        raise HTTPException(status_code=422, detail="Invalid JSON payload") from e
    try:
        model = FieldVisitUpdate if update else FieldVisitCreate
        body = model.model_validate(data)
    except ValidationError as e:
        raise HTTPException(status_code=422, detail=e.errors()) from e
    return _validate_create_payload(body)


def _list_item(row: models.FieldVisit) -> FieldVisitListItemOut:
    photos = row.photo_urls if isinstance(row.photo_urls, list) else []
    return FieldVisitListItemOut(
        id=row.id,
        visit_number=row.visit_number,
        visit_at=row.visit_at,
        employee_id=row.employee_id,
        employee_name=employee_display_name(row.employee),
        project_name=row.project_name,
        project_location=row.project_location,
        project_type=row.project_type,
        furniture_needed=row.furniture_needed if isinstance(row.furniture_needed, list) else [],
        estimated_opportunity_value=as_decimal(row.estimated_opportunity_value),
        visit_outcome=row.visit_outcome,
        photo_count=len([u for u in photos if u]),
    )


def _detail(row: models.FieldVisit, *, user) -> FieldVisitDetailOut:
    photos = row.photo_urls if isinstance(row.photo_urls, list) else []
    lat = row.latitude
    lng = row.longitude
    is_admin = has_admin_privileges(user)
    can_edit = is_admin or (row.employee_id == user.id and row.deleted_at is None)
    return FieldVisitDetailOut(
        id=row.id,
        visit_number=row.visit_number,
        visit_at=row.visit_at,
        employee_id=row.employee_id,
        employee_name=employee_display_name(row.employee),
        project_name=row.project_name,
        project_location=row.project_location,
        project_type=row.project_type,
        estimated_units=row.estimated_units,
        project_stage=row.project_stage,
        developer_owner=row.developer_owner,
        contractor=row.contractor,
        architect_designer=row.architect_designer,
        decision_maker=row.decision_maker,
        phone_number=row.phone_number,
        whatsapp_number=row.whatsapp_number,
        furniture_needed=row.furniture_needed if isinstance(row.furniture_needed, list) else [],
        boq_available=row.boq_available,
        estimated_opportunity_value=as_decimal(row.estimated_opportunity_value),
        existing_supplier=row.existing_supplier,
        visit_outcome=row.visit_outcome,
        visit_outcome_other=row.visit_outcome_other,
        notes=row.notes,
        photo_urls=[u for u in photos if u],
        latitude=lat,
        longitude=lng,
        google_maps_url=google_maps_url(lat, lng),
        gps_available=lat is not None and lng is not None,
        created_by_id=row.created_by_id,
        created_by_name=employee_display_name(row.created_by_user),
        created_at=row.created_at,
        updated_by_id=row.updated_by_id,
        updated_by_name=employee_display_name(row.updated_by_user),
        updated_at=row.updated_at,
        can_edit=can_edit,
    )


def _get_visit_or_404(db: Session, visit_id: int) -> models.FieldVisit:
    row = (
        db.query(models.FieldVisit)
        .options(
            joinedload(models.FieldVisit.employee),
            joinedload(models.FieldVisit.created_by_user),
            joinedload(models.FieldVisit.updated_by_user),
        )
        .filter(models.FieldVisit.id == visit_id, _field_visit_alive())
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="Field visit not found")
    return row


def _ensure_can_view(user, row: models.FieldVisit) -> None:
    if has_admin_privileges(user):
        return
    if normalize_role(getattr(user, "role", None)) == "showroom" and row.employee_id == user.id:
        return
    raise HTTPException(status_code=403, detail="Not authorized")


def _ensure_can_edit(user, row: models.FieldVisit) -> None:
    if has_admin_privileges(user):
        return
    if normalize_role(getattr(user, "role", None)) == "showroom" and row.employee_id == user.id:
        return
    raise HTTPException(status_code=403, detail="Not authorized")


def _apply_search_filters(
    q,
    *,
    search: str = "",
    employee_id: int | None = None,
    project_type: str = "",
    furniture_needed: str = "",
    date_from=None,
    date_to=None,
    location: str = "",
    visit_outcome: str = "",
):
    if employee_id is not None:
        q = q.filter(models.FieldVisit.employee_id == employee_id)
    pt = (project_type or "").strip()
    if pt:
        q = q.filter(models.FieldVisit.project_type == pt)
    loc = (location or "").strip()
    if loc:
        q = q.filter(models.FieldVisit.project_location.ilike(f"%{loc}%"))
    outcome = (visit_outcome or "").strip()
    if outcome:
        q = q.filter(models.FieldVisit.visit_outcome == outcome)
    furn = (furniture_needed or "").strip()
    if furn:
        q = q.filter(cast(models.FieldVisit.furniture_needed, String).ilike(f"%{furn}%"))
    if date_from is not None:
        start, _ = lagos_day_utc_bounds(date_from)
        q = q.filter(models.FieldVisit.visit_at >= start)
    if date_to is not None:
        _, end = lagos_day_utc_bounds(date_to)
        q = q.filter(models.FieldVisit.visit_at < end)
    s = (search or "").strip()
    if s:
        like = f"%{s}%"
        q = q.join(models.User, models.FieldVisit.employee_id == models.User.id, isouter=True).filter(
            or_(
                models.FieldVisit.visit_number.ilike(like),
                models.FieldVisit.project_name.ilike(like),
                models.FieldVisit.project_location.ilike(like),
                models.FieldVisit.decision_maker.ilike(like),
                models.FieldVisit.phone_number.ilike(like),
                cast(models.FieldVisit.furniture_needed, String).ilike(like),
                models.User.name.ilike(like),
                models.User.email.ilike(like),
            )
        )
    return q


@router.get("/options", response_model=FieldVisitOptionsOut)
def field_visit_options(user=Depends(_require_field_visit_access)):
    return FieldVisitOptionsOut(
        project_types=PROJECT_TYPES,
        project_stages=PROJECT_STAGES,
        furniture_categories=FURNITURE_CATEGORIES,
        visit_outcomes=VISIT_OUTCOMES,
        boq_options=BOQ_OPTIONS,
    )


@router.get("/employees", response_model=list[FieldVisitEmployeeOptionOut])
def list_showroom_employees(
    db: Session = Depends(get_db),
    user=Depends(require_role(["admin"])),
):
    rows = (
        db.query(models.User)
        .filter(models.User.role == "showroom", models.User.is_active.is_(True))
        .order_by(models.User.name.asc(), models.User.email.asc())
        .all()
    )
    return [
        FieldVisitEmployeeOptionOut(
            id=r.id,
            name=employee_display_name(r) or f"User #{r.id}",
        )
        for r in rows
    ]


@router.get("/summary", response_model=FieldVisitSummaryOut)
def field_visit_summary(
    db: Session = Depends(get_db),
    user=Depends(require_role(["admin"])),
):
    base = db.query(models.FieldVisit).filter(_field_visit_alive())
    total = int(base.with_entities(func.count(models.FieldVisit.id)).scalar() or 0)

    now = datetime.utcnow()
    week_start = now - timedelta(days=now.weekday())
    week_start = week_start.replace(hour=0, minute=0, second=0, microsecond=0)
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)

    visits_week = int(
        base.filter(models.FieldVisit.visit_at >= week_start)
        .with_entities(func.count(models.FieldVisit.id))
        .scalar()
        or 0
    )
    visits_month = int(
        base.filter(models.FieldVisit.visit_at >= month_start)
        .with_entities(func.count(models.FieldVisit.id))
        .scalar()
        or 0
    )
    pipeline = (
        db.query(func.coalesce(func.sum(models.FieldVisit.estimated_opportunity_value), 0))
        .filter(_field_visit_alive())
        .scalar()
        or 0
    )
    active_employees = int(
        db.query(func.count(func.distinct(models.FieldVisit.employee_id)))
        .filter(_field_visit_alive())
        .scalar()
        or 0
    )
    return FieldVisitSummaryOut(
        total_visits=total,
        visits_this_week=visits_week,
        visits_this_month=visits_month,
        estimated_pipeline_value=Decimal(str(pipeline)),
        active_showroom_employees=active_employees,
    )


@router.get("/page", response_model=FieldVisitPageOut)
def list_field_visits_page(
    db: Session = Depends(get_db),
    user=Depends(_require_field_visit_access),
    limit: int = Query(15, ge=1, le=100),
    offset: int = Query(0, ge=0),
    search: str = Query("", max_length=200),
    employee_id: int | None = Query(None),
    project_type: str = Query("", max_length=100),
    furniture_needed: str = Query("", max_length=100),
    date_from: str | None = Query(None),
    date_to: str | None = Query(None),
    location: str = Query("", max_length=200),
    visit_outcome: str = Query("", max_length=100),
):
    from datetime import date as date_cls

    parsed_from = None
    parsed_to = None
    if date_from:
        try:
            parsed_from = date_cls.fromisoformat(date_from)
        except ValueError as e:
            raise HTTPException(status_code=422, detail="Invalid date_from") from e
    if date_to:
        try:
            parsed_to = date_cls.fromisoformat(date_to)
        except ValueError as e:
            raise HTTPException(status_code=422, detail="Invalid date_to") from e

    if not has_admin_privileges(user):
        limit = min(limit, 15)

    q = (
        db.query(models.FieldVisit)
        .options(joinedload(models.FieldVisit.employee))
        .filter(_field_visit_alive())
    )
    if not has_admin_privileges(user):
        q = q.filter(models.FieldVisit.employee_id == user.id)
        employee_id = None

    q = _apply_search_filters(
        q,
        search=search,
        employee_id=employee_id,
        project_type=project_type,
        furniture_needed=furniture_needed,
        date_from=parsed_from,
        date_to=parsed_to,
        location=location,
        visit_outcome=visit_outcome,
    )
    total = int(q.with_entities(func.count(models.FieldVisit.id.distinct())).scalar() or 0)
    rows = (
        q.order_by(models.FieldVisit.visit_at.desc(), models.FieldVisit.id.desc())
        .offset(offset)
        .limit(limit)
        .all()
    )
    return FieldVisitPageOut(
        items=[_list_item(r) for r in rows],
        total=total,
        limit=limit,
        offset=offset,
    )


@router.get("/export/csv", response_class=StreamingResponse)
def export_field_visits_csv(
    db: Session = Depends(get_db),
    user=Depends(require_role(["admin"])),
    search: str = Query("", max_length=200),
    employee_id: int | None = Query(None),
    project_type: str = Query("", max_length=100),
    furniture_needed: str = Query("", max_length=100),
    date_from: str | None = Query(None),
    date_to: str | None = Query(None),
    location: str = Query("", max_length=200),
    visit_outcome: str = Query("", max_length=100),
):
    from datetime import date as date_cls

    parsed_from = None
    parsed_to = None
    if date_from:
        parsed_from = date_cls.fromisoformat(date_from)
    if date_to:
        parsed_to = date_cls.fromisoformat(date_to)

    q = (
        db.query(models.FieldVisit)
        .options(joinedload(models.FieldVisit.employee))
        .filter(_field_visit_alive())
    )
    q = _apply_search_filters(
        q,
        search=search,
        employee_id=employee_id,
        project_type=project_type,
        furniture_needed=furniture_needed,
        date_from=parsed_from,
        date_to=parsed_to,
        location=location,
        visit_outcome=visit_outcome,
    )
    rows = q.order_by(models.FieldVisit.visit_at.desc(), models.FieldVisit.id.desc()).all()

    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(
        [
            "FV Number",
            "Date",
            "Employee",
            "Project Name",
            "Project Type",
            "Location",
            "Developer",
            "Decision Maker",
            "Phone",
            "Furniture Needed",
            "Opportunity Value",
            "Visit Outcome",
        ]
    )
    for r in rows:
        furniture = ", ".join(r.furniture_needed) if isinstance(r.furniture_needed, list) else ""
        w.writerow(
            [
                r.visit_number,
                r.visit_at.date().isoformat() if r.visit_at else "",
                employee_display_name(r.employee) or "",
                r.project_name,
                r.project_type,
                r.project_location,
                r.developer_owner or "",
                r.decision_maker or "",
                r.phone_number,
                furniture,
                str(r.estimated_opportunity_value or ""),
                r.visit_outcome,
            ]
        )
    buf.seek(0)
    return StreamingResponse(
        iter(["\ufeff" + buf.getvalue()]),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": 'attachment; filename="field_visits.csv"'},
    )


@router.get("/{visit_id}", response_model=FieldVisitDetailOut)
def get_field_visit(
    visit_id: int,
    db: Session = Depends(get_db),
    user=Depends(_require_field_visit_access),
):
    row = _get_visit_or_404(db, visit_id)
    _ensure_can_view(user, row)
    return _detail(row, user=user)


@router.post("", response_model=FieldVisitDetailOut)
def create_field_visit(
    data_json: str = Form(...),
    images: list[UploadFile] | None = File(None),
    db: Session = Depends(get_db),
    user=Depends(require_role(["showroom", "admin"])),
):
    body = _parse_payload(data_json, update=False)
    uploaded: list[str] = []
    if images:
        if len(images) > MAX_FIELD_VISIT_PHOTOS:
            raise HTTPException(status_code=422, detail=f"Maximum {MAX_FIELD_VISIT_PHOTOS} photos allowed")
        uploaded = upload_images(images, folder="field_visits")
    existing = [u for u in (body.existing_photo_urls or []) if u]
    photo_urls = (existing + uploaded)[:MAX_FIELD_VISIT_PHOTOS]
    if len(existing) + len(uploaded) > MAX_FIELD_VISIT_PHOTOS:
        raise HTTPException(status_code=422, detail=f"Maximum {MAX_FIELD_VISIT_PHOTOS} photos allowed")

    now = datetime.utcnow()
    row = models.FieldVisit(
        visit_number=next_field_visit_number(db),
        visit_at=now,
        employee_id=user.id,
        project_name=body.project_name.strip(),
        project_location=body.project_location.strip(),
        project_type=body.project_type,
        estimated_units=(body.estimated_units or "").strip() or None,
        project_stage=body.project_stage,
        developer_owner=(body.developer_owner or "").strip() or None,
        contractor=(body.contractor or "").strip() or None,
        architect_designer=(body.architect_designer or "").strip() or None,
        decision_maker=(body.decision_maker or "").strip() or None,
        phone_number=body.phone_number.strip(),
        whatsapp_number=(body.whatsapp_number or "").strip() or None,
        furniture_needed=body.furniture_needed,
        boq_available=body.boq_available,
        estimated_opportunity_value=body.estimated_opportunity_value,
        existing_supplier=(body.existing_supplier or "").strip() or None,
        visit_outcome=body.visit_outcome,
        visit_outcome_other=(body.visit_outcome_other or "").strip() or None,
        notes=(body.notes or "").strip() or None,
        photo_urls=photo_urls or None,
        latitude=body.latitude,
        longitude=body.longitude,
        created_by_id=user.id,
        created_at=now,
    )
    db.add(row)
    db.flush()
    log_activity(
        db,
        action=FIELD_VISIT_CREATED,
        entity_type="field_visit",
        entity_id=row.id,
        actor_user=user,
        meta={"visit_number": row.visit_number, "project_name": row.project_name},
    )
    db.commit()
    db.refresh(row)
    row = _get_visit_or_404(db, row.id)
    return _detail(row, user=user)


@router.put("/{visit_id}", response_model=FieldVisitDetailOut)
def update_field_visit(
    visit_id: int,
    data_json: str = Form(...),
    images: list[UploadFile] | None = File(None),
    db: Session = Depends(get_db),
    user=Depends(_require_field_visit_access),
):
    row = _get_visit_or_404(db, visit_id)
    _ensure_can_edit(user, row)
    body = _parse_payload(data_json, update=True)

    uploaded: list[str] = []
    if images:
        uploaded = upload_images(images, folder="field_visits")
    existing = [u for u in (body.existing_photo_urls or []) if u]
    photo_urls = (existing + uploaded)[:MAX_FIELD_VISIT_PHOTOS]
    if len(existing) + len(uploaded) > MAX_FIELD_VISIT_PHOTOS:
        raise HTTPException(status_code=422, detail=f"Maximum {MAX_FIELD_VISIT_PHOTOS} photos allowed")

    now = datetime.utcnow()
    row.project_name = body.project_name.strip()
    row.project_location = body.project_location.strip()
    row.project_type = body.project_type
    row.estimated_units = (body.estimated_units or "").strip() or None
    row.project_stage = body.project_stage
    row.developer_owner = (body.developer_owner or "").strip() or None
    row.contractor = (body.contractor or "").strip() or None
    row.architect_designer = (body.architect_designer or "").strip() or None
    row.decision_maker = (body.decision_maker or "").strip() or None
    row.phone_number = body.phone_number.strip()
    row.whatsapp_number = (body.whatsapp_number or "").strip() or None
    row.furniture_needed = body.furniture_needed
    row.boq_available = body.boq_available
    row.estimated_opportunity_value = body.estimated_opportunity_value
    row.existing_supplier = (body.existing_supplier or "").strip() or None
    row.visit_outcome = body.visit_outcome
    row.visit_outcome_other = (body.visit_outcome_other or "").strip() or None
    row.notes = (body.notes or "").strip() or None
    row.photo_urls = photo_urls or None
    row.latitude = body.latitude
    row.longitude = body.longitude
    row.updated_by_id = user.id
    row.updated_at = now

    log_activity(
        db,
        action=FIELD_VISIT_UPDATED,
        entity_type="field_visit",
        entity_id=row.id,
        actor_user=user,
        meta={"visit_number": row.visit_number, "project_name": row.project_name},
    )
    db.commit()
    row = _get_visit_or_404(db, row.id)
    return _detail(row, user=user)


@router.delete("/{visit_id}")
def delete_field_visit(
    visit_id: int,
    db: Session = Depends(get_db),
    user=Depends(require_role(["admin"])),
):
    row = _get_visit_or_404(db, visit_id)
    now = datetime.utcnow()
    row.deleted_at = now
    row.deleted_by_id = user.id
    log_activity(
        db,
        action=FIELD_VISIT_DELETED,
        entity_type="field_visit",
        entity_id=row.id,
        actor_user=user,
        meta={"visit_number": row.visit_number, "project_name": row.project_name},
    )
    db.commit()
    return {"ok": True}
