import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { Role, User } from "../types/api";
import { adminApi, usersApi } from "../services/endpoints";
import { getErrorMessage } from "../services/api";
import { useToast } from "../state/toast";
import { useAuth } from "../state/auth";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { Input } from "../components/ui/Input";
import { Modal } from "../components/ui/Modal";
import { Select } from "../components/ui/Select";

export function AdminUsersPage() {
  const toast = useToast();
  const auth = useAuth();
  const nav = useNavigate();
  const [isLoading, setIsLoading] = useState(true);
  const [users, setUsers] = useState<User[]>([]);
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const limit = 10;

  const [createOpen, setCreateOpen] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [impersonateConfirmId, setImpersonateConfirmId] = useState<number | null>(null);
  const [impersonatingId, setImpersonatingId] = useState<number | null>(null);

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    if (!query) return users;
    return users.filter((u) => {
      const username = u.username?.toLowerCase?.() ?? "";
      return String(u.id).includes(query) || username.includes(query) || u.role.includes(query as any);
    });
  }, [users, q]);

  const totalPages = useMemo(() => Math.max(1, Math.ceil(filtered.length / limit)), [filtered.length]);
  const safePage = useMemo(() => Math.min(Math.max(1, page), totalPages), [page, totalPages]);
  const pageRows = useMemo(() => {
    const start = (safePage - 1) * limit;
    return filtered.slice(start, start + limit);
  }, [filtered, safePage]);

  async function refresh() {
    setIsLoading(true);
    try {
      const data = await usersApi.list();
      setUsers(Array.isArray(data) ? data : []);
    } catch (err) {
      toast.push("error", getErrorMessage(err));
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setPage(1);
  }, [q]);

  async function doDelete(userId: number) {
    if (!Number.isFinite(userId)) return;
    setDeletingId(userId);
    const prev = users;
    setUsers((xs) => xs.filter((x) => x.id !== userId));
    try {
      await usersApi.delete(userId);
      toast.push("success", "User deleted");
    } catch (err) {
      setUsers(prev);
      toast.push("error", getErrorMessage(err));
    } finally {
      setDeletingId(null);
      setConfirmDeleteId(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-3 md:flex-row md:items-end">
        <div>
          <div className="text-2xl font-bold tracking-tight">Admin Users</div>
          <div className="mt-1 text-sm text-black/60">Create and manage user accounts.</div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => void refresh()} isLoading={isLoading}>
            Refresh
          </Button>
          <Button onClick={() => setCreateOpen(true)}>Create user</Button>
        </div>
      </div>

      <Card>
        <Input label="Search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="ID, username, role…" />
        <div className="mt-5 min-w-0 overflow-x-touch">
          <table className="w-full min-w-[860px] text-left text-sm">
            <thead className="text-black/60">
              <tr className="border-b border-black/10">
                <th className="py-3 pr-4 font-semibold">ID</th>
                <th className="py-3 pr-4 font-semibold">Username</th>
                <th className="py-3 pr-4 font-semibold">Role</th>
                <th className="py-3 pr-0 text-right font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td className="py-6 text-black/60" colSpan={4}>
                    Loading…
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td className="py-6 text-black/60" colSpan={4}>
                    No users found.
                  </td>
                </tr>
              ) : (
                pageRows.map((u, idx) => {
                  const displayNumber = String((safePage - 1) * limit + idx + 1).padStart(3, "0");
                  return (
                  <tr key={u.id} className="border-b border-black/5">
                    <td className="py-3 pr-4 font-semibold">#{displayNumber}</td>
                    <td className="py-3 pr-4">{u.username}</td>
                    <td className="py-3 pr-4">{u.role}</td>
                    <td className="py-3 pr-0 text-right">
                      <div className="flex flex-wrap items-center justify-end gap-1">
                        {typeof u.id === "number" && u.id !== auth.userId ? (
                          <Button
                            variant="secondary"
                            disabled={impersonatingId !== null || deletingId === u.id}
                            onClick={() => setImpersonateConfirmId(u.id)}
                          >
                            Login as User
                          </Button>
                        ) : null}
                        <Button
                          variant="ghost"
                          disabled={deletingId === u.id}
                          onClick={() => {
                            if (typeof u.id === "number") setConfirmDeleteId(u.id);
                          }}
                        >
                          Delete
                        </Button>
                      </div>
                    </td>
                  </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <div className="mt-4 flex items-center justify-between">
          <div className="text-xs font-semibold text-black/50">
            Page {safePage} of {totalPages}
          </div>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              disabled={safePage <= 1 || isLoading}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              Previous
            </Button>
            <Button
              variant="secondary"
              disabled={safePage >= totalPages || isLoading}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            >
              Next
            </Button>
          </div>
        </div>
      </Card>

      <Modal open={createOpen} title="Create user" onClose={() => setCreateOpen(false)}>
        <CreateUserForm
          onCreated={(u) => {
            setUsers((xs) => [u, ...xs]);
            setCreateOpen(false);
          }}
        />
      </Modal>

      <Modal open={confirmDeleteId !== null} title="Delete user?" onClose={() => setConfirmDeleteId(null)}>
        <div className="space-y-4">
          <div className="text-sm text-black/70">This action cannot be undone.</div>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setConfirmDeleteId(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              isLoading={confirmDeleteId !== null && deletingId === confirmDeleteId}
              onClick={() => {
                if (confirmDeleteId === null) return;
                void doDelete(confirmDeleteId);
              }}
            >
              Delete
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        open={impersonateConfirmId !== null}
        title="Log in as this user?"
        onClose={() => setImpersonateConfirmId(null)}
      >
        <div className="space-y-4">
          <div className="text-sm text-black/70">
            You will switch to this user&apos;s session for support and debugging. Your admin session can be
            restored with <span className="font-semibold text-black">Exit</span> in the impersonation banner.
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setImpersonateConfirmId(null)}>
              Cancel
            </Button>
            <Button
              isLoading={impersonateConfirmId !== null && impersonatingId === impersonateConfirmId}
              onClick={() => {
                if (impersonateConfirmId === null) return;
                const id = impersonateConfirmId;
                setImpersonatingId(id);
                void (async () => {
                  try {
                    const res = await adminApi.impersonate(id);
                    auth.beginImpersonation(res.access_token, res.restore_token);
                    toast.push("success", "Impersonation started");
                    setImpersonateConfirmId(null);
                    nav("/dashboard", { replace: true });
                  } catch (err) {
                    toast.push("error", getErrorMessage(err));
                  } finally {
                    setImpersonatingId(null);
                  }
                })();
              }}
            >
              Continue
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

function CreateUserForm({ onCreated }: { onCreated(u: User): void }) {
  const toast = useToast();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Role>("showroom");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      const created = await usersApi.create({
        username: username.trim(),
        password,
        role
      });
      toast.push("success", "User created");
      onCreated(created);
      setUsername("");
      setPassword("");
      setRole("showroom");
    } catch (err) {
      toast.push("error", getErrorMessage(err));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form className="space-y-3" onSubmit={submit}>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <Input
          label="Username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          required
        />
        <Input
          label="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          type="password"
          required
        />
        <Select
          label="Role"
          value={role}
          onChange={(e) => setRole(e.target.value as Role)}
          options={[
            { value: "showroom", label: "showroom" },
            { value: "factory", label: "factory" },
            { value: "finance", label: "finance" },
            { value: "admin", label: "admin" }
          ]}
        />
      </div>
      <div className="flex justify-end gap-2 pt-2">
        <Button type="submit" isLoading={isSubmitting}>
          Create
        </Button>
      </div>
    </form>
  );
}

