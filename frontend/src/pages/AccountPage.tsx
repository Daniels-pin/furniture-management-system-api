import { useState } from "react";
import { Card } from "../components/ui/Card";
import { Input } from "../components/ui/Input";
import { Button } from "../components/ui/Button";
import { authApi } from "../services/endpoints";
import { getErrorMessage } from "../services/api";
import { useToast } from "../state/toast";

export function AccountPage() {
  const toast = useToast();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      await authApi.changePassword({
        current_password: current,
        new_password: next,
        confirm_password: confirm
      });
      toast.push("success", "Password updated");
      setCurrent("");
      setNext("");
      setConfirm("");
    } catch (err) {
      toast.push("error", getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <div className="text-2xl font-bold tracking-tight">Account</div>
        <div className="mt-1 text-sm text-black/60">Change your sign-in password.</div>
      </div>

      <Card>
        <form className="max-w-md space-y-4" onSubmit={submit}>
          <Input
            label="Current password"
            type="password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            autoComplete="current-password"
            required
          />
          <Input
            label="New password"
            type="password"
            value={next}
            onChange={(e) => setNext(e.target.value)}
            autoComplete="new-password"
            required
            minLength={8}
          />
          <Input
            label="Confirm new password"
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="new-password"
            required
            minLength={8}
          />
          <div className="text-xs text-black/50">Use at least 8 characters.</div>
          <Button type="submit" isLoading={loading}>
            Update password
          </Button>
        </form>
      </Card>
    </div>
  );
}
