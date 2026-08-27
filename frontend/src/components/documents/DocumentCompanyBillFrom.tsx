import { APP_NAME, COMPANY_CONTACT } from "../../config/app";

type Props = {
  rcNumber?: string | null;
};

export function DocumentCompanyBillFrom({ rcNumber }: Props) {
  const rc = rcNumber?.trim();

  return (
    <div className="min-w-0">
      <div className="font-bold text-black">Bill From:</div>
      <div className="mt-1.5 space-y-0.5 break-words leading-snug text-black/80">
        <div className="font-semibold text-black">{APP_NAME}</div>
        {rc ? <div>RC: {rc}</div> : null}
        {COMPANY_CONTACT.addresses.map((line) => (
          <div key={line}>{line}</div>
        ))}
        <div className="break-words">
          {COMPANY_CONTACT.phones.join(", ")},{" "}
          <a
            href={`mailto:${COMPANY_CONTACT.email}`}
            className="text-inherit underline decoration-black/40 underline-offset-2 print:text-black"
          >
            {COMPANY_CONTACT.email}
          </a>
        </div>
      </div>
    </div>
  );
}
