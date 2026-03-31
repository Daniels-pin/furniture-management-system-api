import os

import cloudinary
import cloudinary.uploader
from fastapi import HTTPException, UploadFile


def _configure_cloudinary() -> None:
    cloud_name = (os.getenv("CLOUD_NAME") or "").strip()
    api_key = (os.getenv("API_KEY") or "").strip()
    api_secret = (os.getenv("API_SECRET") or "").strip()

    if not cloud_name or not api_key or not api_secret:
        raise RuntimeError(
            "Cloudinary is not configured. Set CLOUD_NAME, API_KEY, and API_SECRET."
        )

    cloudinary.config(cloud_name=cloud_name, api_key=api_key, api_secret=api_secret)


def upload_image(file: UploadFile) -> str:
    """
    Upload an image to Cloudinary and return the secure URL.
    """
    try:
        _configure_cloudinary()
    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=str(e))

    try:
        result = cloudinary.uploader.upload(file.file, resource_type="image")
        secure_url = result.get("secure_url")
        if not secure_url:
            raise HTTPException(status_code=502, detail="Image upload failed")
        return secure_url
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=502, detail="Image upload failed")