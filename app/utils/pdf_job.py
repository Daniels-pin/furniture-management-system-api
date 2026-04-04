"""Resolve frontend base URL and render document PDF via headless Chromium."""
from __future__ import annotations

import os
from urllib.parse import urlparse

from app.utils.browser_pdf import build_pdf_export_page_url, render_url_to_pdf_bytes
from app.utils.pdf_token import create_pdf_render_token


def _frontend_pdf_base() -> str:
    explicit = (os.getenv("FRONTEND_PDF_BASE_URL", "") or "").strip().rstrip("/")
    if explicit:
        return explicit
    origins = (os.getenv("FRONTEND_ORIGINS", "") or "").strip()
    if origins:
        first = origins.split(",")[0].strip().rstrip("/")
        if first:
            return first
    dev = (os.getenv("FRONTEND_DEV_URL", "") or "").strip().rstrip("/")
    if dev:
        return dev
    return "http://127.0.0.1:5173"


def document_pdf_bytes_via_ui(doc: str, segment: str, doc_id: int) -> bytes:
    """
    doc: pdf_token claim (invoice, quotation, proforma, waybill, order)
    segment: URL path segment under /pdf-export/
    """
    base = _frontend_pdf_base()
    if not base or not urlparse(base).scheme:
        raise RuntimeError(
            "Set FRONTEND_PDF_BASE_URL (or FRONTEND_ORIGINS) to the deployed SPA origin so the API can open "
            "the same document UI in headless Chromium. On Render, extend the build command with: "
            "playwright install chromium"
        )
    token = create_pdf_render_token(doc, doc_id)
    url = build_pdf_export_page_url(base, segment, doc_id, token)
    return render_url_to_pdf_bytes(url)
