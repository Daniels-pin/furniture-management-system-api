"""Render HTML (same markup as document emails) to PDF bytes for attachments."""
from __future__ import annotations

import base64
import logging
import re
import urllib.request
from io import BytesIO

logger = logging.getLogger(__name__)

# Match <img ... src='http...' or src="http..." (attributes may omit space before src)
_IMG_SRC_RE = re.compile(
    r"""<img[^>]*src=(?P<q>['"])(?P<url>https?://[^'"]+)(?P=q)[^>]*>""",
    re.IGNORECASE | re.DOTALL,
)


def _embed_remote_images(html: str) -> str:
    """Inline remote logo/images as data URLs so PDF generation does not depend on network at render time."""

    def repl(m: re.Match[str]) -> str:
        url = m.group("url")
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=20) as resp:
                data = resp.read()
                ctype = resp.headers.get_content_type() or "image/png"
            b64 = base64.standard_b64encode(data).decode("ascii")
            return m.group(0).replace(f"{m.group('q')}{url}{m.group('q')}", f"{m.group('q')}data:{ctype};base64,{b64}{m.group('q')}")
        except Exception as e:
            logger.warning("PDF: skipped embedding image %s (%s)", url, e)
            return m.group(0)

    return _IMG_SRC_RE.sub(repl, html)


def html_to_pdf_bytes(html: str) -> bytes:
    from xhtml2pdf import pisa

    prepared = _embed_remote_images(html)
    out = BytesIO()
    status = pisa.CreatePDF(prepared, dest=out, encoding="utf-8")
    if status.err:
        raise RuntimeError("PDF generation failed")
    raw = out.getvalue()
    if not raw:
        raise RuntimeError("PDF generation produced empty output")
    return raw
