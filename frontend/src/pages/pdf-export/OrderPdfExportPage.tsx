import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { OrderDocumentBody, type OrderDocumentData } from "../../components/documents/OrderDocumentBody";
import { createPdfExportClient } from "../../services/pdfExportClient";

export function OrderPdfExportPage() {
  const { orderId } = useParams();
  const [sp] = useSearchParams();
  const token = sp.get("token") || "";
  const id = Number(orderId);
  const [data, setData] = useState<OrderDocumentData | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!token || !Number.isFinite(id)) {
      setErr("Missing token or id");
      return;
    }
    const client = createPdfExportClient(token);
    client
      .get<OrderDocumentData>(`/orders/${id}`)
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
      {data ? <OrderDocumentBody data={data} maskCustomer={false} /> : null}
    </div>
  );
}
