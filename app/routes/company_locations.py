from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app import models
from app.auth.auth import require_role
from app.database import get_db
from app.schemas import CompanyLocationCreate, CompanyLocationOut, CompanyLocationUpdate

router = APIRouter(prefix="/company-locations", tags=["CompanyLocations"])


@router.get("", response_model=list[CompanyLocationOut])
def list_locations(
    db: Session = Depends(get_db),
    current_user=Depends(require_role(["admin", "factory"])),
    search: str = Query("", max_length=200),
):
    q = db.query(models.CompanyLocation)
    s = (search or "").strip()
    if s:
        q = q.filter(models.CompanyLocation.name.ilike(f"%{s}%"))
    rows = q.order_by(models.CompanyLocation.name.asc(), models.CompanyLocation.id.asc()).all()
    return [CompanyLocationOut.model_validate(r) for r in rows]


@router.post("", response_model=CompanyLocationOut)
def create_location(
    body: CompanyLocationCreate,
    db: Session = Depends(get_db),
    current_user=Depends(require_role(["admin"])),
):
    existing = db.query(models.CompanyLocation).filter(models.CompanyLocation.name == body.name).first()
    if existing:
        raise HTTPException(status_code=409, detail="A location with that name already exists.")
    row = models.CompanyLocation(
        name=body.name,
        latitude=float(body.latitude),
        longitude=float(body.longitude),
        allowed_radius_meters=int(body.allowed_radius_meters),
        created_at=datetime.utcnow(),
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return CompanyLocationOut.model_validate(row)


@router.patch("/{location_id}", response_model=CompanyLocationOut)
def update_location(
    location_id: int,
    body: CompanyLocationUpdate,
    db: Session = Depends(get_db),
    current_user=Depends(require_role(["admin"])),
):
    row = db.query(models.CompanyLocation).filter(models.CompanyLocation.id == location_id).first()
    if row is None:
        raise HTTPException(status_code=404, detail="Location not found")
    data = body.model_dump(exclude_unset=True)
    if "latitude" in data and data["latitude"] is not None:
        data["latitude"] = float(data["latitude"])
    if "longitude" in data and data["longitude"] is not None:
        data["longitude"] = float(data["longitude"])
    if "allowed_radius_meters" in data and data["allowed_radius_meters"] is not None:
        data["allowed_radius_meters"] = int(data["allowed_radius_meters"])
    if "name" in data and data["name"] is not None:
        taken = (
            db.query(models.CompanyLocation)
            .filter(models.CompanyLocation.name == data["name"], models.CompanyLocation.id != location_id)
            .first()
        )
        if taken:
            raise HTTPException(status_code=409, detail="A location with that name already exists.")
    for k, v in data.items():
        setattr(row, k, v)
    db.commit()
    db.refresh(row)
    return CompanyLocationOut.model_validate(row)


@router.delete("/{location_id}")
def delete_location(
    location_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(require_role(["admin"])),
):
    row = db.query(models.CompanyLocation).filter(models.CompanyLocation.id == location_id).first()
    if row is None:
        raise HTTPException(status_code=404, detail="Location not found")

    now = datetime.utcnow()
    affected = (
        db.query(models.Employee)
        .filter(models.Employee.work_location_id == location_id, models.Employee.deleted_at.is_(None))
        .all()
    )
    for emp in affected:
        emp.work_location_id = None
        emp.work_location_assigned_at = None
        emp.updated_at = now

    # Keep attendance rows and geo snapshots; drop location FK so history does not reference a deleted row.
    db.query(models.EmployeeAttendanceEntry).filter(
        models.EmployeeAttendanceEntry.work_location_id == location_id
    ).update({models.EmployeeAttendanceEntry.work_location_id: None}, synchronize_session=False)

    db.delete(row)
    db.commit()
    return {"message": "Location deleted", "employees_unassigned": len(affected)}

