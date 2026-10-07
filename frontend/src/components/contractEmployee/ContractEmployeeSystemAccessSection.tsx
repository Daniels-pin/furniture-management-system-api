import { useMemo, useState } from "react";
import type { ContractEmployeeDetail, Role } from "../../types/api";
import { Card } from "../ui/Card";
import { Button } from "../ui/Button";
import { Modal } from "../ui/Modal";
import { Input } from "../ui/Input";
import { Select } from "../ui/Select";
import { contractEmployeeAdminSecurityApi, contractEmployeesApi, usersApi } from "../../services/endpoints";
import { getErrorMessage } from "../../services/api";
import { useToast } from "../../state/toast";
import { useAuth } from "../../state/auth";
import { roleLabel } from "../../utils/roles";

type AssignableRole = Extract<
  Role,
  "contract_employee" | "showroom" | "factory" | "finance" | "staff" | "admin"
>;

const ROLE_OPTIONS: { value: AssignableRole; label: string }[] = [
  { value: "contract_employee", label: roleLabel("contract_employee") },
  { value: "factory", label: roleLabel("factory") },
  { value: "showroom", label: roleLabel("showroom") },
  { value: "finance", label: roleLabel("finance") },
  { value: "staff", label: roleLabel("staff") },
  { value: "admin", label: roleLabel("admin") }
];

function hasLinkedAccount(detail: ContractEmployeeDetail): boolean {
  return detail.linked_user_id != null;
}

type Props = {
  detail: ContractEmployeeDetail;
  onUpdated: (detail: ContractEmployeeDetail) => void;
};

