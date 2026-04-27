import { useMemo, useState, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { contractEmployeesApi } from "../services/endpoints";
import { getErrorMessage } from "../services/api";
import { useToast } from "../state/toast";
import { useAuth } from "../state/auth";

export function ContractEmployeeCreatePage() {
  const auth = useAuth();
  const toast = useToast();
  const nav = useNavigate();
  const [searchParams] = useSearchParams();

  const backTo = useMemo(() => {
    if (auth.role === "factory") return "/dashboard";
    const next = searchParams.get("backTo");
    return next && next.startsWith("/") ? next : "/employees?tab=contract";
  }, [searchParams, auth.role]);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [username, setUsername] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [bankName, setBankName] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [status, setStatus] = useState<"active" | "inactive">("active");

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!username.trim()) {
      toast.push("error", "Username is required.");
      return;
    }
    if (loginPassword.trim().length < 8) {
      toast.push("error", "Password must be at least 8 characters.");
      return;
    }
    setIsSubmitting(true);
    try {
      if (accountNumber.trim() && !/^\d+$/.test(accountNumber.trim())) {
        toast.push("error", "Account number must contain digits only.");
        return;
      }
      const payload = {
        username: username.trim(),
        password: loginPassword,
        full_name: fullName.trim() || "",
        bank_name: bankName.trim() || null,
        account_number: accountNumber.trim() || null,
        phone: phone.trim() || null,
        address: address.trim() || null,
        status
      };
      console.log("[contract-employees.create-with-login] payload", payload);
      const res = await contractEmployeesApi.createWithLogin(payload);
      console.log("[contract-employees.create-with-login] response", res);
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
          <div className="md:col-span-2 rounded-2xl border border-black/10 bg-black/[0.02] p-3">
            <div className="text-sm font-semibold">Create Login Account</div>
            <div className="mt-2 grid grid-cols-1 gap-3 md:grid-cols-2">
              <label className="text-xs font-semibold text-black/60">
                Username (or email)
                <input
                  className="mt-1 w-full rounded-xl border border-black/15 bg-white px-3 py-2.5 text-sm font-semibold"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  required
                  autoComplete="username"
                />
              </label>
              <label className="text-xs font-semibold text-black/60">
                Password
                <input
                  className="mt-1 w-full rounded-xl border border-black/15 bg-white px-3 py-2.5 text-sm font-semibold"
                  value={loginPassword}
                  onChange={(e) => setLoginPassword(e.target.value)}
                  required
                  type="password"
                  autoComplete="new-password"
                />
              </label>
            </div>
            <div className="mt-2 text-xs text-black/55">
              Role is automatically set to <span className="font-semibold">Contract Employee</span>.
            </div>
          </div>
          <label className="text-xs font-semibold text-black/60">
            Name
            <input
              className="mt-1 w-full rounded-xl border border-black/15 bg-white px-3 py-2.5 text-sm font-semibold"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
            />
          </label>
          <label className="text-xs font-semibold text-black/60">
            Bank name
            <input
              className="mt-1 w-full rounded-xl border border-black/15 bg-white px-3 py-2.5 text-sm font-semibold"
              value={bankName}
              onChange={(e) => setBankName(e.target.value)}
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

