import { useEffect, useMemo, useRef, useState } from "react";
import { Card } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/Input";
import { ConfirmModal } from "../components/ui/ConfirmModal";
import { useToast } from "../state/toast";
import { getErrorMessage } from "../services/api";
import { companyLocationsApi } from "../services/endpoints";
import type { CompanyLocation } from "../types/api";
import { usePageHeader } from "../components/layout/pageHeader";

import { Circle, MapContainer, Marker, TileLayer, useMapEvents } from "react-leaflet";
import L from "leaflet";
import type { Map as LeafletMap } from "leaflet";

// Fix default marker icons for Vite builds.
import markerIcon2xUrl from "leaflet/dist/images/marker-icon-2x.png";
import markerIconUrl from "leaflet/dist/images/marker-icon.png";
import markerShadowUrl from "leaflet/dist/images/marker-shadow.png";

L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2xUrl,
  iconUrl: markerIconUrl,
  shadowUrl: markerShadowUrl
});

function LocationPicker({
  value,
  onChange
}: {
  value: { lat: number; lng: number } | null;
  onChange: (v: { lat: number; lng: number }) => void;
}) {
  useMapEvents({
    click(e) {
      onChange({ lat: e.latlng.lat, lng: e.latlng.lng });
    }
  });
  return value ? (
    <Marker
      position={[value.lat, value.lng]}
      draggable
      eventHandlers={{
        dragend(e) {
          const marker = e.target as L.Marker;
          const p = marker.getLatLng();
          onChange({ lat: p.lat, lng: p.lng });
        }
      }}
    />
  ) : null;
}

