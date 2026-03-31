import { useEffect, useMemo, useState } from "react";
import type { Role, User } from "../types/api";
import { usersApi } from "../services/endpoints";
import { getErrorMessage } from "../services/api";
import { useToast } from "../state/toast";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { Input } from "../components/ui/Input";
import { Modal } from "../components/ui/Modal";
import { Select } from "../components/ui/Select";

export function AdminUsersPage() {
  const toast = useToast();
  const [isLoading, setIsLoading] = useState(true);
  const [users, setUsers] = useState<User[]>([]);
  const [q, setQ] = useState("");

  const [createOpen, setCreateOpen] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    if (!query) return users;
    return users.filter((u) => {
      const name = u.name?.toLowerCase?.() ?? "";
      const email = u.email?.toLowerCase?.() ?? "";
      return String(u.id).includes(query) || name.includes(query) || email.includes(query) || u.role.includes(query as any);
    });
  }, [users, q]);

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
        <Input label="Search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="ID, name, email, role…" />
        <div className="mt-5 overflow-x-auto">
          <table className="w-full min-w-[860px] text-left text-sm">
            <thead className="text-black/60">
              <tr className="border-b border-black/10">
                <th className="py-3 pr-4 font-semibold">ID</th>
                <th className="py-3 pr-4 font-semibold">Name</th>
                <th className="py-3 pr-4 font-semibold">Email</th>
                <th className="py-3 pr-4 font-semibold">Role</th>
                <th className="py-3 pr-0 text-right font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td className="py-6 text-black/60" colSpan={5}>
                    Loading…
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td className="py-6 text-black/60" colSpan={5}>
                    No users found.
                  </td>
                </tr>
              ) : (
                filtered.map((u) => (
                  <tr key={u.id} className="border-b border-black/5">
                    <td className="py-3 pr-4 font-semibold">#{u.id}</td>
                    <td className="py-3 pr-4">{u.name}</td>
                    <td className="py-3 pr-4 text-black/70">{u.email}</td>
                    <td className="py-3 pr-4">{u.role}</td>
                    <td className="py-3 pr-0 text-right">
                      <Button
                        variant="ghost"
                        disabled={deletingId === u.id}
                        onClick={() => {
                          if (typeof u.id === "number") setConfirmDeleteId(u.id);
                        }}
                      >
                        Delete
                      </Button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
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
    </div>
  );
}

function CreateUserForm({ onCreated }: { onCreated(u: User): void }) {
  const toast = useToast();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Role>("showroom");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      const created = await usersApi.create({
        name: name.trim(),
        email: email.trim(),
        password,
        role
      });
      toast.push("success", "User created");
      onCreated(created);
      setName("");
      setEmail("");
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
        <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} required />
        <Input
          label="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          inputMode="email"
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
            { value: "manager", label: "manager" },
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

