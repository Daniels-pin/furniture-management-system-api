import { useEffect, useMemo, useState } from "react";
import type { Product } from "../types/api";
import { productsApi } from "../services/endpoints";
import { getErrorMessage } from "../services/api";
import { useToast } from "../state/toast";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { Input } from "../components/ui/Input";

export function ProductsPage() {
  const toast = useToast();

  const [isLoading, setIsLoading] = useState(true);
  const [products, setProducts] = useState<Product[]>([]);
  const [q, setQ] = useState("");

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    if (!query) return products;
    return products.filter((p) => {
      const name = p.name?.toLowerCase?.() ?? "";
      return String(p.id).includes(query) || name.includes(query);
    });
  }, [products, q]);

  async function refresh() {
    setIsLoading(true);
    try {
      const data = await productsApi.list();
      setProducts(Array.isArray(data) ? data : []);
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
          <div className="text-2xl font-bold tracking-tight">Products</div>
          <div className="mt-1 text-sm text-black/60">Manage product catalog.</div>
        </div>
        <Button variant="secondary" onClick={() => void refresh()} isLoading={isLoading}>
          Refresh
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_420px]">
        <Card>
          <Input label="Search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Product ID or name…" />

          <div className="mt-5 overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="text-black/60">
                <tr className="border-b border-black/10">
                  <th className="py-3 pr-4 font-semibold">ID</th>
                  <th className="py-3 pr-4 font-semibold">Name</th>
                  <th className="py-3 pr-0 font-semibold">Price</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr>
                    <td className="py-6 text-black/60" colSpan={3}>
                      Loading…
                    </td>
                  </tr>
                ) : filtered.length === 0 ? (
                  <tr>
                    <td className="py-6 text-black/60" colSpan={3}>
                      No products found.
                    </td>
                  </tr>
                ) : (
                  filtered.map((p) => (
                    <tr key={p.id} className="border-b border-black/5">
                      <td className="py-3 pr-4 font-semibold">#{p.id}</td>
                      <td className="py-3 pr-4">{p.name}</td>
                      <td className="py-3 pr-0 text-black/70">{p.price}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Card>

        <CreateProductCard
          onCreated={(p) => {
            setProducts((xs) => [p, ...xs]);
          }}
        />
      </div>
    </div>
  );
}

function CreateProductCard({ onCreated }: { onCreated(p: Product): void }) {
  const toast = useToast();
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const priceNum = Number(price);
    if (!Number.isFinite(priceNum) || priceNum < 0) {
      toast.push("error", "Price must be a valid number");
      return;
    }
    setIsSubmitting(true);
    try {
      const created = await productsApi.create({ name: name.trim(), price: priceNum });
      toast.push("success", "Product created");
      onCreated(created);
      setName("");
      setPrice("");
    } catch (err) {
      toast.push("error", getErrorMessage(err));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Card>
      <div className="text-sm font-semibold">Add product</div>
      <div className="mt-1 text-sm text-black/60">Create a new product.</div>
      <form className="mt-4 space-y-3" onSubmit={submit}>
        <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} required />
        <Input label="Price" value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" required />
        <Button type="submit" className="w-full" isLoading={isSubmitting}>
          Create
        </Button>
      </form>
    </Card>
  );
}

