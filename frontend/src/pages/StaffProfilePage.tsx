import { useEffect, useState } from "react";
import { Card } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/Input";
import { employeesApi, authApi } from "../services/endpoints";
import { getErrorMessage } from "../services/api";
import { useToast } from "../state/toast";
import { usePageHeader } from "../components/layout/pageHeader";
import type { EmployeeDetail } from "../types/api";

export function StaffProfilePage() {
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [emp, setEmp] = useState<EmployeeDetail | null>(null);

  const [fullName, setFullName] = useState("");
  const [address, setAddress] = useState("");
  const [bankName, setBankName] = useState("");
  const [accountNumber, setAccountNumber] = useState("");

  const [currentPw, setCurrentPw] = useState("");
  const [nextPw, setNextPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [pwBusy, setPwBusy] = useState(false);

  usePageHeader({
    title: "Profile",
    subtitle: "Your contact details and sign-in password."
  });

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      try {
        const d = await employeesApi.getMe();
        if (!alive) return;
        setEmp(d);
        setFullName(d.full_name);
        setAddress(d.address ?? "");
        setBankName(d.bank_name ?? "");
        setAccountNumber(d.account_number ?? "");
      } catch (e) {
        if (!alive) return;
        toast.push("error", getErrorMessage(e));
        setEmp(null);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [toast]);

  function applyDetail(d: EmployeeDetail) {
    setEmp(d);
    setFullName(d.full_name);
    setAddress(d.address ?? "");
    setBankName(d.bank_name ?? "");
    setAccountNumber(d.account_number ?? "");
  }

  async function saveProfile() {
    if (!fullName.trim()) {
      toast.push("error", "Full name is required.");
      return;
    }
    if (!bankName.trim()) {
      toast.push("error", "Bank name is required.");
      return;
    }
    if (accountNumber.trim() && !/^\d+$/.test(accountNumber.trim())) {
      toast.push("error", "Account number must contain digits only.");
      return;
    }
    setSaving(true);
    try {
      const d = await employeesApi.patchMe({
        full_name: fullName.trim(),
        address: address.trim() || undefined,
        bank_name: bankName.trim() || undefined,
        account_number: accountNumber.trim() || undefined
      });
      applyDetail(d);
      toast.push("success", "Saved.");
    } catch (e) {
      toast.push("error", getErrorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  async function savePassword(e: React.FormEvent) {
    e.preventDefault();
    setPwBusy(true);
    try {
      await authApi.changePassword({
        current_password: currentPw,
        new_password: nextPw,
        confirm_password: confirmPw
      });
      toast.push("success", "Password updated");
      setCurrentPw("");
      setNextPw("");
      setConfirmPw("");
    } catch (err) {
      toast.push("error", getErrorMessage(err));
    } finally {
      setPwBusy(false);
    }
  }

  if (loading) {
    return (
      <Card>
        <div className="text-sm text-black/60">Loading…</div>
      </Card>
    );
  }

  if (!emp) {
    return (
      <Card>
        <div className="text-lg font-bold tracking-tight">Profile</div>
        <p className="mt-2 text-sm text-black/70">
          No employee profile is linked to your account yet. Ask an administrator to link your Staff login.
        </p>
      </Card>
    );
  }

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <Card>
        <div className="text-sm font-semibold text-black">Your details</div>
        <div className="mt-4 grid grid-cols-1 gap-4">
          <Input label="Full name" value={fullName} onChange={(e) => setFullName(e.target.value)} required />
          <Input label="Address" value={address} onChange={(e) => setAddress(e.target.value)} />
          <Input label="Bank name" value={bankName} onChange={(e) => setBankName(e.target.value)} required />
          <Input label="Bank account number" value={accountNumber} onChange={(e) => setAccountNumber(e.target.value)} inputMode="numeric" />
        </div>
        <div className="mt-6">
          <Button isLoading={saving} disabled={saving} onClick={() => void saveProfile()}>
            Save changes
          </Button>
        </div>
      </Card>

      <Card>
        <div className="text-sm font-semibold text-black">Password</div>
        <p className="mt-1 text-xs text-black/55">Use at least 8 characters.</p>
        <form className="mt-4 space-y-4" onSubmit={savePassword}>
          <Input
            label="Current password"
            type="password"
            value={currentPw}
            onChange={(e) => setCurrentPw(e.target.value)}
            autoComplete="current-password"
            required
          />
          <Input
            label="New password"
            type="password"
            value={nextPw}
            onChange={(e) => setNextPw(e.target.value)}
            autoComplete="new-password"
            required
            minLength={8}
          />
          <Input
            label="Confirm new password"
            type="password"
            value={confirmPw}
            onChange={(e) => setConfirmPw(e.target.value)}
            autoComplete="new-password"
            required
            minLength={8}
          />
          <Button type="submit" isLoading={pwBusy}>
            Update password
          </Button>
        </form>
      </Card>
    </div>
  );
}
