import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { proformaApi } from "../services/endpoints";
import { getErrorMessage } from "../services/api";
import { useToast } from "../state/toast";
import { useAuth } from "../state/auth";
import { Card } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { ConvertToInvoiceModal } from "../components/ConvertToInvoiceModal";
import type { ProformaDetail } from "../types/api";
import { ProformaDocumentBody } from "../components/documents/ProformaDocumentBody";

export function ProformaDetailPage() {
  const { proformaId } = useParams();
  const id = Number(proformaId);
  const nav = useNavigate();
  const toast = useToast();
  const auth = useAuth();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<ProformaDetail | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [sending, setSending] = useState(false);
  const [acting, setActing] = useState(false);
  const [convertInvoiceOpen, setConvertInvoiceOpen] = useState(false);

  async function refresh() {
    if (!Number.isFinite(id)) return;
    const res = await proformaApi.get(id);
    setData(res);
  }

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      setNotFound(false);
      try {
        if (!Number.isFinite(id)) throw new Error("bad id");
        const res = await proformaApi.get(id);
        if (!alive) return;
        setData(res);
      } catch (e: any) {
        if (!alive) return;
        if (e?.response?.status === 404) setNotFound(true);
        else toast.push("error", getErrorMessage(e));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [id, toast]);

  const canEdit = data && data.status !== "converted";
  const canFinalize = data?.status === "draft";
  const canConvert = data && data.status !== "converted" && !data.converted_order_id;
  const canPresalesDelete = (auth.role === "admin" || auth.role === "showroom") && data;

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-3 md:flex-row md:items-end print:hidden">
        <div>
          <div className="text-2xl font-bold tracking-tight">Proforma invoice</div>
          <div className="mt-1 text-sm text-black/60">
            {loading ? "Loading…" : data ? `#${data.proforma_number}` : notFound ? "Not found" : "—"}
          </div>
          {data?.created_by ? (
            <div className="mt-1 text-xs font-semibold text-black/50">Created by {data.created_by}</div>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => nav("/proforma")}>
            Back
          </Button>
          {canEdit ? (
            <Button variant="secondary" onClick={() => nav(`/proforma/${id}/edit`)}>
              Edit
            </Button>
          ) : null}
          {canFinalize ? (
            <Button
              variant="secondary"
              isLoading={acting}
              onClick={async () => {
                try {
                  setActing(true);
                  await proformaApi.finalize(id);
                  toast.push("success", "Proforma finalized.");
                  await refresh();
                } catch (e) {
                  toast.push("error", getErrorMessage(e));
                } finally {
                  setActing(false);
                }
              }}
            >
              Finalize
            </Button>
          ) : null}
          {data ? (
            <Button
              variant="secondary"
              type="button"
              onClick={() => {
                void (async () => {
                  try {
                    if (Number.isFinite(id)) await proformaApi.recordPrint(id);
                  } catch {
                    /* best-effort */
                  }
                  window.print();
                })();
              }}
            >
              Print
            </Button>
          ) : null}
          {data ? (
            <Button
              variant="secondary"
              type="button"
              onClick={() => {
                void (async () => {
                  try {
                    setActing(true);
                    await proformaApi.download(id);
                    toast.push("success", "Download started.");
                  } catch (e) {
                    toast.push("error", getErrorMessage(e));
                  } finally {
                    setActing(false);
                  }
                })();
              }}
            >
              Download
            </Button>
          ) : null}
          {data ? (
            <Button
              variant="secondary"
              isLoading={sending}
              onClick={async () => {
                try {
                  setSending(true);
                  const res = await proformaApi.sendEmail(data.id);
                  toast.push("success", res.message || "Sent");
                  await refresh();
                } catch (e) {
                  toast.push("error", getErrorMessage(e));
                } finally {
                  setSending(false);
                }
              }}
            >
              Send email
            </Button>
          ) : null}
          {data && canConvert ? (
            <Button onClick={() => setConvertInvoiceOpen(true)}>Convert to invoice</Button>
          ) : null}
          {data?.converted_order_id ? (
            <Button variant="secondary" onClick={() => nav(`/orders/${data.converted_order_id}`)}>
              View order
            </Button>
          ) : null}
          {canPresalesDelete ? (
            <Button
              variant="secondary"
              className="border-red-600 text-red-700 hover:bg-red-50"
              isLoading={acting}
              onClick={async () => {
                const extra =
                  data?.status === "converted"
                    ? " The converted order and invoice stay in place; only this proforma record is removed from the active list."
                    : "";
                if (!window.confirm(`Move this proforma to Trash? You can restore it later from the Trash page.${extra}`))
                  return;
                try {
                  setActing(true);
                  await proformaApi.delete(id);
                  toast.push("success", "Proforma moved to Trash.");
                  nav("/proforma");
                } catch (e) {
                  toast.push("error", getErrorMessage(e));
                } finally {
                  setActing(false);
                }
              }}
            >
              Delete
            </Button>
          ) : null}
        </div>
      </div>

      <ConvertToInvoiceModal
        open={convertInvoiceOpen}
        onClose={() => setConvertInvoiceOpen(false)}
        documentLabel="proforma invoice"
        grandTotal={data?.grand_total}
        isSubmitting={acting}
        onConfirm={async (amountPaid) => {
          try {
            setActing(true);
            const res = await proformaApi.convertToInvoice(id, { amount_paid: amountPaid });
            toast.push("success", res.message || "Converted");
            setConvertInvoiceOpen(false);
            nav(`/invoices/${res.invoice_id}`);
          } catch (e) {
            toast.push("error", getErrorMessage(e));
          } finally {
            setActing(false);
          }
        }}
      />

      {loading ? (
        <Card className="print:hidden">
          <div className="text-sm text-black/60">Loading…</div>
        </Card>
      ) : notFound || !data ? (
        <Card className="print:hidden">
          <div className="text-sm font-semibold">Proforma not found</div>
        </Card>
      ) : (
        <ProformaDocumentBody data={data} maskCustomer={auth.role === "factory"} />
      )}
    </div>
  );
}
