from __future__ import annotations

import os
import smtplib
from email.mime.application import MIMEApplication
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText


class EmailConfigError(RuntimeError):
    pass


def _getenv(key: str, default: str | None = None) -> str | None:
    v = os.getenv(key)
    if v is None:
        return default
    v = v.strip()
    return v if v != "" else default


def send_email(to_email: str, subject: str, html: str) -> None:
    host = _getenv("SMTP_HOST")
    port = int(_getenv("SMTP_PORT", "587") or "587")
    user = _getenv("SMTP_USER")
    password = _getenv("SMTP_PASSWORD")
    from_email = _getenv("SMTP_FROM", user)
    use_tls = (_getenv("SMTP_TLS", "true") or "true").lower() in {"1", "true", "yes", "on"}

    if not host or not from_email:
        raise EmailConfigError("SMTP is not configured")

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = from_email
    msg["To"] = to_email
    msg.attach(MIMEText(html, "html", "utf-8"))

    with smtplib.SMTP(host, port, timeout=20) as server:
        server.ehlo()
        if use_tls:
            server.starttls()
            server.ehlo()
        if user and password:
            server.login(user, password)
        server.sendmail(from_email, [to_email], msg.as_string())


def send_email_html_with_pdf_attachment(
    to_email: str,
    subject: str,
    html: str,
    pdf_bytes: bytes,
    pdf_filename: str,
) -> None:
    """Send multipart message: HTML body plus a single PDF attachment."""
    host = _getenv("SMTP_HOST")
    port = int(_getenv("SMTP_PORT", "587") or "587")
    user = _getenv("SMTP_USER")
    password = _getenv("SMTP_PASSWORD")
    from_email = _getenv("SMTP_FROM", user)
    use_tls = (_getenv("SMTP_TLS", "true") or "true").lower() in {"1", "true", "yes", "on"}

    if not host or not from_email:
        raise EmailConfigError("SMTP is not configured")

    msg = MIMEMultipart()
    msg["Subject"] = subject
    msg["From"] = from_email
    msg["To"] = to_email
    msg.attach(MIMEText(html, "html", "utf-8"))
    pdf_part = MIMEApplication(pdf_bytes, _subtype="pdf")
    pdf_part.add_header("Content-Disposition", "attachment", filename=pdf_filename)
    msg.attach(pdf_part)

    with smtplib.SMTP(host, port, timeout=20) as server:
        server.ehlo()
        if use_tls:
            server.starttls()
            server.ehlo()
        if user and password:
            server.login(user, password)
        server.sendmail(from_email, [to_email], msg.as_string())

