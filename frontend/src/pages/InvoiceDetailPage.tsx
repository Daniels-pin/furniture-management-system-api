import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { invoicesApi } from "../services/endpoints";
import { getErrorMessage } from "../services/api";
import { useToast } from "../state/toast";
import { useAuth } from "../state/auth";
import { Card } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Modal } from "../components/ui/Modal";
import type { InvoiceDetail } from "../types/api";
import { InvoiceDocumentBody } from "../components/documents/InvoiceDocumentBody";

export function InvoiceDetailPage() {
  const { invoiceId } = useParams();
  const id = Number(invoiceId);
  const nav = useNavigate();
  const toast = useToast();
  const auth = useAuth();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<InvoiceDetail | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [sending, setSending] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const canDeleteInvoice = auth.role === "admin";
  const canDocActions = auth.role === "admin" || auth.role === "showroom";

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      setNotFound(false);
      try {
        if (!Number.isFinite(id)) throw new Error("bad id");
        const res = await invoicesApi.get(id);
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

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-3 md:flex-row md:items-end print:hidden">
        <div>
          <div className="text-2xl font-bold tracking-tight">Invoice</div>
          <div className="mt-1 text-sm text-black/60">
            {loading ? "Loading…" : data ? `#${data.invoice_number}` : notFound ? "Not found" : "—"}
          </div>
          {data?.created_by ? (
            <div className="mt-1 text-xs font-semibold text-black/50">Done by {data.created_by}</div>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => nav("/invoices")}>
            Back
          </Button>
          {canDocActions ? (
            <>
              <Button
                variant="secondary"
                type="button"
                onClick={() => {
                  void (async () => {
                    try {
                      if (Number.isFinite(id)) await invoicesApi.recordPrint(id);
                    } catch {
                      /* still print; logging is best-effort */
                    }
                    window.print();
                  })();
                }}
              >
                Print invoice
              </Button>
              {data ? (
                <Button
                  variant="secondary"
                  type="button"
                  isLoading={downloading}
                  onClick={async () => {
                    try {
                      setDownloading(true);
                      await invoicesApi.download(data.id);
                      toast.push("success", "Download started.");
                    } catch (e) {
                      toast.push("error", getErrorMessage(e));
                    } finally {
                      setDownloading(false);
                    }
                  }}
                >
                  Download PDF
                </Button>
              ) : null}
              {data ? (
                <Button
                  variant="secondary"
                  isLoading={sending}
                  onClick={async () => {
                    try {
                      setSending(true);
                      const res = await invoicesApi.sendEmail(data.id);
                      toast.push("success", res.message || "Invoice sent");
                    } catch (e) {
                      toast.push("error", getErrorMessage(e));
                    } finally {
                      setSending(false);
                    }
                  }}
                >
                  Send to Email
                </Button>
              ) : null}
            </>
          ) : null}
          {data ? (
            <Button variant="secondary" onClick={() => nav(`/orders/${data.order_id}`)}>
              View order
            </Button>
          ) : null}
          {data && canDeleteInvoice ? (
            <Button variant="danger" onClick={() => setConfirmDelete(true)}>
              Delete invoice
            </Button>
          ) : null}
        </div>
      </div>

      <Modal open={confirmDelete} title="Delete invoice?" onClose={() => setConfirmDelete(false)}>
        <div className="space-y-4">
          <div className="text-sm text-black/70">
            This removes only this invoice record. The linked order and its items stay in the system. This cannot be
            undone.
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setConfirmDelete(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              isLoading={deleting}
              onClick={async () => {
                if (!data) return;
                try {
                  setDeleting(true);
                  await invoicesApi.delete(data.id);
                  toast.push("success", "Invoice removed. Order was not deleted.");
                  setConfirmDelete(false);
                  nav(`/orders/${data.order_id}`);
                } catch (e) {
                  toast.push("error", getErrorMessage(e));
                } finally {
                  setDeleting(false);
                }
              }}
            >
              Delete
            </Button>
          </div>
        </div>
      </Modal>

      {loading ? (
        <Card className="print:hidden">
          <div className="text-sm text-black/60">Loading…</div>
        </Card>
      ) : notFound || !data ? (
        <Card className="print:hidden">
          <div className="text-sm font-semibold">Invoice not found</div>
        </Card>
      ) : (
        <InvoiceDocumentBody data={data} maskCustomer={auth.role === "factory"} />
      )}
    </div>
  );
}
