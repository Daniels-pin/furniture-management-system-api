"""Render a URL with headless Chromium and return print-style PDF bytes (matches on-screen CSS)."""
from __future__ import annotations

import logging
import os
from pathlib import Path
from urllib.parse import urlparse, urlunparse

logger = logging.getLogger(__name__)


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[2]


def _ensure_playwright_browsers_path() -> None:
    """
    On Render, browsers installed during build often live under the repo, while Playwright’s
    default cache path differs at runtime. Use a stable directory inside the project unless set.
    """
    if (os.getenv("PLAYWRIGHT_BROWSERS_PATH") or "").strip():
        return
    render = (os.getenv("RENDER") or "").strip().lower() in ("true", "1", "yes")
    if not render:
        return
    target = _repo_root() / ".playwright-browsers"
    os.environ["PLAYWRIGHT_BROWSERS_PATH"] = str(target)


def _url_for_logs(url: str) -> str:
    p = urlparse(url)
    return urlunparse((p.scheme, p.netloc, p.path, "", "", ""))


def render_url_to_pdf_bytes(url: str) -> bytes:
    _ensure_playwright_browsers_path()
    try:
        from playwright.sync_api import Error as PlaywrightError
        from playwright.sync_api import TimeoutError as PlaywrightTimeoutError
        from playwright.sync_api import sync_playwright
    except ImportError as e:
        raise RuntimeError("playwright is not installed") from e

    timeout_ms = int((os.getenv("PDF_RENDER_TIMEOUT_MS", "") or "120000").strip() or "120000")

    try:
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
                # "networkidle" often never fires on production SPAs (fonts, analytics, long-lived connections).
                # We still wait for the app-driven ready marker below.
                page.goto(url, wait_until="load", timeout=timeout_ms)
                page.wait_for_selector('[data-pdf-ready="true"]', timeout=timeout_ms)
                pdf = page.pdf(
                    format="A4",
                    print_background=True,
                    margin={"top": "10mm", "bottom": "10mm", "left": "10mm", "right": "10mm"},
                )
                context.close()
            finally:
                browser.close()
    except PlaywrightTimeoutError as e:
        logger.exception("PDF render timeout for %s", _url_for_logs(url))
        raise RuntimeError(
            "Timed out generating PDF. Check: (1) FRONTEND_PDF_BASE_URL is your live SPA origin, "
            "(2) the SPA build sets VITE_API_URL (or VITE_API_BASE_URL) to this API’s public URL so the "
            "pdf-export page can load invoice data, (3) FRONTEND_ORIGINS includes that SPA origin (CORS), "
            "(4) on Render, run `python -m playwright install chromium` in the build (not install-deps; it needs root)."
        ) from e
    except PlaywrightError as e:
        logger.exception("PDF render Playwright error for %s", _url_for_logs(url))
        msg = str(e)
        if "Executable doesn't exist" in msg or "BrowserType.launch" in msg:
            raise RuntimeError(
                "Chromium is missing or not where Playwright expects it. On Render: (1) Build command must run "
                "`pip install -r requirements.txt && bash scripts/playwright_render_install.sh` "
                "(installs Chromium under .playwright-browsers in the repo). "
                "(2) Clear build cache & redeploy. "
                "(3) Optional: set env PLAYWRIGHT_BROWSERS_PATH to an absolute path used in both build and runtime."
            ) from e
        raise RuntimeError(
            msg if len(msg) <= 400 else "PDF render failed (see server logs)."
        ) from e
    except Exception as e:
        logger.exception("PDF render failed for %s", _url_for_logs(url))
        raise RuntimeError("Could not generate PDF (see server logs).") from e

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
