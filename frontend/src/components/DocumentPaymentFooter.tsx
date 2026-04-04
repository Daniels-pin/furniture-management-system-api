import { COMPANY_BANK } from "../config/app";

export function DocumentPaymentFooter() {
  return (
    <div className="mt-4 border-t border-black/10 pt-3 text-sm text-black/80 print:border-black">
      <div className="font-bold text-black">Payment details</div>
      <div className="mt-1.5 space-y-0.5">
        <div>
          <span className="text-black/60">Account Number:</span>{" "}
          <span className="font-semibold text-black">{COMPANY_BANK.accountNumber}</span>
        </div>
        <div>
          <span className="text-black/60">Account Name:</span>{" "}
          <span className="font-semibold text-black">{COMPANY_BANK.accountName}</span>
        </div>
        <div>
          <span className="text-black/60">Bank Name:</span>{" "}
          <span className="font-semibold text-black">{COMPANY_BANK.bankName}</span>
        </div>
      </div>
    </div>
  );
}
