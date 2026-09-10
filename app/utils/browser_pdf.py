"""Render a URL with headless Chromium and return print-style PDF bytes (matches on-screen CSS).

Memory-conscious on small hosts (e.g. Render 512 MB):
- One Chromium instance reused across requests (#5).
- Only one PDF render at a time (#4).
- Default device_scale_factor=1 (#6).
"""
from __future__ import annotations

import logging
import os
import threading
from pathlib import Path
from typing import Any
from urllib.parse import urlparse, urlunparse

logger = logging.getLogger(__name__)

_CHROMIUM_ARGS = ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"]
_VIEWPORT = {"width": 1280, "height": 900}


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


def _pdf_device_scale_factor() -> float:
    raw = (os.getenv("PDF_DEVICE_SCALE_FACTOR", "") or "1").strip() or "1"
    try:
        value = float(raw)
    except ValueError:
        return 1.0
    return max(1.0, min(value, 2.0))


def _pdf_render_timeout_ms() -> int:
    return int((os.getenv("PDF_RENDER_TIMEOUT_MS", "") or "120000").strip() or "120000")


def _url_for_logs(url: str) -> str:
    p = urlparse(url)
    return urlunparse((p.scheme, p.netloc, p.path, "", "", ""))


class _PdfBrowserRenderer:
    """Single shared Chromium; serializes renders to limit peak RAM."""

    __slots__ = ("_lock", "_playwright", "_playwright_manager", "_browser")

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._playwright: Any = None
        self._playwright_manager: Any = None
        self._browser: Any = None

    def shutdown(self) -> None:
        with self._lock:
            self._close_unlocked()

    def _close_unlocked(self) -> None:
        browser = self._browser
        self._browser = None
        pw_mgr = self._playwright_manager
        self._playwright_manager = None
        self._playwright = None
        if browser is not None:
            try:
                browser.close()
            except Exception:
                logger.exception("Error closing PDF Chromium browser")
        if pw_mgr is not None:
            try:
                pw_mgr.__exit__(None, None, None)
            except Exception:
                logger.exception("Error stopping Playwright for PDF rendering")

    def _browser_connected(self) -> bool:
        if self._browser is None:
            return False
        try:
            return bool(self._browser.is_connected())
        except Exception:
            return False

    def _ensure_browser_unlocked(self) -> None:
        if self._browser_connected():
            return
        self._close_unlocked()
        _ensure_playwright_browsers_path()
        from playwright.sync_api import sync_playwright

        self._playwright_manager = sync_playwright()
        self._playwright = self._playwright_manager.__enter__()
        self._browser = self._playwright.chromium.launch(
            headless=True,
            args=_CHROMIUM_ARGS,
        )
        logger.info("PDF Chromium browser started (reused across requests)")

    def render(self, url: str) -> bytes:
        with self._lock:
            return self._render_locked(url)

    def _render_locked(self, url: str) -> bytes:
        try:
            from playwright.sync_api import Error as PlaywrightError
            from playwright.sync_api import TimeoutError as PlaywrightTimeoutError
        except ImportError as e:
            raise RuntimeError("playwright is not installed") from e

        timeout_ms = _pdf_render_timeout_ms()
        scale = _pdf_device_scale_factor()

        try:
            self._ensure_browser_unlocked()
            assert self._browser is not None
            context = self._browser.new_context(
                viewport=_VIEWPORT,
                device_scale_factor=scale,
            )
            try:
                page = context.new_page()
                # "networkidle" often never fires on production SPAs (fonts, analytics, long-lived connections).
                # We still wait for the app-driven ready marker below.
                page.goto(url, wait_until="load", timeout=timeout_ms)
                page.wait_for_selector('[data-pdf-ready="true"]', timeout=timeout_ms)
                # Logos often load after React paint; PDF used to capture before decode finished.
                page.wait_for_function(
                    "() => Array.from(document.images).every((img) => img.complete)",
                    timeout=timeout_ms,
                )
                pdf = page.pdf(
                    format="A4",
                    print_background=True,
                    margin={"top": "10mm", "bottom": "10mm", "left": "10mm", "right": "10mm"},
                )
            finally:
                context.close()
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
            self._close_unlocked()
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
            self._close_unlocked()
            raise RuntimeError("Could not generate PDF (see server logs).") from e

        if not pdf:
            raise RuntimeError("PDF generation produced empty output")
        return pdf


_pdf_renderer = _PdfBrowserRenderer()


def render_url_to_pdf_bytes(url: str) -> bytes:
    return _pdf_renderer.render(url)


def shutdown_pdf_browser() -> None:
    """Close the shared Chromium instance (call on app shutdown)."""
    _pdf_renderer.shutdown()


def build_pdf_export_page_url(frontend_base: str, doc_segment: str, doc_id: int, token: str) -> str:
    from urllib.parse import quote, urljoin

    base = frontend_base.rstrip("/") + "/"
    path = f"pdf-export/{doc_segment}/{doc_id}"
    full = urljoin(base, path)
    sep = "&" if "?" in full else "?"
    return f"{full}{sep}token={quote(token, safe='')}"
