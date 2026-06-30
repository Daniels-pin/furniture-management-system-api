import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { PayrollExportDocument } from "../../components/employee/PayrollExportDocument";
import { createPdfExportClient } from "../../services/pdfExportClient";
import type { PayrollExport } from "../../types/api";

export function PayrollPdfExportPage() {
  const { periodId } = useParams();
  const [sp] = useSearchParams();
  const token = sp.get("token") || "";
  const id = Number(periodId);
  const [data, setData] = useState<PayrollExport | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!token || !Number.isFinite(id)) {
      setErr("Missing token or period id");
      return;
    }
    const client = createPdfExportClient(token);
    client
      .get<PayrollExport>(`/employees/periods/${id}/payroll-export`)
      .then((r) => setData(r.data))
      .catch(() => setErr("Failed to load payroll export"));
  }, [id, token]);

  const ready = !!data && !err;

  return (
    <div
      className="min-h-screen bg-[#f5f5f5]"
      {...(ready ? { "data-pdf-ready": "true" as const } : {})}
    >
      {err ? <p className="p-6 text-sm text-red-600">{err}</p> : null}
      {!err && !data ? <p className="p-6 text-sm text-black/60">Loading payroll export…</p> : null}
      {data ? <PayrollExportDocument data={data} /> : null}
    </div>
  );
}
