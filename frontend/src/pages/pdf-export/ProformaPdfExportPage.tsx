import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { ProformaDocumentBody } from "../../components/documents/ProformaDocumentBody";
import { createPdfExportClient } from "../../services/pdfExportClient";
import type { ProformaDetail } from "../../types/api";

export function ProformaPdfExportPage() {
  const { proformaId } = useParams();
  const [sp] = useSearchParams();
  const token = sp.get("token") || "";
  const id = Number(proformaId);
  const [data, setData] = useState<ProformaDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!token || !Number.isFinite(id)) {
      setErr("Missing token or id");
      return;
    }
    const client = createPdfExportClient(token);
    client
      .get<ProformaDetail>(`/proforma/${id}`)
      .then((r) => setData(r.data))
      .catch(() => setErr("Failed to load document"));
  }, [id, token]);

  const ready = !!data && !err;

  return (
    <div
      className="min-h-screen bg-[#f5f5f5] p-6"
      {...(ready ? { "data-pdf-ready": "true" as const } : {})}
    >
      {err ? <p className="text-sm text-red-600">{err}</p> : null}
      {!err && !data ? <p className="text-sm text-black/60">Loading…</p> : null}
      {data ? <ProformaDocumentBody data={data} maskCustomer={false} /> : null}
    </div>
  );
}
