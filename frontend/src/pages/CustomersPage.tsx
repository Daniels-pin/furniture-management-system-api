import { useEffect, useMemo, useState } from "react";
import type { Customer } from "../types/api";
import { customersApi } from "../services/endpoints";
import { getErrorMessage } from "../services/api";
import { useAuth } from "../state/auth";
import { useToast } from "../state/toast";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { Input } from "../components/ui/Input";
import { Modal } from "../components/ui/Modal";

export function CustomersPage() {
  const auth = useAuth();
  const toast = useToast();

  const [isLoading, setIsLoading] = useState(true);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const limit = 10;
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportKind, setExportKind] = useState<"phones" | "emails">("phones");
  const [exporting, setExporting] = useState(false);

  const canSeePrivate = auth.role !== "factory";
  const canDelete = auth.role === "admin";
  const canExport = auth.role === "admin";
  const canCreate = auth.role === "admin" || auth.role === "showroom";

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    if (!query) return customers;
    return customers.filter((c) => {
      const name = c.name?.toLowerCase?.() ?? "";
      return String(c.id).includes(query) || name.includes(query);
    });
  }, [customers, q]);

  const totalPages = useMemo(() => {
    return Math.max(1, Math.ceil(filtered.length / limit));
  }, [filtered.length]);

  const safePage = useMemo(() => Math.min(Math.max(1, page), totalPages), [page, totalPages]);

  const pageRows = useMemo(() => {
    const start = (safePage - 1) * limit;
    return filtered.slice(start, start + limit);
  }, [filtered, safePage]);

  async function refresh() {
    setIsLoading(true);
    try {
      const data = await customersApi.list();
      setCustomers(Array.isArray(data) ? data : []);
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

  async function doDelete(customerId: number) {
    if (!Number.isFinite(customerId)) return;
    setDeletingId(customerId);
    const prev = customers;
    setCustomers((xs) => xs.filter((x) => x.id !== customerId));
    try {
      await customersApi.delete(customerId);
      toast.push("success", "Customer deleted");
    } catch (err) {
      setCustomers(prev);
      toast.push("error", getErrorMessage(err));
    } finally {
      setDeletingId(null);
      setConfirmDeleteId(null);
    }
  }

  function CustomerCard({ c, displayNumber }: { c: Customer; displayNumber: string }) {
    return (
      <div className="rounded-2xl border border-black/10 bg-white p-4 shadow-soft">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm font-bold">Customer #{displayNumber}</div>
            <div className="mt-1 break-words text-sm font-semibold text-black/80">{c.name}</div>
            {canSeePrivate && c.created_by ? (
              <div className="mt-1 text-xs font-medium text-black/45">Added by {c.created_by}</div>
            ) : null}
          </div>
          {canDelete ? (
            <div className="shrink-0">
              <Button
                variant="ghost"
                disabled={deletingId === c.id}
                onClick={() => setConfirmDeleteId(c.id)}
              >
                Delete
              </Button>
            </div>
          ) : null}
        </div>

        <div className="mt-3 grid grid-cols-1 gap-2 text-sm">
          {canSeePrivate ? (
            <>
              <div className="rounded-xl border border-black/10 bg-black/[0.02] px-3 py-2">
                <div className="text-xs font-semibold text-black/55">Phone</div>
                <div className="mt-0.5 font-semibold text-black/80 break-words">{c.phone ?? "—"}</div>
              </div>
              <div className="rounded-xl border border-black/10 bg-black/[0.02] px-3 py-2">
                <div className="text-xs font-semibold text-black/55">Email</div>
                <div className="mt-0.5 font-semibold text-black/80 break-words">{c.email ?? "—"}</div>
              </div>
              <div className="rounded-xl border border-black/10 bg-black/[0.02] px-3 py-2">
                <div className="text-xs font-semibold text-black/55">Address</div>
                <div className="mt-0.5 font-semibold text-black/80 break-words">{c.address ?? "—"}</div>
              </div>
            </>
          ) : (
            <div className="rounded-xl border border-black/10 bg-black/[0.02] px-3 py-2 text-xs font-semibold text-black/45">
              Details hidden for factory role
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-3 md:flex-row md:items-end">
        <div>
          <div className="text-2xl font-bold tracking-tight">Customers</div>
          <div className="mt-1 text-sm text-black/60">Manage customer records.</div>
        </div>
        <div className="flex flex-wrap gap-2">
          {canExport ? (
            <Button variant="secondary" onClick={() => setExportOpen(true)}>
              Export contacts
            </Button>
          ) : null}
          <Button variant="secondary" onClick={() => void refresh()} isLoading={isLoading}>
            Refresh
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_420px]">
        <Card>
          <div className="flex items-end justify-between gap-3">
            <Input label="Search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Customer ID or name…" />
          </div>

          {/* Mobile: cards (avoid horizontal table scroll) */}
          <div className="mt-4 space-y-3 md:hidden">
            {isLoading ? (
              <div className="text-sm text-black/60">Loading…</div>
            ) : filtered.length === 0 ? (
              <div className="text-sm text-black/60">No customers found.</div>
            ) : (
              pageRows.map((c, idx) => {
                const displayNumber = String((safePage - 1) * limit + idx + 1).padStart(3, "0");
                return <CustomerCard key={c.id} c={c} displayNumber={displayNumber} />;
              })
            )}
          </div>

          {/* Desktop: keep table unchanged */}
          <div className="mt-5 hidden min-w-0 overflow-x-touch md:block">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="text-black/60">
                <tr className="border-b border-black/10">
                  <th className="py-3 pr-4 font-semibold">ID</th>
                  <th className="py-3 pr-4 font-semibold">Name</th>
                  {canSeePrivate ? (
                    <>
                      <th className="py-3 pr-4 font-semibold">Phone</th>
                      <th className="py-3 pr-4 font-semibold">Email</th>
                      <th className="py-3 pr-0 font-semibold">Address</th>
                    </>
                  ) : (
                    <th className="py-3 pr-0 font-semibold">Details</th>
                  )}
                  {canDelete ? <th className="py-3 pr-0 text-right font-semibold">Actions</th> : null}
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr>
                    <td className="py-6 text-black/60" colSpan={canDelete ? (canSeePrivate ? 6 : 4) : (canSeePrivate ? 5 : 3)}>
                      Loading…
                    </td>
                  </tr>
                ) : filtered.length === 0 ? (
                  <tr>
                    <td className="py-6 text-black/60" colSpan={canDelete ? (canSeePrivate ? 6 : 4) : (canSeePrivate ? 5 : 3)}>
                      No customers found.
                    </td>
                  </tr>
                ) : (
                  pageRows.map((c, idx) => {
                    const displayNumber = String((safePage - 1) * limit + idx + 1).padStart(3, "0");
                    return (
                      <tr key={c.id} className="border-b border-black/5">
                        <td className="py-3 pr-4 font-semibold">#{displayNumber}</td>
                        <td className="py-3 pr-4">
                          <div>{c.name}</div>
                          {canSeePrivate && c.created_by ? (
                            <div className="mt-0.5 text-xs font-medium text-black/45">Added by {c.created_by}</div>
                          ) : null}
                        </td>
                        {canSeePrivate ? (
                          <>
                            <td className="py-3 pr-4 text-black/70">{c.phone ?? "—"}</td>
                            <td className="py-3 pr-4 text-black/70">{c.email ?? "—"}</td>
                            <td className="py-3 pr-0 text-black/70">{c.address ?? "—"}</td>
                          </>
                        ) : (
                          <td className="py-3 pr-0 text-black/30">Hidden for factory role</td>
                        )}
                        {canDelete ? (
                          <td className="py-3 pr-0 text-right">
                            <Button variant="ghost" disabled={deletingId === c.id} onClick={() => setConfirmDeleteId(c.id)}>
                              Delete
                            </Button>
                          </td>
                        ) : null}
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

        {auth.role !== "factory" && canCreate ? (
          <CreateCustomerCard
            onCreated={(c) => {
              setCustomers((xs) => [c, ...xs]);
            }}
          />
        ) : (
          <Card>
            <div className="text-sm font-semibold">Add customer</div>
            <div className="mt-2 text-sm text-black/60">Only showroom/admin can add customers.</div>
          </Card>
        )}
      </div>

      <Modal open={confirmDeleteId !== null} title="Delete customer?" onClose={() => setConfirmDeleteId(null)}>
        <div className="space-y-4">
          <div className="text-sm text-black/70">
            This action cannot be undone. If the customer has existing orders, deletion will be blocked.
          </div>
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

      <Modal open={exportOpen} title="Export customer contacts" onClose={() => setExportOpen(false)}>
        <div className="space-y-4">
          <p className="text-sm text-black/70">
            Choose which field to export. The file is CSV (one column) with duplicates removed, ready for bulk SMS or
            email tools.
          </p>
          <div className="space-y-2 text-sm font-semibold">
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="radio"
                name="export-kind"
                checked={exportKind === "phones"}
                onChange={() => setExportKind("phones")}
              />
              Export phone numbers
            </label>
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="radio"
                name="export-kind"
                checked={exportKind === "emails"}
                onChange={() => setExportKind("emails")}
              />
              Export email addresses
            </label>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setExportOpen(false)}>
              Cancel
            </Button>
            <Button
              isLoading={exporting}
              onClick={() => {
                void (async () => {
                  try {
                    setExporting(true);
                    await customersApi.exportContacts(exportKind);
                    toast.push("success", "Download started.");
                    setExportOpen(false);
                  } catch (err) {
                    toast.push("error", getErrorMessage(err));
                  } finally {
                    setExporting(false);
                  }
                })();
              }}
            >
              Download CSV
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

function CreateCustomerCard({ onCreated }: { onCreated(c: Customer): void }) {
  const toast = useToast();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [email, setEmail] = useState("");
  const [birthDay, setBirthDay] = useState("");
  const [birthMonth, setBirthMonth] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const em = email.trim();
    if (em && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) {
      toast.push("error", "Enter a valid email or leave blank");
      return;
    }
    const bd = birthDay.trim() ? Number(birthDay) : null;
    const bm = birthMonth.trim() ? Number(birthMonth) : null;
    if (bd !== null && (!Number.isFinite(bd) || bd < 1 || bd > 31)) {
      toast.push("error", "Birth day must be between 1 and 31");
      return;
    }
    if (bm !== null && (!Number.isFinite(bm) || bm < 1 || bm > 12)) {
      toast.push("error", "Birth month must be between 1 and 12");
      return;
    }
    setIsSubmitting(true);
    try {
      const created = await customersApi.create({
        name: name.trim(),
        phone: phone.trim(),
        address: address.trim(),
        email: em || undefined,
        birth_day: bd ?? undefined,
        birth_month: bm ?? undefined
      });
      toast.push("success", "Customer created");
      onCreated(created);
      setName("");
      setPhone("");
      setAddress("");
      setEmail("");
      setBirthDay("");
      setBirthMonth("");
    } catch (err) {
      toast.push("error", getErrorMessage(err));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Card>
      <div className="text-sm font-semibold">Add customer</div>
      <div className="mt-1 text-sm text-black/60">Create a new customer record.</div>
      <form className="mt-4 space-y-3" onSubmit={submit}>
        <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} required />
        <Input label="Phone" value={phone} onChange={(e) => setPhone(e.target.value)} required />
        <Input label="Email (optional)" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Input
            label="Birth day (optional)"
            value={birthDay}
            onChange={(e) => setBirthDay(e.target.value)}
            inputMode="numeric"
            placeholder="1-31"
          />
          <Input
            label="Birth month (optional)"
            value={birthMonth}
            onChange={(e) => setBirthMonth(e.target.value)}
            inputMode="numeric"
            placeholder="1-12"
          />
        </div>
        <Input label="Address" value={address} onChange={(e) => setAddress(e.target.value)} required />
        <Button type="submit" className="w-full" isLoading={isSubmitting}>
          Create
        </Button>
      </form>
    </Card>
  );
}

