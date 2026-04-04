"""Render a URL with headless Chromium and return print-style PDF bytes (matches on-screen CSS)."""
from __future__ import annotations

import logging
import os

logger = logging.getLogger(__name__)


def render_url_to_pdf_bytes(url: str) -> bytes:
    try:
        from playwright.sync_api import sync_playwright
    except ImportError as e:
        raise RuntimeError("playwright is not installed") from e

    timeout_ms = int((os.getenv("PDF_RENDER_TIMEOUT_MS", "") or "120000").strip() or "120000")

    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=True,
            args=["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
        )
        try:
            context = browser.new_context(
                viewport={"width": 1280, "height": 900},
                device_scale_factor=2,
            )
            page = context.new_page()
            page.goto(url, wait_until="networkidle", timeout=timeout_ms)
            page.wait_for_selector('[data-pdf-ready="true"]', timeout=timeout_ms)
            pdf = page.pdf(
                format="A4",
                print_background=True,
                margin={"top": "10mm", "bottom": "10mm", "left": "10mm", "right": "10mm"},
            )
            context.close()
        finally:
            browser.close()

    if not pdf:
        raise RuntimeError("PDF generation produced empty output")
    return pdf


def build_pdf_export_page_url(frontend_base: str, doc_segment: str, doc_id: int, token: str) -> str:
    from urllib.parse import quote, urljoin

    base = frontend_base.rstrip("/") + "/"
    path = f"pdf-export/{doc_segment}/{doc_id}"
    full = urljoin(base, path)
    sep = "&" if "?" in full else "?"
    return f"{full}{sep}token={quote(token, safe='')}"
