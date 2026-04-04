APP_NAME = "No Limits Furniture Nig Ltd"

COMPANY_EMAIL = "sales@nolimitsfurniture.com.ng"
COMPANY_PHONES = ("08064757611", "08069983816")
COMPANY_ADDRESSES = (
    "Plot 506 Obafemi Awolowo way Jabi District, FCT Abuja.",
    "99 Yingi Rayfield Road, Jos South, Plateau State.",
)


def company_contact_line_html(escape) -> str:
    """Phones and company email as one comma-separated HTML line (email as mailto link)."""
    esc_email = escape(COMPANY_EMAIL)
    parts = [escape(p) for p in COMPANY_PHONES]
    parts.append(
        f'<a href="mailto:{esc_email}" style="color:inherit;text-decoration:underline">{esc_email}</a>'
    )
    return ", ".join(parts)


COMPANY_BANK_ACCOUNT_NUMBER = "0077929221"
COMPANY_BANK_ACCOUNT_NAME = "No Limits Furniture Nig Ltd"
COMPANY_BANK_NAME = "Access Bank"


def company_payment_details_html(escape) -> str:
    """Standard payment / bank block for invoices, quotations, proforma, orders (HTML)."""
    return f"""<div style="margin-top:14px;padding-top:12px;border-top:1px solid #e5e5e5;font-size:13px;color:#333">
              <div style="font-weight:800;color:#111">Payment details</div>
              <div style="margin-top:6px;line-height:1.5">
                <div><span style="color:#666">Account Number:</span> <strong>{escape(COMPANY_BANK_ACCOUNT_NUMBER)}</strong></div>
                <div><span style="color:#666">Account Name:</span> <strong>{escape(COMPANY_BANK_ACCOUNT_NAME)}</strong></div>
                <div><span style="color:#666">Bank Name:</span> <strong>{escape(COMPANY_BANK_NAME)}</strong></div>
              </div>
            </div>"""