export function AdminCompanyLocationsPage() {
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<CompanyLocation[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const selected = useMemo(() => items.find((x) => x.id === selectedId) ?? null, [items, selectedId]);

  const [name, setName] = useState("");
  const [radius, setRadius] = useState("150");
  const [pin, setPin] = useState<{ lat: number; lng: number } | null>(null);
  const [saving, setSaving] = useState(false);
  const [geoBusy, setGeoBusy] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchBusy, setSearchBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmResolve, setConfirmResolve] = useState<null | ((v: boolean) => void)>(null);
  const mapRef = useRef<LeafletMap | null>(null);

  usePageHeader({
    title: "Company Locations",
    subtitle: "Admin-only reusable locations for geo-attendance."
  });

  async function askConfirm(message: string) {
    return await new Promise<boolean>((resolve) => {
      setConfirmResolve(() => resolve);
      setConfirmOpen(true);
    });
  }

  async function refresh() {
    const rows = await companyLocationsApi.list();
    setItems(rows);
    return rows;
  }

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      try {
        const rows = await refresh();
        if (!alive) return;
        // Auto-select first.
        if (!selectedId && rows.length) setSelectedId(rows[0].id);
      } catch (e) {
        toast.push("error", getErrorMessage(e));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!selected) return;
    setName(selected.name ?? "");
    setRadius(String(selected.allowed_radius_meters ?? 0));
    setPin({ lat: selected.latitude, lng: selected.longitude });
  }, [selectedId]); // intentionally not depending on selected object identity

  function resetForCreate() {
    setSelectedId(null);
    setName("");
    setRadius("150");
    setPin(null);
    setSearchQuery("");
  }

  function _parseLatLng(q: string): { lat: number; lng: number } | null {
    const s = (q || "").trim();
    const m = /^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/.exec(s);
    if (!m) return null;
    const lat = Number(m[1]);
    const lng = Number(m[2]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
    return { lat, lng };
  }

  async function runSearch() {
    const q = (searchQuery || "").trim();
    if (!q) return;
    const direct = _parseLatLng(q);
    if (direct) {
      setPin(direct);
      const m = mapRef.current;
      if (m) m.setView([direct.lat, direct.lng], Math.max(m.getZoom(), 16), { animate: true });
      return;
    }

    setSearchBusy(true);
    try {
      const url = new URL("https://nominatim.openstreetmap.org/search");
      url.searchParams.set("format", "json");
      url.searchParams.set("q", q);
      url.searchParams.set("limit", "1");
      const res = await fetch(url.toString(), { headers: { Accept: "application/json" } });
      if (!res.ok) throw new Error(`Search failed (${res.status})`);
      const data = (await res.json()) as Array<{ lat?: string; lon?: string }>;
      const first = Array.isArray(data) ? data[0] : null;
      const lat = first?.lat ? Number(first.lat) : NaN;
      const lng = first?.lon ? Number(first.lon) : NaN;
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        toast.push("error", "No results found for that search.");
        return;
      }
      const next = { lat, lng };
      setPin(next);
      const m = mapRef.current;
      if (m) m.setView([next.lat, next.lng], Math.max(m.getZoom(), 16), { animate: true });
    } catch (e) {
      toast.push("error", getErrorMessage(e));
    } finally {
      setSearchBusy(false);
    }
  }

  async function useMyLocation() {
    setGeoBusy(true);
    try {
      const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
        if (!("geolocation" in navigator)) {
          reject(new Error("Geolocation is not supported on this device."));
          return;
        }
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 15_000,
          maximumAge: 0
        });
      });
      const next = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      setPin(next);
      const m = mapRef.current;
      if (m) m.setView([next.lat, next.lng], Math.max(m.getZoom(), 16), { animate: true });
    } catch (e) {
      const msg = getErrorMessage(e);
      if (typeof msg === "string" && /permission|denied|geolocation/i.test(msg)) {
        toast.push("error", "Location permission is required to use your current location.");
      } else {
        toast.push("error", msg);
      }
    } finally {
      setGeoBusy(false);
    }
  }

  async function save() {
    const n = name.trim();
    const r = Number(radius);
    if (!n) {
      toast.push("error", "Location name is required.");
      return;
    }
    if (!pin) {
      toast.push("error", "Drop a pin on the map to set coordinates.");
      return;
    }
    if (!Number.isFinite(r) || r <= 0) {
      toast.push("error", "Radius must be a number > 0.");
      return;
    }
    setSaving(true);
    try {
      if (selectedId) {
        const updated = await companyLocationsApi.update(selectedId, {
          name: n,
          latitude: pin.lat,
          longitude: pin.lng,
          allowed_radius_meters: r
        });
        await refresh();
        setSelectedId(updated.id);
        toast.push("success", "Location updated.");
      } else {
        await companyLocationsApi.create({
          name: n,
          latitude: pin.lat,
          longitude: pin.lng,
          allowed_radius_meters: r
        });
        await refresh();
        toast.push("success", "Location created.");
        // Workflow optimization: reset immediately so admin can create the next one without extra clicks.
        resetForCreate();
      }
    } catch (e) {
      toast.push("error", getErrorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!selectedId) return;
    const ok = await askConfirm("Delete this location?");
    if (!ok) return;
    try {
      await companyLocationsApi.remove(selectedId);
      toast.push("success", "Location deleted.");
      const next = await refresh();
      setSelectedId(next[0]?.id ?? null);
      if (!next.length) resetForCreate();
    } catch (e) {
      toast.push("error", getErrorMessage(e));
    }
  }

  const mapCenter: [number, number] = pin ? [pin.lat, pin.lng] : [9.0765, 7.3986]; // Abuja fallback
  const radiusNum = Number(radius);
  const showRadius = Boolean(pin && Number.isFinite(radiusNum) && radiusNum > 0);

  // Keep the full allowed radius visible while editing.
  useEffect(() => {
    const m = mapRef.current;
    if (!m || !pin || !showRadius) return;
    const t = window.setTimeout(() => {
      const circle = L.circle([pin.lat, pin.lng], { radius: radiusNum });
      m.fitBounds(circle.getBounds(), { padding: [24, 24], animate: true });
    }, 150);
    return () => window.clearTimeout(t);
  }, [pin?.lat, pin?.lng, radiusNum, showRadius]);

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[360px_1fr]">
      <Card>
        <div className="flex items-center justify-between gap-2">
          <div className="text-sm font-semibold">Saved locations</div>
          <Button variant="secondary" onClick={resetForCreate}>
            New
          </Button>
        </div>
        <div className="mt-3">
          {loading ? (
            <div className="text-sm text-black/60">Loading…</div>
          ) : items.length === 0 ? (
            <div className="text-sm text-black/60">No locations yet.</div>
          ) : (
            <ul className="space-y-2">
              {items.map((x) => (
                <li key={x.id}>
                  <button
                    type="button"
                    className={[
                      "w-full rounded-xl border px-3 py-2 text-left",
                      x.id === selectedId ? "border-black bg-black text-white" : "border-black/10 bg-white hover:bg-black/[0.02]"
                    ].join(" ")}
                    onClick={() => setSelectedId(x.id)}
                  >
                    <div className="text-sm font-semibold">{x.name}</div>
                    <div className={["mt-0.5 text-xs", x.id === selectedId ? "text-white/75" : "text-black/55"].join(" ")}>
                      Radius: {x.allowed_radius_meters}m
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>

      <Card>
        <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-center">
          <div>
            <div className="text-sm font-semibold">{selectedId ? "Edit location" : "Create location"}</div>
            <div className="mt-1 text-xs text-black/60">Click on the map to drop a pin (coordinates are captured automatically).</div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" isLoading={geoBusy} disabled={geoBusy} onClick={() => void useMyLocation()}>
              {geoBusy ? "Getting location…" : "Use Current Location"}
            </Button>
            {selectedId ? (
              <Button variant="danger" disabled={saving} onClick={() => void remove()}>
                Delete
              </Button>
            ) : null}
            <Button isLoading={saving} disabled={saving} onClick={() => void save()}>
              {selectedId ? "Save changes" : "Create"}
            </Button>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-[1fr_auto] md:items-end">
          <Input
            label="Search map (coordinates, place, or address)"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="e.g. 9.8965, 8.8583 or Rayfield Jos"
          />
          <Button variant="secondary" isLoading={searchBusy} disabled={searchBusy || !searchQuery.trim()} onClick={() => void runSearch()}>
            {searchBusy ? "Searching…" : "Search"}
          </Button>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
          <Input label="Location name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Main Factory" />
          <Input label="Allowed radius (meters)" value={radius} onChange={(e) => setRadius(e.target.value)} inputMode="numeric" />
        </div>

        <div className="mt-4 overflow-hidden rounded-2xl border border-black/10">
          <MapContainer
            center={mapCenter}
            zoom={15}
            style={{ height: 420, width: "100%" }}
            whenReady={(e) => {
              mapRef.current = e.target as LeafletMap;
            }}
          >
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            {showRadius && pin ? (
              <Circle
                center={[pin.lat, pin.lng]}
                radius={radiusNum}
                pathOptions={{ color: "#111827", weight: 2, fillColor: "#111827", fillOpacity: 0.12 }}
              />
            ) : null}
            <LocationPicker value={pin} onChange={setPin} />
          </MapContainer>
        </div>

        <div className="mt-3 text-xs font-semibold text-black/60">
          {pin ? `Pinned at: ${pin.lat.toFixed(6)}, ${pin.lng.toFixed(6)}` : "No pin selected yet."}
        </div>
      </Card>

      <ConfirmModal
        open={confirmOpen}
        title="Confirm"
        message="Delete this location permanently?"
        busy={false}
        confirmLabel="Delete"
        cancelLabel="Cancel"
        confirmVariant="danger"
        onClose={() => {
          setConfirmOpen(false);
          const resolve = confirmResolve;
          setConfirmResolve(null);
          if (resolve) resolve(false);
        }}
        onConfirm={() => {
          setConfirmOpen(false);
          const resolve = confirmResolve;
          setConfirmResolve(null);
          if (resolve) resolve(true);
        }}
      />
    </div>
  );
}

