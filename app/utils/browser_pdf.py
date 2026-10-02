"""Render a URL with headless Chromium and return print-style PDF bytes.

Playwright's sync API is bound to the thread that created it. FastAPI runs sync
endpoints on a pool of worker threads, so a browser stored on the process and
used from those threads raises greenlet errors and can kill the API worker.

All Chromium calls happen on one dedicated thread. Request threads only enqueue
a job and wait. A failed render is reported as an error; it does not tear down
the API process.
"""
from __future__ import annotations

import logging
import os
import queue
import re
import threading
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable
from urllib.parse import urlparse, urlunparse

logger = logging.getLogger(__name__)

_CHROMIUM_ARGS = [
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-dev-shm-usage",
    "--disable-gpu",
    "--disable-extensions",
    "--disable-background-networking",
    "--no-first-run",
    "--disable-default-apps",
    "--mute-audio",
]
_VIEWPORT = {"width": 1280, "height": 900}
_IMAGE_WAIT_MS = 8_000
_TOKEN_QUERY = re.compile(r"\?[^ \n\r\t]*")


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[2]


def _positive_int_env(name: str, default: int, *, upper: int) -> int:
    raw = (os.getenv(name, "") or "").strip() or str(default)
    try:
        value = int(raw)
    except ValueError:
        return default
    return max(1, min(value, upper))


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
    return _positive_int_env("PDF_RENDER_TIMEOUT_MS", 90_000, upper=180_000)


def _pdf_queue_max() -> int:
    return _positive_int_env("PDF_QUEUE_MAX", 2, upper=8)


def _pdf_idle_close_sec() -> float:
    return float(_positive_int_env("PDF_BROWSER_IDLE_SEC", 30, upper=600))


def _url_for_logs(url: str) -> str:
    p = urlparse(url)
    return urlunparse((p.scheme, p.netloc, p.path, "", "", ""))


def _redact(text: str) -> str:
    cleaned = _TOKEN_QUERY.sub("?[redacted]", text or "")
    return cleaned if len(cleaned) <= 400 else cleaned[:400] + "…"


@dataclass
class _PdfJob:
    url: str
    done: queue.Queue = field(default_factory=lambda: queue.Queue(maxsize=1))
    cancelled: threading.Event = field(default_factory=threading.Event)


