import { useEffect, useMemo, useState } from "react";
import type { Customer } from "../types/api";
import { customersApi } from "../services/endpoints";
import { getErrorMessage } from "../services/api";
import { useAuth } from "../state/auth";
import { useToast } from "../state/toast";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { Input } from "../components/ui/Input";

export function CustomersPage() {
  const auth = useAuth();
  const toast = useToast();

  const [isLoading, setIsLoading] = useState(true);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [q, setQ] = useState("");

  const canSeePrivate = auth.role !== "manager";

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    if (!query) return customers;
    return customers.filter((c) => {
      const name = c.name?.toLowerCase?.() ?? "";
      return String(c.id).includes(query) || name.includes(query);
    });
  }, [customers, q]);

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

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-3 md:flex-row md:items-end">
        <div>
          <div className="text-2xl font-bold tracking-tight">Customers</div>
          <div className="mt-1 text-sm text-black/60">Manage customer records.</div>
        </div>
        <Button variant="secondary" onClick={() => void refresh()} isLoading={isLoading}>
          Refresh
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_420px]">
        <Card>
          <div className="flex items-end justify-between gap-3">
            <Input label="Search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Customer ID or name…" />
          </div>

          <div className="mt-5 overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="text-black/60">
                <tr className="border-b border-black/10">
                  <th className="py-3 pr-4 font-semibold">ID</th>
                  <th className="py-3 pr-4 font-semibold">Name</th>
                  {canSeePrivate ? (
                    <>
                      <th className="py-3 pr-4 font-semibold">Phone</th>
                      <th className="py-3 pr-0 font-semibold">Address</th>
                    </>
                  ) : (
                    <th className="py-3 pr-0 font-semibold">Details</th>
                  )}
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr>
                    <td className="py-6 text-black/60" colSpan={canSeePrivate ? 4 : 3}>
                      Loading…
                    </td>
                  </tr>
                ) : filtered.length === 0 ? (
                  <tr>
                    <td className="py-6 text-black/60" colSpan={canSeePrivate ? 4 : 3}>
                      No customers found.
                    </td>
                  </tr>
                ) : (
                  filtered.map((c) => (
                    <tr key={c.id} className="border-b border-black/5">
                      <td className="py-3 pr-4 font-semibold">#{c.id}</td>
                      <td className="py-3 pr-4">{c.name}</td>
                      {canSeePrivate ? (
                        <>
                          <td className="py-3 pr-4 text-black/70">{c.phone ?? "—"}</td>
                          <td className="py-3 pr-0 text-black/70">{c.address ?? "—"}</td>
                        </>
                      ) : (
                        <td className="py-3 pr-0 text-black/30">Hidden for manager role</td>
                      )}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Card>

        {auth.role !== "manager" ? (
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
    </div>
  );
}

function CreateCustomerCard({ onCreated }: { onCreated(c: Customer): void }) {
  const toast = useToast();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      const created = await customersApi.create({
        name: name.trim(),
        phone: phone.trim(),
        address: address.trim()
      });
      toast.push("success", "Customer created");
      onCreated(created);
      setName("");
      setPhone("");
      setAddress("");
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
        <Input label="Address" value={address} onChange={(e) => setAddress(e.target.value)} required />
        <Button type="submit" className="w-full" isLoading={isSubmitting}>
          Create
        </Button>
      </form>
    </Card>
  );
}

