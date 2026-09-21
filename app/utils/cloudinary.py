import logging
import os
import re

import cloudinary
import cloudinary.uploader
from fastapi import HTTPException, UploadFile

logger = logging.getLogger(__name__)

_CLOUDINARY_VERSION_RE = re.compile(r"^v\d+$")


def _configure_cloudinary() -> None:
    cloud_name = (os.getenv("CLOUD_NAME") or "").strip()
    api_key = (os.getenv("API_KEY") or "").strip()
    api_secret = (os.getenv("API_SECRET") or "").strip()

    if not cloud_name or not api_key or not api_secret:
        raise RuntimeError(
            "Cloudinary is not configured. Set CLOUD_NAME, API_KEY, and API_SECRET."
        )

    cloudinary.config(cloud_name=cloud_name, api_key=api_key, api_secret=api_secret)


def upload_image(file: UploadFile, *, folder: str | None = None) -> str:
    """
    Upload an image to Cloudinary and return the secure URL.
    """
    try:
        _configure_cloudinary()
    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=str(e))

    try:
        upload_kwargs: dict = {"resource_type": "image"}
        if folder:
            upload_kwargs["folder"] = folder
        result = cloudinary.uploader.upload(file.file, **upload_kwargs)
        secure_url = result.get("secure_url")
        if not secure_url:
            raise HTTPException(status_code=502, detail="Image upload failed")
        return secure_url
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=502, detail="Image upload failed")


def upload_images(files: list[UploadFile], *, folder: str | None = None) -> list[str]:
    """
    Upload multiple images to Cloudinary and return secure URLs in order.
    """
    if not files:
        return []
    urls: list[str] = []
    for f in files:
        urls.append(upload_image(f, folder=folder))
    return urls


def upload_asset(file: UploadFile, *, folder: str = "employees_docs") -> str:
    """
    Upload a generic file (PDF, image, etc.) and return the secure URL.
    """
    try:
        _configure_cloudinary()
    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=str(e))

    try:
        result = cloudinary.uploader.upload(
            file.file,
            folder=folder,
            resource_type="auto",
        )
        secure_url = result.get("secure_url")
        if not secure_url:
            raise HTTPException(status_code=502, detail="Upload failed")
        return secure_url
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=502, detail="Upload failed")


def cloudinary_public_id_from_url(url: str | None) -> str | None:
    """Extract a Cloudinary public_id from a secure URL, if possible."""
    u = (url or "").strip()
    if not u or "/upload/" not in u:
        return None
    path = u.split("?", 1)[0]
    after = path.split("/upload/", 1)[-1]
    segs = [s for s in after.split("/") if s]
    if not segs:
        return None
    # Optional transformation segment, e.g. c_fill,w_400
    if "," in segs[0]:
        segs = segs[1:]
    if segs and _CLOUDINARY_VERSION_RE.fullmatch(segs[0]):
        segs = segs[1:]
    if not segs:
        return None
    segs[-1] = segs[-1].rsplit(".", 1)[0]
    public_id = "/".join(segs).strip("/")
    return public_id or None


def destroy_image_urls(urls: list[str] | None) -> None:
    """
    Best-effort Cloudinary cleanup for URLs no longer referenced by an order.
    Failures are logged and ignored so order updates still succeed.
    """
    ids = []
    for url in urls or []:
        pid = cloudinary_public_id_from_url(url)
        if pid:
            ids.append(pid)
    if not ids:
        return
    try:
        _configure_cloudinary()
    except RuntimeError:
        return
    for public_id in ids:
        try:
            cloudinary.uploader.destroy(public_id, resource_type="image", invalidate=True)
        except Exception:
            logger.exception("Failed to destroy Cloudinary image %s", public_id)