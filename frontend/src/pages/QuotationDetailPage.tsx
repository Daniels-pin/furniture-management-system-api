import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { quotationApi } from "../services/endpoints";
import { getErrorMessage } from "../services/api";
import { useToast } from "../state/toast";
import { useAuth } from "../state/auth";
import { Card } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { ConfirmModal } from "../components/ui/ConfirmModal";
import { ConvertToInvoiceModal } from "../components/ConvertToInvoiceModal";
import type { QuotationDetail } from "../types/api";
import { QuotationDocumentBody } from "../components/documents/QuotationDocumentBody";

export function QuotationDetailPage() {
  const { quotationId } = useParams();
  const id = Number(quotationId);
  const nav = useNavigate();
  const toast = useToast();
  const auth = useAuth();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<QuotationDetail | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [sending, setSending] = useState(false);
  const [acting, setActing] = useState(false);
  const [convertInvoiceOpen, setConvertInvoiceOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmTitle, setConfirmTitle] = useState("Confirm");
  const [confirmMessage, setConfirmMessage] = useState("");
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [confirmAction, setConfirmAction] = useState<null | (() => Promise<void>)>(null);

  async function refresh() {
    if (!Number.isFinite(id)) return;
    const res = await quotationApi.get(id);
    setData(res);
  }

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      setNotFound(false);
      try {
        if (!Number.isFinite(id)) throw new Error("bad id");
        const res = await quotationApi.get(id);
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

  const isReadOnly = auth.role === "finance";
  const canEdit = !isReadOnly && data && data.status !== "converted";
  const canFinalize = !isReadOnly && data?.status === "draft";
  const canConvert =
    !isReadOnly &&
    data &&
    data.status !== "converted" &&
    !data.converted_order_id &&
    !data.converted_proforma_id;
  const canPresalesDelete = !isReadOnly && (auth.role === "admin" || auth.role === "showroom") && data;
  const canDocActions = !isReadOnly && Boolean(data);

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-3 md:flex-row md:items-end print:hidden">
        <div>
          <div className="text-2xl font-bold tracking-tight">Quotation</div>
          <div className="mt-1 text-sm text-black/60">
            {loading ? "Loading…" : data ? `#${data.quote_number}` : notFound ? "Not found" : "—"}
          </div>
          {data?.created_by ? (
            <div className="mt-1 text-xs font-semibold text-black/50">Created by {data.created_by}</div>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => nav("/quotations")}>
            Back
          </Button>
          {canEdit ? (
            <Button variant="secondary" onClick={() => nav(`/quotations/${id}/edit`)}>
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
                  await quotationApi.finalize(id);
                  toast.push("success", "Quotation finalized.");
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
          {canDocActions ? (
            <Button
              variant="secondary"
              type="button"
              onClick={() => {
                void (async () => {
                  try {
                    if (Number.isFinite(id)) await quotationApi.recordPrint(id);
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
          {canDocActions ? (
            <Button
              variant="secondary"
              type="button"
              onClick={() => {
                void (async () => {
                  try {
                    setActing(true);
                    await quotationApi.download(id);
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
          {canDocActions ? (
            <Button
              variant="secondary"
              isLoading={sending}
              onClick={async () => {
                try {
                  setSending(true);
                  const res = await quotationApi.sendEmail(data.id);
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
            <Button
              variant="secondary"
              isLoading={acting}
              onClick={async () => {
                setConfirmTitle("Convert to proforma");
                setConfirmMessage("Create a proforma invoice from this quotation?");
                setConfirmAction(() => async () => {
                  setActing(true);
                  try {
                    const res = await quotationApi.convertToProforma(id);
                    toast.push("success", res.message || "Converted");
                    nav(`/proforma/${res.proforma_id}`);
                  } finally {
                    setActing(false);
                  }
                });
                setConfirmOpen(true);
              }}
            >
              Convert to proforma
            </Button>
          ) : null}
          {data && canConvert ? (
            <Button onClick={() => setConvertInvoiceOpen(true)}>Convert to invoice</Button>
          ) : null}
          {data?.converted_proforma_id ? (
            <Button variant="secondary" onClick={() => nav(`/proforma/${data.converted_proforma_id}`)}>
              View proforma
            </Button>
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
                    ? " Any linked order or proforma invoice stays in place; only this quotation record is removed from the active list."
                    : "";
                setConfirmTitle("Move to Trash");
                setConfirmMessage(`Move this quotation to Trash? You can restore it later from the Trash page.${extra}`);
                setConfirmAction(() => async () => {
                  setActing(true);
                  try {
                    await quotationApi.delete(id);
                    toast.push("success", "Quotation moved to Trash.");
                    nav("/quotations");
                  } finally {
                    setActing(false);
                  }
                });
                setConfirmOpen(true);
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
        documentLabel="quotation"
        grandTotal={data?.grand_total}
        isSubmitting={acting}
        onConfirm={async (amountPaid) => {
          try {
            setActing(true);
            const res = await quotationApi.convertToInvoice(id, { amount_paid: amountPaid });
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

      <ConfirmModal
        open={confirmOpen}
        title={confirmTitle}
        message={confirmMessage}
        busy={confirmBusy || acting}
        onClose={() => (confirmBusy || acting ? null : setConfirmOpen(false))}
        onConfirm={() => {
          const act = confirmAction;
          if (!act) return;
          setConfirmBusy(true);
          void act()
            .catch((e) => toast.push("error", getErrorMessage(e)))
            .finally(() => {
              setConfirmBusy(false);
              setConfirmOpen(false);
              setConfirmAction(null);
            });
        }}
      />

      {loading ? (
        <Card className="print:hidden">
          <div className="text-sm text-black/60">Loading…</div>
        </Card>
      ) : notFound || !data ? (
        <Card className="print:hidden">
          <div className="text-sm font-semibold">Quotation not found</div>
        </Card>
      ) : (
        <QuotationDocumentBody data={data} maskCustomer={auth.role === "factory"} />
      )}
    </div>
  );
}
