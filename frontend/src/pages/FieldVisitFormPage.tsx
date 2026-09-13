import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { Input } from "../components/ui/Input";
import { fieldVisitsApi } from "../services/endpoints";
import { getErrorMessage } from "../services/api";
import { useToast } from "../state/toast";
import { usePageHeader } from "../components/layout/pageHeader";
import type { FieldVisitDetail, FieldVisitOptions } from "../types/api";
import { compressImageFile } from "../utils/imageCompress";
import { isValidThousandsCommaNumber, parseMoneyInput } from "../utils/moneyInput";

const MAX_PHOTOS = 10;

type LocalPhoto = {
  key: string;
  previewUrl: string;
  file?: File;
  remoteUrl?: string;
};

export function FieldVisitFormPage() {
  const { visitId } = useParams();
  const editingId = visitId ? Number(visitId) : null;
  const isEdit = Number.isFinite(editingId);
  const navigate = useNavigate();
  const toast = useToast();

  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);
  const [options, setOptions] = useState<FieldVisitOptions | null>(null);

  const [projectName, setProjectName] = useState("");
  const [projectLocation, setProjectLocation] = useState("");
  const [projectType, setProjectType] = useState("");
  const [estimatedUnits, setEstimatedUnits] = useState("");
  const [projectStage, setProjectStage] = useState("");
  const [developerOwner, setDeveloperOwner] = useState("");
  const [contractor, setContractor] = useState("");
  const [architectDesigner, setArchitectDesigner] = useState("");
  const [decisionMaker, setDecisionMaker] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [whatsappNumber, setWhatsappNumber] = useState("");
  const [furnitureNeeded, setFurnitureNeeded] = useState<string[]>([]);
  const [furnitureSearch, setFurnitureSearch] = useState("");
  const [furnitureError, setFurnitureError] = useState("");
  const [boqAvailable, setBoqAvailable] = useState("No");
  const [opportunityValue, setOpportunityValue] = useState("");
  const [existingSupplier, setExistingSupplier] = useState("");
  const [visitOutcome, setVisitOutcome] = useState("");
  const [visitOutcomeOther, setVisitOutcomeOther] = useState("");
  const [notes, setNotes] = useState("");
  const [latitude, setLatitude] = useState<number | null>(null);
  const [longitude, setLongitude] = useState<number | null>(null);
  const [gpsStatus, setGpsStatus] = useState<"pending" | "ok" | "denied">("pending");
  const [photos, setPhotos] = useState<LocalPhoto[]>([]);

  usePageHeader({
    title: isEdit ? "Edit Field Visit" : "New Field Visit",
    subtitle: isEdit ? "Update visit details and photos." : "Capture project, contact, and opportunity information from the site."
  });

  useEffect(() => {
    void fieldVisitsApi.options().then(setOptions).catch((e) => toast.push("error", getErrorMessage(e)));
  }, [toast]);

  useEffect(() => {
    if (!isEdit || !editingId) return;
    let alive = true;
    setLoading(true);
    void fieldVisitsApi
      .get(editingId)
      .then((row: FieldVisitDetail) => {
        if (!alive) return;
        if (!row.can_edit) {
          toast.push("error", "You cannot edit this visit.");
          navigate(`/field-visits/${row.id}`);
          return;
        }
        setProjectName(row.project_name);
        setProjectLocation(row.project_location);
        setProjectType(row.project_type);
        setEstimatedUnits(row.estimated_units ?? "");
        setProjectStage(row.project_stage);
        setDeveloperOwner(row.developer_owner ?? "");
        setContractor(row.contractor ?? "");
        setArchitectDesigner(row.architect_designer ?? "");
        setDecisionMaker(row.decision_maker ?? "");
        setPhoneNumber(row.phone_number);
        setWhatsappNumber(row.whatsapp_number ?? "");
        setFurnitureNeeded(row.furniture_needed ?? []);
        setBoqAvailable(row.boq_available);
        setOpportunityValue(row.estimated_opportunity_value != null ? String(row.estimated_opportunity_value) : "");
        setExistingSupplier(row.existing_supplier ?? "");
        setVisitOutcome(row.visit_outcome);
        setVisitOutcomeOther(row.visit_outcome_other ?? "");
        setNotes(row.notes ?? "");
        setLatitude(row.latitude ?? null);
        setLongitude(row.longitude ?? null);
        setGpsStatus(row.gps_available ? "ok" : "denied");
        setPhotos(
          (row.photo_urls ?? []).map((url, i) => ({
            key: `remote-${i}-${url}`,
            previewUrl: url,
            remoteUrl: url
          }))
        );
      })
      .catch((e) => toast.push("error", getErrorMessage(e)))
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [isEdit, editingId, navigate, toast]);

  useEffect(() => {
    if (isEdit || !navigator.geolocation) {
      if (!isEdit && !navigator.geolocation) setGpsStatus("denied");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLatitude(pos.coords.latitude);
        setLongitude(pos.coords.longitude);
        setGpsStatus("ok");
      },
      () => setGpsStatus("denied"),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  }, [isEdit]);

  useEffect(() => {
    return () => {
      for (const p of photos) {
        if (p.file && p.previewUrl.startsWith("blob:")) URL.revokeObjectURL(p.previewUrl);
      }
    };
  }, [photos]);

  const filteredFurnitureCategories = useMemo(() => {
    const categories = options?.furniture_categories ?? [];
    const q = furnitureSearch.trim().toLowerCase();
    if (!q) return categories;
    return categories.filter((item) => item.toLowerCase().includes(q));
  }, [options?.furniture_categories, furnitureSearch]);

  function toggleFurniture(category: string, checked: boolean) {
    setFurnitureError("");
    setFurnitureNeeded((xs) => {
      if (checked) return xs.includes(category) ? xs : [...xs, category];
      return xs.filter((x) => x !== category);
    });
  }

  async function onPickPhotos(files: FileList | null) {
    if (!files?.length) return;
    const remaining = MAX_PHOTOS - photos.length;
    if (remaining <= 0) {
      toast.push("error", `Maximum ${MAX_PHOTOS} photos allowed.`);
      return;
    }
    const picked = Array.from(files).slice(0, remaining);
    const next: LocalPhoto[] = [];
    for (const raw of picked) {
      const file = await compressImageFile(raw);
      next.push({
        key: `${file.name}-${file.size}-${Date.now()}-${Math.random()}`,
        previewUrl: URL.createObjectURL(file),
        file
      });
    }
    setPhotos((xs) => [...xs, ...next]);
  }

  function removePhoto(key: string) {
    setPhotos((xs) => {
      const target = xs.find((x) => x.key === key);
      if (target?.file && target.previewUrl.startsWith("blob:")) URL.revokeObjectURL(target.previewUrl);
      return xs.filter((x) => x.key !== key);
    });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!projectName.trim() || !projectLocation.trim() || !projectType || !projectStage || !phoneNumber.trim()) {
      toast.push("error", "Complete all required visit and contact fields.");
      return;
    }
    if (furnitureNeeded.length === 0) {
      setFurnitureError("Select at least one furniture category.");
      toast.push("error", "Select at least one furniture category.");
      return;
    }
    setFurnitureError("");
    if (!visitOutcome) {
      toast.push("error", "Select a visit outcome.");
      return;
    }
    if (visitOutcome === "Other" && !visitOutcomeOther.trim()) {
      toast.push("error", "Provide details for the Other outcome.");
      return;
    }
    if (opportunityValue.trim() && !isValidThousandsCommaNumber(opportunityValue)) {
      toast.push("error", "Fix comma formatting in opportunity value.");
      return;
    }
    const parsedValue = parseMoneyInput(opportunityValue);
    if (opportunityValue.trim() && (parsedValue === null || Number.isNaN(parsedValue))) {
      toast.push("error", "Enter a valid opportunity value.");
      return;
    }

    const payload = {
      project_name: projectName.trim(),
      project_location: projectLocation.trim(),
      project_type: projectType,
      estimated_units: estimatedUnits.trim() || null,
      project_stage: projectStage,
      developer_owner: developerOwner.trim() || null,
      contractor: contractor.trim() || null,
      architect_designer: architectDesigner.trim() || null,
      decision_maker: decisionMaker.trim() || null,
      phone_number: phoneNumber.trim(),
      whatsapp_number: whatsappNumber.trim() || null,
      furniture_needed: furnitureNeeded,
      boq_available: boqAvailable,
      estimated_opportunity_value: parsedValue,
      existing_supplier: existingSupplier.trim() || null,
      visit_outcome: visitOutcome,
      visit_outcome_other: visitOutcome === "Other" ? visitOutcomeOther.trim() : null,
      notes: notes.trim() || null,
      latitude,
      longitude,
      existing_photo_urls: photos.filter((p) => p.remoteUrl).map((p) => p.remoteUrl as string)
    };
    const uploadFiles = photos.filter((p) => p.file).map((p) => p.file as File);

    setSaving(true);
    try {
      const saved = isEdit && editingId
        ? await fieldVisitsApi.update(editingId, payload, uploadFiles)
        : await fieldVisitsApi.create(payload, uploadFiles);
      toast.push("success", isEdit ? "Field visit updated." : "Field visit submitted.");
      navigate(`/field-visits/${saved.id}`);
    } catch (err) {
      toast.push("error", getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <div className="p-6 text-sm text-black/60">Loading…</div>;
  }

  return (
    <form className="space-y-6" onSubmit={(e) => void submit(e)}>
      <Card>
        <div className="text-sm font-semibold text-black">Visit Information</div>
        {!isEdit ? (
          <p className="mt-1 text-sm text-black/60">
            FV number, date, time, and employee will be captured automatically on submission.
          </p>
        ) : null}
        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
          <Input label="Project / Site Name *" value={projectName} onChange={(e) => setProjectName(e.target.value)} required />
          <Input label="Project Location *" value={projectLocation} onChange={(e) => setProjectLocation(e.target.value)} required />
          <div>
            <label className="mb-1 block text-xs font-semibold text-black/60">Project Type *</label>
            <select className="w-full rounded-xl border border-black/15 bg-white px-3 py-2.5 text-sm" value={projectType} onChange={(e) => setProjectType(e.target.value)} required>
              <option value="">Select type</option>
              {(options?.project_types ?? []).map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>
        </div>
      </Card>

      <Card>
        <div className="text-sm font-semibold text-black">Project Information</div>
        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
          <Input label="Estimated Number of Units / Size" value={estimatedUnits} onChange={(e) => setEstimatedUnits(e.target.value)} />
          <div>
            <label className="mb-1 block text-xs font-semibold text-black/60">Project Stage *</label>
            <select className="w-full rounded-xl border border-black/15 bg-white px-3 py-2.5 text-sm" value={projectStage} onChange={(e) => setProjectStage(e.target.value)} required>
              <option value="">Select stage</option>
              {(options?.project_stages ?? []).map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>
        </div>
      </Card>

      <Card>
        <div className="text-sm font-semibold text-black">Contact Information</div>
        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
          <Input label="Developer / Owner" value={developerOwner} onChange={(e) => setDeveloperOwner(e.target.value)} />
          <Input label="Contractor" value={contractor} onChange={(e) => setContractor(e.target.value)} />
          <Input label="Architect / Interior Designer" value={architectDesigner} onChange={(e) => setArchitectDesigner(e.target.value)} />
          <Input label="Decision Maker" value={decisionMaker} onChange={(e) => setDecisionMaker(e.target.value)} />
          <Input label="Phone Number *" value={phoneNumber} onChange={(e) => setPhoneNumber(e.target.value)} required />
          <Input label="WhatsApp Number" value={whatsappNumber} onChange={(e) => setWhatsappNumber(e.target.value)} />
        </div>
      </Card>

      <Card>
        <div className="text-sm font-semibold text-black">Furniture Needed *</div>

        <div className="mt-4 rounded-2xl border border-black/10 bg-black/[0.02] p-4">
          <div className="text-sm font-semibold text-black">
            Selected Furniture ({furnitureNeeded.length})
          </div>
          {furnitureNeeded.length ? (
            <>
              <p className="mt-2 text-sm text-black/70">{furnitureNeeded.join(" • ")}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {furnitureNeeded.map((item) => (
                  <button
                    key={item}
                    type="button"
                    className="inline-flex items-center gap-1.5 rounded-full bg-black/[0.07] px-3 py-1 text-xs font-semibold hover:bg-black/[0.11]"
                    onClick={() => toggleFurniture(item, false)}
                    aria-label={`Remove ${item}`}
                  >
                    {item}
                    <span aria-hidden>×</span>
                  </button>
                ))}
              </div>
            </>
          ) : (
            <p className="mt-2 text-sm text-black/50">No categories selected yet.</p>
          )}
        </div>

        <div className="mt-4">
          <Input
            label="Search furniture"
            value={furnitureSearch}
            onChange={(e) => setFurnitureSearch(e.target.value)}
            placeholder="Search furniture..."
          />
        </div>

        <div
          className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
          role="group"
          aria-label="Furniture categories"
        >
          {filteredFurnitureCategories.map((category) => {
            const checked = furnitureNeeded.includes(category);
            return (
              <label
                key={category}
                className={[
                  "flex cursor-pointer items-center gap-2.5 rounded-xl border px-3 py-2.5 text-sm transition",
                  checked
                    ? "border-black/25 bg-black/[0.05] font-semibold"
                    : "border-black/10 bg-white hover:border-black/20 hover:bg-black/[0.02]"
                ].join(" ")}
              >
                <input
                  type="checkbox"
                  className="h-4 w-4 shrink-0 rounded border-black/30"
                  checked={checked}
                  onChange={(e) => toggleFurniture(category, e.target.checked)}
                />
                <span>{category}</span>
              </label>
            );
          })}
        </div>

        {filteredFurnitureCategories.length === 0 ? (
          <p className="mt-3 text-sm text-black/50">No categories match your search.</p>
        ) : null}

        {furnitureError ? (
          <p className="mt-3 text-sm font-semibold text-red-700" role="alert">
            {furnitureError}
          </p>
        ) : null}
      </Card>

      <Card>
        <div className="text-sm font-semibold text-black">Opportunity</div>
        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-semibold text-black/60">BOQ Available? *</label>
            <select className="w-full rounded-xl border border-black/15 bg-white px-3 py-2.5 text-sm" value={boqAvailable} onChange={(e) => setBoqAvailable(e.target.value)}>
              {(options?.boq_options ?? ["Yes", "No"]).map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>
          <Input label="Estimated Opportunity Value (NGN)" value={opportunityValue} onChange={(e) => setOpportunityValue(e.target.value)} inputMode="decimal" placeholder="15,000,000" />
          <div className="md:col-span-2">
            <Input label="Existing Supplier / Competitor" value={existingSupplier} onChange={(e) => setExistingSupplier(e.target.value)} placeholder="ABC Furniture" />
          </div>
        </div>
      </Card>

      <Card>
        <div className="text-sm font-semibold text-black">Visit Outcome *</div>
        <div className="mt-4 grid grid-cols-1 gap-3">
          <select className="w-full rounded-xl border border-black/15 bg-white px-3 py-2.5 text-sm" value={visitOutcome} onChange={(e) => setVisitOutcome(e.target.value)} required>
            <option value="">Select outcome</option>
            {(options?.visit_outcomes ?? []).map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
          {visitOutcome === "Other" ? (
            <div>
              <label className="mb-1 block text-xs font-semibold text-black/60">Other outcome details *</label>
              <textarea className="min-h-24 w-full rounded-xl border border-black/15 px-3 py-2.5 text-sm" value={visitOutcomeOther} onChange={(e) => setVisitOutcomeOther(e.target.value)} required />
            </div>
          ) : null}
        </div>
      </Card>

      <Card>
        <div className="text-sm font-semibold text-black">Notes</div>
        <textarea className="mt-3 min-h-32 w-full rounded-xl border border-black/15 px-3 py-2.5 text-sm" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Observations, measurements, customer requests…" />
      </Card>

      <Card>
        <div className="text-sm font-semibold text-black">Photos</div>
        <p className="mt-1 text-sm text-black/60">Up to {MAX_PHOTOS} photos. Images are compressed before upload when needed.</p>
        <div className="mt-3">
          <input
            type="file"
            accept="image/*"
            multiple
            onChange={(e) => void onPickPhotos(e.target.files)}
            disabled={photos.length >= MAX_PHOTOS}
          />
        </div>
        {photos.length ? (
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
            {photos.map((p) => (
              <div key={p.key} className="overflow-hidden rounded-2xl border border-black/10">
                <img src={p.previewUrl} alt="" className="h-32 w-full object-cover" />
                <div className="p-2">
                  <Button type="button" variant="secondary" className="w-full" onClick={() => removePhoto(p.key)}>
                    Remove
                  </Button>
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </Card>

      <Card>
        <div className="text-sm font-semibold text-black">GPS Location</div>
        {gpsStatus === "pending" ? <p className="mt-2 text-sm text-black/60">Capturing location…</p> : null}
        {gpsStatus === "ok" && latitude != null && longitude != null ? (
          <p className="mt-2 text-sm text-black/70">
            Location captured: {latitude.toFixed(6)}, {longitude.toFixed(6)}
          </p>
        ) : null}
        {gpsStatus === "denied" ? <p className="mt-2 text-sm text-amber-800">GPS location not available.</p> : null}
      </Card>

      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="secondary" onClick={() => navigate(isEdit && editingId ? `/field-visits/${editingId}` : "/field-visits")}>
          Cancel
        </Button>
        <Button type="submit" isLoading={saving}>
          {isEdit ? "Save changes" : "Submit visit"}
        </Button>
      </div>
    </form>
  );
}
