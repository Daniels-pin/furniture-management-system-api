export const APP_NAME = "No Limits Furniture Nig Ltd";

/** Shown on invoices (Bill From) — keep in sync with `app/constants.py` */
export const COMPANY_CONTACT = {
  email: "sales@nolimitsfurniture.com.ng",
  phones: ["08064757611", "08069983816"],
  addresses: [
    "Plot 506 Obafemi Awolowo way Jabi District, FCT Abuja.",
    "99 Yingi Rayfield Road, Jos South, Plateau State."
  ]
} as const;

/** Payment instructions on invoices, quotations, proforma, orders — keep in sync with `app/constants.py` */
export const COMPANY_BANK = {
  accountNumber: "0077929221",
  accountName: "No Limits Furniture Nig Ltd",
  bankName: "Access Bank"
} as const;

