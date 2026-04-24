import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { waybillApi } from "../services/endpoints";
import { getErrorMessage } from "../services/api";
import { useToast } from "../state/toast";
import { useAuth } from "../state/auth";
import { Card } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/Input";
import type { WaybillDetail } from "../types/api";
import { WaybillDocumentBody } from "../components/documents/WaybillDocumentBody";

function waybillDriverComplete(d: WaybillDetail | null): boolean {
  if (!d) return false;
  return !!(
    String(d.driver_name || "").trim() &&
    String(d.driver_phone || "").trim() &&
    String(d.vehicle_plate || "").trim()
  );
}

export function WaybillDetailPage() {
  const { waybillId } = useParams();
  const id = Number(waybillId);
  const nav = useNavigate();
  const toast = useToast();
  const auth = useAuth();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<WaybillDetail | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [sending, setSending] = useState(false);
  const [acting, setActing] = useState(false);
  const [statusDraft, setStatusDraft] = useState<"pending" | "shipped" | "delivered">("pending");
  const [logisticsBusy, setLogisticsBusy] = useState(false);
  const [driverName, setDriverName] = useState("");
  const [driverPhone, setDriverPhone] = useState("");
  const [vehiclePlate, setVehiclePlate] = useState("");
  const viewLogged = useRef(false);

  useEffect(() => {
    if (!data) return;
    setDriverName(data.driver_name ?? "");
    setDriverPhone(data.driver_phone ?? "");
    setVehiclePlate(data.vehicle_plate ?? "");
  }, [data?.id, data?.driver_name, data?.driver_phone, data?.vehicle_plate]);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      setNotFound(false);
      try {
        if (!Number.isFinite(id)) throw new Error("bad id");
        const res = await waybillApi.get(id);
        if (!alive) return;
        setData(res);
        const s = (res.delivery_status || "pending").toLowerCase();
        if (s === "shipped" || s === "delivered" || s === "pending") setStatusDraft(s);
        if (!viewLogged.current) {
          viewLogged.current = true;
          void waybillApi.recordView(id).catch(() => {});
        }
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
  const canDelete = auth.role === "admin" && !isReadOnly;
  const canEdit = (auth.role === "admin" || auth.role === "showroom") && !isReadOnly;

  async function saveLogistics() {
    if (!Number.isFinite(id)) return;
    const dn = driverName.trim();
    const dp = driverPhone.trim();
    const vp = vehiclePlate.trim();
    if (!dn || !dp || !vp) {
      toast.push("error", "Driver name, driver phone, and vehicle plate are all required.");
      return;
    }
    setLogisticsBusy(true);
    try {
      const updated = await waybillApi.updateLogistics(id, {
        driver_name: dn,
        driver_phone: dp,
        vehicle_plate: vp
      });
      setData(updated);
      toast.push("success", "Logistics saved.");
    } catch (e) {
      toast.push("error", getErrorMessage(e));
    } finally {
      setLogisticsBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-3 md:flex-row md:items-end print:hidden">
        <div>
          <div className="text-2xl font-bold tracking-tight">Waybill</div>
          <div className="mt-1 text-sm text-black/60">
            {loading ? "Loading…" : data ? `#${data.waybill_number}` : notFound ? "Not found" : "—"}
          </div>
          {data?.created_by ? (
            <div className="mt-1 text-xs font-semibold text-black/50">Created by {data.created_by}</div>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => nav("/waybills")}>
            Back
          </Button>
          {data ? (
            <>
              {canEdit ? (
                <>
                  <label className="flex items-center gap-2 text-sm font-semibold text-black/70">
                    <span>Status</span>
                    <select
                      className="rounded-xl border border-black/15 bg-white px-2 py-2 text-sm font-semibold"
                      value={statusDraft}
                      onChange={(e) => setStatusDraft(e.target.value as typeof statusDraft)}
                    >
                      <option value="pending">Pending</option>
                      <option value="shipped">Shipped</option>
                      <option value="delivered">Delivered</option>
                    </select>
                  </label>
                  <Button
                    variant="secondary"
                    isLoading={acting}
                    onClick={async () => {
                      if (!data || statusDraft === (data.delivery_status || "").toLowerCase()) return;
                      try {
                        setActing(true);
                        const updated = await waybillApi.updateStatus(id, statusDraft);
                        setData(updated);
                        const s = (updated.delivery_status || "pending").toLowerCase();
                        if (s === "shipped" || s === "delivered" || s === "pending") setStatusDraft(s);
                        toast.push("success", "Status updated.");
                      } catch (e) {
                        toast.push("error", getErrorMessage(e));
                      } finally {
                        setActing(false);
                      }
                    }}
                  >
                    Save status
                  </Button>
                  <Button
                    variant="secondary"
                    type="button"
                    onClick={() => {
                      void (async () => {
                        if (!data || !waybillDriverComplete(data)) {
                          toast.push(
                            "error",
                            "Save driver name, phone, and vehicle plate on this waybill before printing."
                          );
                          return;
                        }
                        try {
                          if (Number.isFinite(id)) await waybillApi.recordPrint(id);
                        } catch (e) {
                          toast.push("error", getErrorMessage(e));
                          return;
                        }
                        window.print();
                      })();
                    }}
                  >
                    Print
                  </Button>
                  <Button
                    variant="secondary"
                    type="button"
                    isLoading={acting}
                    onClick={() => {
                      void (async () => {
                        if (!data || !waybillDriverComplete(data)) {
                          toast.push(
                            "error",
                            "Save driver name, phone, and vehicle plate on this waybill before downloading."
                          );
                          return;
                        }
                        try {
                          setActing(true);
                          await waybillApi.download(id);
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
                  <Button
                    variant="secondary"
                    isLoading={sending}
                    onClick={async () => {
                      if (!waybillDriverComplete(data)) {
                        toast.push(
                          "error",
                          "Save driver name, phone, and vehicle plate on this waybill before sending email."
                        );
                        return;
                      }
                      try {
                        setSending(true);
                        const res = await waybillApi.sendEmail(data.id);
                        toast.push("success", res.message || "Sent");
                      } catch (e) {
                        toast.push("error", getErrorMessage(e));
                      } finally {
                        setSending(false);
                      }
                    }}
                  >
                    Send email
                  </Button>
                </>
              ) : null}
              <Button variant="secondary" onClick={() => nav(`/orders/${data.order_id}`)}>
                View order
              </Button>
              {canDelete ? (
                <Button
                  variant="secondary"
                  className="border-red-600 text-red-700 hover:bg-red-50"
                  isLoading={acting}
                  onClick={async () => {
                    if (!window.confirm("Delete this waybill permanently?")) return;
                    try {
                      setActing(true);
                      await waybillApi.delete(id);
                      toast.push("success", "Waybill deleted.");
                      nav("/waybills");
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
            </>
          ) : null}
        </div>
      </div>

      {loading ? (
        <Card className="print:hidden">
          <div className="text-sm text-black/60">Loading…</div>
        </Card>
      ) : notFound || !data ? (
        <Card className="print:hidden">
          <div className="text-sm font-semibold">Waybill not found</div>
        </Card>
      ) : (
        <>
          {canEdit ? (
            <Card className="print:hidden">
            <div className="text-sm font-semibold">Driver &amp; vehicle</div>
            <div className="mt-1 text-xs text-black/60">
              Required before print, download, or email. You can update these any time.
            </div>
            <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
              <Input label="Driver name" value={driverName} onChange={(e) => setDriverName(e.target.value)} />
              <Input label="Driver phone" value={driverPhone} onChange={(e) => setDriverPhone(e.target.value)} />
              <Input label="Vehicle plate" value={vehiclePlate} onChange={(e) => setVehiclePlate(e.target.value)} />
            </div>
            <div className="mt-4 flex justify-end">
              <Button variant="secondary" isLoading={logisticsBusy} onClick={() => void saveLogistics()}>
                Save logistics
              </Button>
            </div>
            </Card>
          ) : null}

        <WaybillDocumentBody data={data} />
        </>
      )}
    </div>
  );
}
