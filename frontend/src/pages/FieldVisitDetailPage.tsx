import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { Modal } from "../components/ui/Modal";
import { ImageLightbox } from "../components/ui/ImageLightbox";
import { fieldVisitsApi } from "../services/endpoints";
import { getErrorMessage } from "../services/api";
import { useToast } from "../state/toast";
import { useAuth } from "../state/auth";
import { usePageHeader } from "../components/layout/pageHeader";
import type { FieldVisitDetail } from "../types/api";
import { formatLagosDateTime } from "../utils/datetime";
import { formatMoney } from "../utils/money";
import { cloudinaryThumbnail } from "../utils/cloudinary";

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-1 border-b border-black/5 py-3 sm:grid-cols-[220px_1fr]">
      <div className="text-xs font-semibold uppercase tracking-wide text-black/50">{label}</div>
      <div className="text-sm text-black/85">{value || "—"}</div>
    </div>
  );
}

export function FieldVisitDetailPage() {
  const { visitId } = useParams();
  const id = Number(visitId);
  const navigate = useNavigate();
  const toast = useToast();
  const auth = useAuth();

  const [loading, setLoading] = useState(true);
  const [row, setRow] = useState<FieldVisitDetail | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState(0);

  usePageHeader({
    title: row?.visit_number ?? "Field Visit",
    subtitle: row ? `${row.project_name} · ${formatLagosDateTime(row.visit_at)}` : "Loading visit details…"
  });

  useEffect(() => {
    if (!Number.isFinite(id)) return;
    let alive = true;
    setLoading(true);
    void fieldVisitsApi
      .get(id)
      .then((data) => {
        if (alive) setRow(data);
      })
      .catch((e) => toast.push("error", getErrorMessage(e)))
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [id, toast]);

  const images = useMemo(() => (row?.photo_urls ?? []).filter(Boolean), [row]);
  const canDelete = auth.isAdmin;

  async function confirmDelete() {
    if (!row) return;
    setDeleting(true);
    try {
      await fieldVisitsApi.delete(row.id);
      toast.push("success", "Field visit deleted.");
      navigate("/field-visits");
    } catch (e) {
      toast.push("error", getErrorMessage(e));
    } finally {
      setDeleting(false);
      setDeleteOpen(false);
    }
  }

  if (loading) return <div className="p-6 text-sm text-black/60">Loading…</div>;
  if (!row) return <div className="p-6 text-sm text-black/60">Field visit not found.</div>;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2 print:hidden">
        <Link to="/field-visits">
          <Button variant="secondary">Back to list</Button>
        </Link>
        {row.can_edit ? (
          <Link to={`/field-visits/${row.id}/edit`}>
            <Button variant="secondary">Edit</Button>
          </Link>
        ) : null}
        {canDelete ? (
          <Button variant="secondary" onClick={() => setDeleteOpen(true)}>
            Delete
          </Button>
        ) : null}
        <Button variant="secondary" onClick={() => window.print()}>
          Print
        </Button>
      </div>

      <div className="invoice-print-area space-y-6">
        <Card>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-2xl font-bold tracking-tight">{row.visit_number}</div>
              <div className="mt-1 text-sm text-black/60">{formatLagosDateTime(row.visit_at)}</div>
              <div className="mt-1 text-sm text-black/70">Submitted by {row.employee_name || "—"}</div>
            </div>
            <div className="rounded-2xl bg-black/[0.05] px-4 py-3 text-sm font-semibold">{row.visit_outcome}</div>
          </div>
        </Card>

        <Card>
          <div className="text-sm font-semibold text-black">Project Details</div>
          <div className="mt-2">
            <DetailRow label="Project Name" value={row.project_name} />
            <DetailRow label="Location" value={row.project_location} />
            <DetailRow label="Project Type" value={row.project_type} />
            <DetailRow label="Units / Size" value={row.estimated_units} />
            <DetailRow label="Stage" value={row.project_stage} />
          </div>
        </Card>

        <Card>
          <div className="text-sm font-semibold text-black">Contacts</div>
          <div className="mt-2">
            <DetailRow label="Developer / Owner" value={row.developer_owner} />
            <DetailRow label="Contractor" value={row.contractor} />
            <DetailRow label="Architect / Interior Designer" value={row.architect_designer} />
            <DetailRow label="Decision Maker" value={row.decision_maker} />
            <DetailRow label="Phone" value={row.phone_number} />
            <DetailRow label="WhatsApp" value={row.whatsapp_number} />
          </div>
        </Card>

        <Card>
          <div className="text-sm font-semibold text-black">Furniture Needed</div>
          <div className="mt-3 flex flex-wrap gap-2">
            {row.furniture_needed.map((item) => (
              <span key={item} className="rounded-full bg-black/[0.07] px-3 py-1 text-xs font-semibold">
                {item}
              </span>
            ))}
          </div>
        </Card>

        <Card>
          <div className="text-sm font-semibold text-black">Opportunity</div>
          <div className="mt-2">
            <DetailRow label="BOQ Available" value={row.boq_available} />
            <DetailRow label="Estimated Opportunity Value" value={row.estimated_opportunity_value != null ? formatMoney(row.estimated_opportunity_value) : "—"} />
            <DetailRow label="Existing Supplier / Competitor" value={row.existing_supplier} />
          </div>
        </Card>

        {row.visit_outcome === "Other" && row.visit_outcome_other ? (
          <Card>
            <div className="text-sm font-semibold text-black">Visit Outcome Details</div>
            <p className="mt-2 whitespace-pre-wrap text-sm text-black/80">{row.visit_outcome_other}</p>
          </Card>
        ) : null}

        {row.notes ? (
          <Card>
            <div className="text-sm font-semibold text-black">Notes</div>
            <p className="mt-2 whitespace-pre-wrap text-sm text-black/80">{row.notes}</p>
          </Card>
        ) : null}

        {images.length ? (
          <Card>
            <div className="text-sm font-semibold text-black">Photo Gallery</div>
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {images.map((url, idx) => (
                <button
                  key={`${url}-${idx}`}
                  type="button"
                  className="overflow-hidden rounded-2xl border border-black/10"
                  onClick={() => {
                    setLightboxIndex(idx);
                    setLightboxOpen(true);
                  }}
                >
                  <img src={cloudinaryThumbnail(url, { w: 480, h: 320 })} alt="" className="h-36 w-full object-cover" />
                </button>
              ))}
            </div>
          </Card>
        ) : null}

        <Card>
          <div className="text-sm font-semibold text-black">Location</div>
          <div className="mt-2">
            {row.gps_available && row.latitude != null && row.longitude != null ? (
              <>
                <DetailRow label="Latitude" value={row.latitude.toFixed(6)} />
                <DetailRow label="Longitude" value={row.longitude.toFixed(6)} />
                {row.google_maps_url ? (
                  <div className="pt-3">
                    <a href={row.google_maps_url} target="_blank" rel="noreferrer" className="text-sm font-semibold underline">
                      Open in Google Maps
                    </a>
                  </div>
                ) : null}
              </>
            ) : (
              <p className="text-sm text-amber-800">GPS location not available.</p>
            )}
          </div>
        </Card>

        <Card>
          <div className="text-xs text-black/50">
            Created {formatLagosDateTime(row.created_at)} by {row.created_by_name || "—"}
            {row.updated_at ? (
              <>
                {" "}
                · Last modified {formatLagosDateTime(row.updated_at)} by {row.updated_by_name || "—"}
              </>
            ) : null}
          </div>
        </Card>
      </div>

      <ImageLightbox
        open={lightboxOpen}
        title={row.visit_number}
        images={images}
        index={lightboxIndex}
        onIndexChange={setLightboxIndex}
        onClose={() => setLightboxOpen(false)}
      />

      <Modal
        open={deleteOpen}
        title="Delete field visit?"
        onClose={() => setDeleteOpen(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setDeleteOpen(false)}>
              Cancel
            </Button>
            <Button isLoading={deleting} onClick={() => void confirmDelete()}>
              Delete
            </Button>
          </>
        }
      >
        <p className="text-sm text-black/70">
          This will remove {row.visit_number} from active lists. The visit number will not be reused.
        </p>
      </Modal>
    </div>
  );
}
