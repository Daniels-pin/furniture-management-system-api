import { useMemo, useState, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { contractEmployeesApi } from "../services/endpoints";
import { getErrorMessage } from "../services/api";
import { useToast } from "../state/toast";

export function ContractEmployeeCreatePage() {
  const toast = useToast();
  const nav = useNavigate();
  const [searchParams] = useSearchParams();

  const backTo = useMemo(() => {
    const next = searchParams.get("backTo");
    return next && next.startsWith("/") ? next : "/employees?tab=contract";
  }, [searchParams]);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [fullName, setFullName] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [status, setStatus] = useState<"active" | "inactive">("active");

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!fullName.trim()) {
      toast.push("error", "Name is required.");
      return;
    }
    setIsSubmitting(true);
    try {
      await contractEmployeesApi.create({
        full_name: fullName.trim(),
        account_number: accountNumber.trim() || null,
        phone: phone.trim() || null,
        address: address.trim() || null,
        status
      });
      toast.push("success", "Contract employee created.");
      const r = Date.now();
      nav(`${backTo}${backTo.includes("?") ? "&" : "?"}r=${r}`, { replace: true });
    } catch (err) {
      toast.push("error", getErrorMessage(err));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
        <div>
          <div className="text-2xl font-bold tracking-tight">Create Contract Employee</div>
          <div className="mt-1 text-sm text-black/60">Add a new contract employee profile.</div>
        </div>
        <Button variant="secondary" onClick={() => nav(backTo)}>
          Back
        </Button>
      </div>

      <Card>
        <form className="grid grid-cols-1 gap-3 md:grid-cols-2" onSubmit={submit}>
          <label className="text-xs font-semibold text-black/60">
            Name
            <input
              className="mt-1 w-full rounded-xl border border-black/15 bg-white px-3 py-2.5 text-sm font-semibold"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              required
            />
          </label>
          <label className="text-xs font-semibold text-black/60">
            Account number
            <input
              className="mt-1 w-full rounded-xl border border-black/15 bg-white px-3 py-2.5 text-sm font-semibold"
              value={accountNumber}
              onChange={(e) => setAccountNumber(e.target.value)}
            />
          </label>
          <label className="text-xs font-semibold text-black/60">
            Phone
            <input
              className="mt-1 w-full rounded-xl border border-black/15 bg-white px-3 py-2.5 text-sm font-semibold"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          </label>
          <label className="text-xs font-semibold text-black/60">
            Status
            <select
              className="mt-1 w-full rounded-xl border border-black/15 bg-white px-3 py-2.5 text-sm font-semibold"
              value={status}
              onChange={(e) => setStatus(e.target.value as any)}
            >
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </label>
          <label className="md:col-span-2 text-xs font-semibold text-black/60">
            Address
            <input
              className="mt-1 w-full rounded-xl border border-black/15 bg-white px-3 py-2.5 text-sm font-semibold"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
            />
          </label>
          <div className="md:col-span-2 flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={() => nav(backTo)} disabled={isSubmitting}>
              Cancel
            </Button>
            <Button type="submit" isLoading={isSubmitting}>
              Create
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}