class _PdfRenderWorker:
    """Owns the only Playwright sync client. Request threads never touch it."""

    def __init__(
        self,
        render_impl: Callable[[str], bytes] | None = None,
        *,
        queue_max: int | None = None,
    ) -> None:
        self._render_impl = render_impl
        self._queue: queue.Queue[_PdfJob] = queue.Queue(
            maxsize=queue_max if queue_max is not None else _pdf_queue_max()
        )
        self._thread: threading.Thread | None = None
        self._start_lock = threading.Lock()
        self._shutdown = threading.Event()
        self._playwright: Any = None
        self._playwright_manager: Any = None
        self._browser: Any = None
        self._last_used = time.monotonic()

    def render(self, url: str) -> bytes:
        self._ensure_thread()
        job = _PdfJob(url=url)
        try:
            self._queue.put_nowait(job)
        except queue.Full:
            logger.warning("pdf_render_rejected reason=queue_full")
            raise RuntimeError("PDF renderer is busy. Try again in a moment.") from None

        wait_s = (_pdf_render_timeout_ms() / 1000.0) + 5.0
        try:
            status, payload = job.done.get(timeout=wait_s)
        except queue.Empty:
            job.cancelled.set()
            logger.warning("pdf_render_timeout url=%s reason=worker_wait", _url_for_logs(url))
            raise RuntimeError("Timed out generating PDF.") from None
        if status != "ok":
            raise RuntimeError(str(payload))
        return payload

    def shutdown(self) -> None:
        """Ask the worker thread to close Chromium. Safe to call from any thread."""
        self._shutdown.set()
        thread = self._thread
        if thread is None:
            logger.info("pdf_cleanup_complete")
            return
        thread.join(timeout=20)
        if thread.is_alive():
            logger.error("pdf_worker_shutdown_timeout")
            return
        logger.info("pdf_cleanup_complete")

    def _ensure_thread(self) -> None:
        with self._start_lock:
            if self._thread is not None and self._thread.is_alive():
                return
            self._shutdown.clear()
            self._browser = None
            self._playwright = None
            self._playwright_manager = None
            self._thread = threading.Thread(target=self._loop, name="pdf-renderer", daemon=True)
            self._thread.start()
            logger.info("pdf_worker_started")

    def _loop(self) -> None:
        try:
            while not self._shutdown.is_set():
                try:
                    job = self._queue.get(timeout=0.5)
                except queue.Empty:
                    self._idle_close_browser()
                    continue
                try:
                    self._handle(job)
                except Exception:
                    logger.error("pdf_worker_job_crashed url=%s", _url_for_logs(job.url))
                    self._fail(job, "Could not generate PDF (see server logs).")
                    self._close_browser()
        except Exception:
            logger.error("pdf_worker_loop_crashed")
        finally:
            self._fail_queued("PDF renderer is shutting down.")
            self._close_browser()
            logger.info("pdf_worker_stopped")

    def _handle(self, job: _PdfJob) -> None:
        safe_url = _url_for_logs(job.url)
        if job.cancelled.is_set():
            logger.info("pdf_render_cancelled url=%s", safe_url)
            self._fail(job, "PDF render was cancelled.")
            return

        started = time.perf_counter()
        logger.info("pdf_render_start url=%s", safe_url)
        try:
            pdf = self._render_current(job.url)
            if not pdf or not pdf.startswith(b"%PDF-"):
                raise RuntimeError("PDF generation produced empty output")
            duration_ms = _elapsed_ms(started)
            logger.info(
                "pdf_render_complete url=%s duration_ms=%s bytes=%s",
                safe_url,
                duration_ms,
                len(pdf),
            )
            self._succeed(job, pdf)
        except Exception as exc:
            duration_ms = _elapsed_ms(started)
            reason = _failure_reason(exc)
            log = logger.warning if reason.endswith("timeout") or reason == "export_page_error" else logger.error
            log(
                "pdf_render_failed url=%s duration_ms=%s reason=%s error=%s",
                safe_url,
                duration_ms,
                reason,
                _redact(str(exc)),
            )
            if reason in {"playwright_error", "browser_crash", "unexpected"}:
                self._close_browser()
            self._fail(job, _public_error(exc))
        finally:
            self._last_used = time.monotonic()
            logger.info("pdf_render_cleanup url=%s duration_ms=%s", safe_url, _elapsed_ms(started))

    def _render_current(self, url: str) -> bytes:
        if self._render_impl is not None:
            return self._render_impl(url)
        return self._render_with_playwright(url)

    def _render_with_playwright(self, url: str) -> bytes:
        try:
            from playwright.sync_api import Error as PlaywrightError
            from playwright.sync_api import TimeoutError as PlaywrightTimeoutError
        except ImportError as exc:
            raise RuntimeError("playwright is not installed") from exc

        timeout_ms = _pdf_render_timeout_ms()
        scale = _pdf_device_scale_factor()
        context = None
        try:
            self._ensure_browser()
            assert self._browser is not None
            context = self._browser.new_context(viewport=_VIEWPORT, device_scale_factor=scale)
            page = context.new_page()
            page.goto(url, wait_until="load", timeout=timeout_ms)
            page.wait_for_selector(
                '[data-pdf-ready="true"], [data-pdf-error="true"]',
                timeout=timeout_ms,
            )
            if page.locator('[data-pdf-error="true"]').count() > 0:
                raise _ExportPageError("The document could not be loaded for PDF export.")
            try:
                page.wait_for_function(
                    "() => Array.from(document.images).every((img) => img.complete)",
                    timeout=min(_IMAGE_WAIT_MS, timeout_ms),
                )
            except PlaywrightTimeoutError:
                logger.info("pdf_render_images_pending url=%s", _url_for_logs(url))
            return page.pdf(
                format="A4",
                print_background=True,
                margin={"top": "10mm", "bottom": "10mm", "left": "10mm", "right": "10mm"},
            )
        except PlaywrightTimeoutError as exc:
            raise _RenderTimeout(
                "Timed out generating PDF. Check: (1) FRONTEND_PDF_BASE_URL is your live SPA origin, "
                "(2) the SPA build sets VITE_API_URL (or VITE_API_BASE_URL) to this API’s public URL so the "
                "pdf-export page can load invoice data, (3) FRONTEND_ORIGINS includes that SPA origin (CORS), "
                "(4) on Render, run `python -m playwright install chromium` in the build (not install-deps; it needs root)."
            ) from exc
        except PlaywrightError as exc:
            message = str(exc)
            if "Executable doesn't exist" in message or "BrowserType.launch" in message:
                raise _BrowserMissing(
                    "Chromium is missing or not where Playwright expects it. On Render: (1) Build command must run "
                    "`pip install -r requirements.txt && bash scripts/playwright_render_install.sh` "
                    "(installs Chromium under .playwright-browsers in the repo). "
                    "(2) Clear build cache & redeploy. "
                    "(3) Optional: set env PLAYWRIGHT_BROWSERS_PATH to an absolute path used in both build and runtime."
                ) from exc
            if "crash" in message.lower() or "Target closed" in message or "has been closed" in message:
                raise _BrowserCrash("PDF browser crashed while rendering.") from exc
            raise _PlaywrightFailure(
                message if len(message) <= 400 else "PDF render failed (see server logs)."
            ) from exc
        finally:
            if context is not None:
                try:
                    context.close()
                except Exception as exc:
                    logger.error("pdf_context_close_failed error=%s", _redact(str(exc)))

    def _ensure_browser(self) -> None:
        if self._browser_connected():
            return
        self._close_browser()
        _ensure_playwright_browsers_path()
        from playwright.sync_api import sync_playwright

        self._playwright_manager = sync_playwright()
        self._playwright = self._playwright_manager.__enter__()
        self._browser = self._playwright.chromium.launch(headless=True, args=_CHROMIUM_ARGS)
        logger.info("pdf_browser_started")

    def _browser_connected(self) -> bool:
        if self._browser is None:
            return False
        try:
            return bool(self._browser.is_connected())
        except Exception:
            return False

    def _close_browser(self) -> None:
        browser = self._browser
        self._browser = None
        pw_mgr = self._playwright_manager
        self._playwright_manager = None
        self._playwright = None
        if browser is not None:
            try:
                browser.close()
            except Exception as exc:
                logger.error("pdf_browser_close_failed error=%s", _redact(str(exc)))
        if pw_mgr is not None:
            try:
                pw_mgr.__exit__(None, None, None)
            except Exception as exc:
                logger.error("pdf_playwright_stop_failed error=%s", _redact(str(exc)))
        if browser is not None or pw_mgr is not None:
            logger.info("pdf_browser_closed")

    def _idle_close_browser(self) -> None:
        if self._browser is None:
            return
        if time.monotonic() - self._last_used < _pdf_idle_close_sec():
            return
        self._close_browser()
        logger.info("pdf_browser_idle_closed")

    def _succeed(self, job: _PdfJob, pdf: bytes) -> None:
        try:
            job.done.put_nowait(("ok", pdf))
        except queue.Full:
            pass

    def _fail(self, job: _PdfJob, message: str) -> None:
        try:
            job.done.put_nowait(("err", message))
        except queue.Full:
            pass

    def _fail_queued(self, message: str) -> None:
        while True:
            try:
                job = self._queue.get_nowait()
            except queue.Empty:
                return
            self._fail(job, message)


class _ExportPageError(RuntimeError):
    pass


class _RenderTimeout(RuntimeError):
    pass


class _BrowserMissing(RuntimeError):
    pass


class _BrowserCrash(RuntimeError):
    pass


class _PlaywrightFailure(RuntimeError):
    pass


def _elapsed_ms(started: float) -> int:
    return int((time.perf_counter() - started) * 1000)


def _failure_reason(exc: BaseException) -> str:
    if isinstance(exc, _ExportPageError):
        return "export_page_error"
    if isinstance(exc, _RenderTimeout):
        return "navigation_or_ready_timeout"
    if isinstance(exc, _BrowserCrash):
        return "browser_crash"
    if isinstance(exc, (_BrowserMissing, _PlaywrightFailure)):
        return "playwright_error"
    if isinstance(exc, TimeoutError):
        return "timeout"
    return "unexpected"


def _public_error(exc: BaseException) -> str:
    if isinstance(exc, RuntimeError) and str(exc):
        return _redact(str(exc))
    return "Could not generate PDF (see server logs)."


_pdf_renderer = _PdfRenderWorker()


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