export function ContractEmployeeSystemAccessSection({ detail, onUpdated }: Props) {
  const toast = useToast();
  const auth = useAuth();
  const linked = hasLinkedAccount(detail);
  const accountActive = detail.user_account_active !== false;

  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [statusConfirm, setStatusConfirm] = useState<"activate" | "deactivate" | null>(null);

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [role, setRole] = useState<AssignableRole>("contract_employee");
  const [editUsername, setEditUsername] = useState("");
  const [editRole, setEditRole] = useState<AssignableRole>("contract_employee");
  const [resetPw, setResetPw] = useState("");
  const [resetForce, setResetForce] = useState(true);
  const [busy, setBusy] = useState(false);

  const displayUsername = detail.linked_username ?? "—";
  const displayRole = useMemo(() => roleLabel(detail.linked_user_role ?? undefined), [detail.linked_user_role]);

  if (!auth.isAdmin) {
    return null;
  }

  function openCreate() {
    setUsername("");
    setPassword("");
    setConfirmPassword("");
    setRole("contract_employee");
    setCreateOpen(true);
  }

  function openEdit() {
    setEditUsername(detail.linked_username ?? "");
    setEditRole((detail.linked_user_role as AssignableRole) || "contract_employee");
    setEditOpen(true);
  }

  async function refreshDetail() {
    const d = await contractEmployeesApi.get(detail.id);
    onUpdated(d);
  }

  return (
    <>
      <Card className="!p-4">
        <div className="text-xs font-semibold text-black/55">System Access</div>

        {!linked ? (
          <div className="mt-3 space-y-3">
            <div className="text-sm">
              <span className="font-semibold text-black/70">Status: </span>
              <span className="text-black/60">No User Account</span>
            </div>
            <Button onClick={openCreate}>Create User Account</Button>
          </div>
        ) : (
          <div className="mt-3 space-y-3">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-semibold text-black/70">Status:</span>
              {accountActive ? (
                <span className="inline-flex items-center gap-1.5 font-semibold text-emerald-800">
                  <span aria-hidden>✓</span> User Account Active
                </span>
              ) : (
                <span className="font-semibold text-black/60">User Account (login disabled)</span>
              )}
            </div>
            <div className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
              <div className="rounded-xl border border-black/10 bg-black/[0.02] p-3">
                <div className="text-xs font-semibold text-black/60">Username</div>
                <div className="mt-1 break-all font-bold">{displayUsername}</div>
              </div>
              <div className="rounded-xl border border-black/10 bg-black/[0.02] p-3">
                <div className="text-xs font-semibold text-black/60">Role</div>
                <div className="mt-1 font-bold">{displayRole}</div>
              </div>
              <div className="rounded-xl border border-black/10 bg-black/[0.02] p-3">
                <div className="text-xs font-semibold text-black/60">Account</div>
                <div className="mt-1 font-bold">{accountActive ? "Active" : "Deactivated"}</div>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={openEdit}>
                Edit User
              </Button>
              <Button variant="secondary" onClick={() => setResetOpen(true)}>
                Reset Password
              </Button>
              {accountActive ? (
                <Button variant="secondary" onClick={() => setStatusConfirm("deactivate")}>
                  Deactivate
                </Button>
              ) : (
                <Button variant="secondary" onClick={() => setStatusConfirm("activate")}>
                  Activate User
                </Button>
              )}
            </div>
          </div>
        )}
      </Card>

      <Modal open={createOpen} title="Create User Account" onClose={() => (busy ? null : setCreateOpen(false))}>
        <div className="space-y-4">
          <div className="rounded-xl border border-black/10 bg-black/[0.02] p-3 text-sm">
            <div className="text-xs font-semibold text-black/55">Employee</div>
            <div className="mt-1 font-bold">{detail.full_name}</div>
          </div>
          <div className="grid grid-cols-1 gap-3">
            <Input label="Username" value={username} onChange={(e) => setUsername(e.target.value)} required autoComplete="off" />
            <Input
              label="Password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="new-password"
            />
            <Input
              label="Confirm Password"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              autoComplete="new-password"
            />
            <Select
              label="System Role"
              value={role}
              onChange={(e) => setRole(e.target.value as AssignableRole)}
              options={ROLE_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              isLoading={busy}
              onClick={() => {
                const u = username.trim();
                if (!u) {
                  toast.push("error", "Username is required.");
                  return;
                }
                if (password.length < 8) {
                  toast.push("error", "Password must be at least 8 characters.");
                  return;
                }
                if (password !== confirmPassword) {
                  toast.push("error", "Passwords do not match.");
                  return;
                }
                setBusy(true);
                void contractEmployeesApi
                  .createUserAccount(detail.id, { username: u, password, role })
                  .then((d) => {
                    onUpdated(d);
                    toast.push("success", "User account created.");
                    setCreateOpen(false);
                  })
                  .catch((e) => toast.push("error", getErrorMessage(e)))
                  .finally(() => setBusy(false));
              }}
            >
              Create Account
            </Button>
            <Button variant="ghost" disabled={busy} onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
          </div>
        </div>
      </Modal>

      <Modal open={editOpen} title="Edit User" onClose={() => (busy ? null : setEditOpen(false))}>
        <div className="space-y-4">
          <Input label="Username" value={editUsername} onChange={(e) => setEditUsername(e.target.value)} required />
          <Select
            label="System Role"
            value={editRole}
            onChange={(e) => setEditRole(e.target.value as AssignableRole)}
            options={ROLE_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
          />
          <div className="flex flex-wrap gap-2">
            <Button
              isLoading={busy}
              onClick={() => {
                const u = editUsername.trim();
                if (!u) {
                  toast.push("error", "Username is required.");
                  return;
                }
                setBusy(true);
                void contractEmployeesApi
                  .updateUserAccount(detail.id, { username: u, role: editRole })
                  .then((d) => {
                    onUpdated(d);
                    toast.push("success", "User updated.");
                    setEditOpen(false);
                  })
                  .catch((e) => toast.push("error", getErrorMessage(e)))
                  .finally(() => setBusy(false));
              }}
            >
              Save
            </Button>
            <Button variant="ghost" disabled={busy} onClick={() => setEditOpen(false)}>
              Cancel
            </Button>
          </div>
        </div>
      </Modal>

      <Modal open={resetOpen} title="Reset Password" onClose={() => (busy ? null : setResetOpen(false))}>
        <div className="space-y-4">
          <div className="text-sm text-black/70">Set a new password for this user. This takes effect immediately.</div>
          <Input
            label="New password"
            type="password"
            value={resetPw}
            onChange={(e) => setResetPw(e.target.value)}
            autoComplete="new-password"
          />
          <label className="inline-flex items-center gap-2 text-xs font-semibold text-black/70">
            <input type="checkbox" checked={resetForce} onChange={(e) => setResetForce(e.target.checked)} />
            Force password change on next login (recommended)
          </label>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              isLoading={busy}
              onClick={() => {
                if (resetPw.trim().length < 8) {
                  toast.push("error", "Password must be at least 8 characters.");
                  return;
                }
                setBusy(true);
                void contractEmployeeAdminSecurityApi
                  .resetPassword(detail.id, { new_password: resetPw, force_change_on_next_login: resetForce })
                  .then(() => toast.push("success", "Password reset."))
                  .then(() => {
                    setResetOpen(false);
                    setResetPw("");
                    setResetForce(true);
                  })
                  .catch((e) => toast.push("error", getErrorMessage(e)))
                  .finally(() => setBusy(false));
              }}
            >
              Reset
            </Button>
            <Button variant="ghost" disabled={busy} onClick={() => setResetOpen(false)}>
              Cancel
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        open={statusConfirm !== null}
        title={statusConfirm === "deactivate" ? "Deactivate User" : "Activate User"}
        onClose={() => (busy ? null : setStatusConfirm(null))}
      >
        <div className="space-y-4">
          <div className="text-sm text-black/70">
            {statusConfirm === "deactivate"
              ? "This disables login only. The contract employee record is not affected."
              : "This user will regain access using their existing credentials."}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant={statusConfirm === "deactivate" ? "danger" : "secondary"}
              isLoading={busy}
              disabled={detail.linked_user_id == null}
              onClick={() => {
                const uid = detail.linked_user_id;
                if (uid == null || statusConfirm == null) return;
                setBusy(true);
                const call =
                  statusConfirm === "deactivate" ? usersApi.deactivate(uid) : usersApi.activate(uid);
                void call
                  .then(() => refreshDetail())
                  .then(() =>
                    toast.push("success", statusConfirm === "deactivate" ? "User deactivated." : "User activated.")
                  )
                  .then(() => setStatusConfirm(null))
                  .catch((e) => toast.push("error", getErrorMessage(e)))
                  .finally(() => setBusy(false));
              }}
            >
              {statusConfirm === "deactivate" ? "Deactivate" : "Activate"}
            </Button>
            <Button variant="ghost" disabled={busy} onClick={() => setStatusConfirm(null)}>
              Cancel
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
