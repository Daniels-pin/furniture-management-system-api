import { useEffect, useState } from "react";
import { usePageHeader } from "../components/layout/pageHeader";
import { Card } from "../components/ui/Card";
import { Input } from "../components/ui/Input";
import { Button } from "../components/ui/Button";
import { companySettingsApi } from "../services/endpoints";
import { getErrorMessage } from "../services/api";
import { useToast } from "../state/toast";

export function CompanySettingsPage() {
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [rcNumber, setRcNumber] = useState("");
  const [savedRcNumber, setSavedRcNumber] = useState("");

  usePageHeader({
    title: "Company Settings",
    subtitle: "Manage company-wide settings used on sales documents."
  });

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      try {
        const settings = await companySettingsApi.get();
        if (!alive) return;
        const rc = settings.rc_number ?? "";
        setRcNumber(rc);
        setSavedRcNumber(rc);
      } catch (e) {
        toast.push("error", getErrorMessage(e));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [toast]);

  const dirty = rcNumber.trim() !== savedRcNumber.trim();

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = rcNumber.trim();
    if (!trimmed) {
      toast.push("error", "RC Number cannot be empty.");
      return;
    }
    setSaving(true);
    try {
      const settings = await companySettingsApi.update({ rc_number: trimmed });
      setRcNumber(settings.rc_number ?? trimmed);
      setSavedRcNumber(settings.rc_number ?? trimmed);
      toast.push("success", "Company settings saved.");
    } catch (err) {
      toast.push("error", getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  function cancel() {
    setRcNumber(savedRcNumber);
  }

  return (
    <div className="space-y-6">
      <Card>
        <form className="max-w-lg space-y-6" onSubmit={save}>
          <section className="space-y-4">
            <div>
              <div className="text-base font-semibold text-black">Company RC Number</div>
              <div className="mt-1 text-sm text-black/60">
                Displayed on invoices, proforma invoices, and quotations.
              </div>
            </div>
            <Input
              label="RC Number"
              value={rcNumber}
              onChange={(e) => setRcNumber(e.target.value)}
              placeholder="1234567"
              disabled={loading || saving}
              hint="Shown as RC: 1234567 on sales documents."
            />
          </section>

          {/* Additional company settings (name, address, logo, etc.) can be added here as new sections. */}

          <div className="flex flex-wrap gap-2">
            <Button type="submit" isLoading={saving} disabled={loading || !dirty}>
              Save
            </Button>
            <Button type="button" variant="secondary" onClick={cancel} disabled={loading || saving || !dirty}>
              Cancel
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
