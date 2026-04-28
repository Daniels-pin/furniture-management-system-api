import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Card } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Modal } from "../components/ui/Modal";
import { Input } from "../components/ui/Input";
import { contractEmployeesApi, contractJobsApi } from "../services/endpoints";
import { getErrorMessage } from "../services/api";
import { useToast } from "../state/toast";
import { formatMoney } from "../utils/money";
import type { AdminJobsSummary, ContractEmployeeListItem, ContractJob } from "../types/api";
import { usePageHeader } from "../components/layout/pageHeader";
import { isValidThousandsCommaNumber, parseMoneyInput } from "../utils/moneyInput";

function JobStatusBadge({ status }: { status: ContractJob["status"] }) {
  const base = "inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset";
  const cls =
    status === "pending"
      ? "bg-black/5 text-black/70 ring-black/10"
      : status === "in_progress"
        ? "bg-yellow-100 text-yellow-900 ring-yellow-200"
        : status === "completed"
          ? "bg-green-100 text-green-900 ring-green-200"
          : status === "cancelled"
            ? "bg-red-100 text-red-900 ring-red-200"
            : "bg-black/5 text-black/70 ring-black/10";
  const label =
    status === "in_progress"
      ? "In Progress"
      : status === "cancelled"
        ? "Cancelled"
        : status[0].toUpperCase() + status.slice(1);
  return <span className={[base, cls].join(" ")}>{label}</span>;
}

function PaidFlagBadge({ paid }: { paid: boolean }) {
  const base = "inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset";
  const cls = paid ? "bg-emerald-100 text-emerald-900 ring-emerald-200" : "bg-black/5 text-black/70 ring-black/10";
  return <span className={[base, cls].join(" ")}>{paid ? "Paid" : "Not paid"}</span>;
}

function NegotiationBadge({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <span className="inline-flex items-center rounded-full bg-yellow-100 px-2.5 py-1 text-xs font-semibold text-yellow-900 ring-1 ring-inset ring-yellow-200">
      Negotiating
    </span>
  );
}

function getRowVisual(j: ContractJob) {
  const isLocked = Boolean(j.price_accepted_at) || j.final_price != null;
  const needsBoth = Boolean((j as any).negotiation_occurred || (j as any).hasNegotiation);
  const adminAccepted = Boolean((j as any).admin_accepted_at || (j as any).adminAccepted);
  const empAccepted = Boolean((j as any).employee_accepted_at || (j as any).employeeAccepted);
  const oneSideAccepted = !isLocked && Boolean(j.price_offer != null) && (adminAccepted !== empAccepted) && needsBoth;
  const negotiating = !isLocked && Boolean(j.price_offer != null) && needsBoth;

  // Priority: cancelled > completed > one-side accepted > negotiating > default
  if (j.status === "cancelled") return { row: "bg-red-50/70 hover:bg-red-50", negotiatingBadge: false };
  if (j.status === "completed") return { row: "bg-green-50/50 hover:bg-green-50", negotiatingBadge: false };
  if (oneSideAccepted) return { row: "bg-emerald-50/70 hover:bg-emerald-50", negotiatingBadge: true };
  if (negotiating) return { row: "bg-yellow-50/70 hover:bg-yellow-50", negotiatingBadge: true };
  return { row: "hover:bg-black/[0.02]", negotiatingBadge: false };
}

function AdminJobCard({
  job,
  onOpen,
  onCancel
}: {
  job: ContractJob;
  onOpen(): void;
  onCancel(): void;
}) {
  const vis = getRowVisual(job);
  const isLocked = Boolean(job.price_accepted_at) || job.final_price != null;
  const needsBoth = Boolean((job as any).negotiation_occurred || (job as any).hasNegotiation);
  const showNegotiation = !isLocked && Boolean(job.price_offer != null) && needsBoth;
  return (
    <button
      type="button"
      className={[
        "w-full rounded-2xl border border-black/10 bg-white p-4 text-left shadow-soft transition",
        "active:scale-[0.99]",
        vis.row
      ].join(" ")}
      onClick={onOpen}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <div className="text-sm font-bold">Job #{job.id}</div>
            <JobStatusBadge status={job.status} />
            <PaidFlagBadge paid={Boolean(job.paid_flag)} />
            <NegotiationBadge show={showNegotiation || vis.negotiatingBadge} />
          </div>
          <div className="mt-1 text-xs font-semibold text-black/60">
            {job.contract_employee_name || `Employee #${job.contract_employee_id}`}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className="text-xs font-semibold text-black/50">Price</div>
          <div className="text-sm font-bold tabular-nums">
            {job.final_price != null ? formatMoney(job.final_price) : job.price_offer != null ? formatMoney(job.price_offer) : "—"}
          </div>
        </div>
      </div>

      <div className="mt-3 text-sm text-black/70">
        <div className="line-clamp-3">{(job.description || "").trim() || "—"}</div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <Button variant="secondary" className="w-full" onClick={(e) => (e.stopPropagation(), onOpen())}>
          View
        </Button>
        {job.status !== "cancelled" ? (
          <Button
            variant="danger"
            className="w-full"
            onClick={(e) => {
              e.stopPropagation();
              onCancel();
            }}
          >
            Cancel
          </Button>
        ) : (
          <div className="flex min-h-11 items-center justify-center rounded-xl border border-black/10 bg-black/[0.02] text-xs font-semibold text-black/45">
            Cancelled
          </div>
        )}
      </div>
    </button>
  );
}

export function AdminJobsPage() {
  const toast = useToast();
  const nav = useNavigate();
  const [loading, setLoading] = useState(true);
  const [jobs, setJobs] = useState<ContractJob[]>([]);
  const [summary, setSummary] = useState<AdminJobsSummary | null>(null);
  const [statusFilter, setStatusFilter] = useState<"active" | "all" | "pending" | "in_progress" | "completed">("active");
  const [assignOpen, setAssignOpen] = useState(false);
  const [employees, setEmployees] = useState<ContractEmployeeListItem[]>([]);
  const [assignEmployeeId, setAssignEmployeeId] = useState<string>("");
  const [assignEmployeeQuery, setAssignEmployeeQuery] = useState("");
  const [assignEmployeeDropdownOpen, setAssignEmployeeDropdownOpen] = useState(false);
  const [assignDesc, setAssignDesc] = useState("");
  const [assignPrice, setAssignPrice] = useState("");
  const [assignImageFile, setAssignImageFile] = useState<File | null>(null);
  const [assigning, setAssigning] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<ContractJob | null>(null);
  const [cancelNote, setCancelNote] = useState("");
  const [cancelling, setCancelling] = useState(false);

  usePageHeader({
    title: "Jobs",
    subtitle: "All contract jobs across all employees."
  });

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      try {
        const [s, j] = await Promise.all([contractJobsApi.summaryAdmin(), contractJobsApi.listAdmin()]);
        if (!alive) return;
        setSummary(s);
        setJobs(Array.isArray(j) ? j : []);
      } catch (e) {
        toast.push("error", getErrorMessage(e));
        if (!alive) return;
        setSummary(null);
        setJobs([]);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [toast]);

  async function refresh() {
    const [s, j] = await Promise.all([contractJobsApi.summaryAdmin(), contractJobsApi.listAdmin()]);
    setSummary(s);
    setJobs(Array.isArray(j) ? j : []);
  }

  useEffect(() => {
    if (!assignOpen) return;
    let alive = true;
    (async () => {
      try {
        const list = await contractEmployeesApi.list({ status: "active" });
        if (!alive) return;
        setEmployees(Array.isArray(list) ? list : []);
      } catch {
        if (!alive) return;
        setEmployees([]);
      }
    })();
    return () => {
      alive = false;
    };
  }, [assignOpen]);

  const rows = useMemo(() => {
    if (statusFilter === "all") return jobs;
    if (statusFilter === "active") return jobs.filter((j) => j.status === "pending" || j.status === "in_progress");
    return jobs.filter((j) => j.status === statusFilter);
  }, [jobs, statusFilter]);

  const assignEmpSelected = useMemo(() => {
    const id = Number(assignEmployeeId);
    if (!Number.isFinite(id) || id <= 0) return null;
    return employees.find((e) => Number(e.id) === id) || null;
  }, [assignEmployeeId, employees]);

  const assignEmpDebouncedQuery = useDebouncedValue(assignEmployeeQuery, 160);
  const assignEmpSuggestions = useMemo(() => {
    const q = (assignEmpDebouncedQuery || "").trim().toLowerCase();
    if (!q) return [];
    const starts: ContractEmployeeListItem[] = [];
    const partial: ContractEmployeeListItem[] = [];
    for (const e of employees) {
      const name = String(e.full_name || "").trim();
      const hay = name.toLowerCase();
      if (!hay) continue;
      if (hay.startsWith(q)) starts.push(e);
      else if (hay.includes(q)) partial.push(e);
    }
    const out = [...starts, ...partial];
    return out.slice(0, 12);
  }, [assignEmpDebouncedQuery, employees]);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Card className="!p-4">
          <div className="text-xs font-semibold text-black/55">Jobs summary</div>
          <div className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <div className="rounded-xl border border-black/10 bg-black/[0.02] p-3">
              <div className="text-xs font-semibold text-black/60">Total jobs</div>
              <div className="mt-1 text-lg font-bold tabular-nums">{summary?.jobs.total ?? 0}</div>
            </div>
            <div className="rounded-xl border border-black/10 bg-black/[0.02] p-3">
              <div className="text-xs font-semibold text-black/60">Completed</div>
              <div className="mt-1 text-lg font-bold tabular-nums">{summary?.jobs.completed ?? 0}</div>
            </div>
            <div className="rounded-xl border border-black/10 bg-black/[0.02] p-3">
              <div className="text-xs font-semibold text-black/60">Pending</div>
              <div className="mt-1 text-lg font-bold tabular-nums">{summary?.jobs.pending ?? 0}</div>
            </div>
            <div className="rounded-xl border border-black/10 bg-black/[0.02] p-3">
              <div className="text-xs font-semibold text-black/60">In progress</div>
              <div className="mt-1 text-lg font-bold tabular-nums">{summary?.jobs.in_progress ?? 0}</div>
            </div>
          </div>
        </Card>

        <Card className="!p-4">
          <div className="text-xs font-semibold text-black/55">Contract employees financial summary</div>
          <div className="mt-3 grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
            <div className="rounded-xl border border-black/10 bg-black/[0.02] p-3">
              <div className="text-xs font-semibold text-black/60">Total paid</div>
              <div className="mt-1 text-lg font-bold tabular-nums">{formatMoney(summary?.financials.total_paid ?? 0)}</div>
            </div>
            <div className="rounded-xl border border-black/10 bg-black/[0.02] p-3">
              <div className="text-xs font-semibold text-black/60">Total owed</div>
              <div className="mt-1 text-lg font-bold tabular-nums">{formatMoney(summary?.financials.total_owed ?? 0)}</div>
            </div>
            <div className="rounded-xl border border-black/10 bg-black/[0.02] p-3">
              <div className="text-xs font-semibold text-black/60">Current balance</div>
              <div className="mt-1 text-lg font-bold tabular-nums">{formatMoney(summary?.financials.balance ?? 0)}</div>
            </div>
          </div>
          <div className="mt-2 text-xs text-black/50">Balance \(=\) owed − paid. Positive means the company owes contract employees.</div>
        </Card>
      </div>

      <Card className="!p-0 overflow-hidden">
        <div className="border-b border-black/10 px-4 py-3">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <div className="text-sm font-semibold">All jobs</div>
              <div className="mt-0.5 text-xs text-black/55">Click a row to view full job details.</div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => void refresh().catch(() => null)}>
                Refresh
              </Button>
              <Button onClick={() => setAssignOpen(true)}>Assign job</Button>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <div className="inline-flex rounded-2xl border border-black/10 bg-white p-1">
              {(
                [
                  ["active", "Pending + In Progress"],
                  ["pending", "Pending"],
                  ["in_progress", "In Progress"],
                  ["completed", "Completed"],
                  ["all", "All"]
                ] as const
              ).map(([k, label]) => (
                <button
                  key={k}
                  type="button"
                  className={[
                    "min-h-9 rounded-xl px-3 text-xs font-semibold transition",
                    statusFilter === k ? "bg-black text-white" : "text-black/70 hover:bg-black/5"
                  ].join(" ")}
                  onClick={() => setStatusFilter(k)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {loading ? <div className="px-4 py-4 text-sm text-black/60">Loading…</div> : null}

        {!loading && rows.length === 0 ? <div className="px-4 py-4 text-sm text-black/60">No jobs found.</div> : null}

        {!loading && rows.length > 0 ? (
          <>
            {/* Mobile: cards to avoid horizontal scrolling */}
            <div className="block space-y-3 p-4 md:hidden">
              {rows.map((j) => (
                <AdminJobCard
                  key={j.id}
                  job={j}
                  onOpen={() => nav(`/admin/jobs/${j.id}`)}
                  onCancel={() => {
                    setCancelTarget(j);
                    setCancelNote("");
                    setCancelOpen(true);
                  }}
                />
              ))}
            </div>

            {/* Desktop: preserve existing table layout */}
            <div className="hidden overflow-x-touch md:block">
              <table className="w-full min-w-[980px] text-left text-sm">
                <thead className="bg-black/[0.02] text-xs font-semibold text-black/60">
                  <tr>
                    <th className="px-4 py-3">Job</th>
                    <th className="px-4 py-3">Description</th>
                    <th className="px-4 py-3">Employee</th>
                    <th className="px-4 py-3">Negotiation</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Price</th>
                    <th className="px-4 py-3">Payment</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-black/10">
                  {rows.map((j) => {
                    const vis = getRowVisual(j);
                    const isLocked = Boolean(j.price_accepted_at) || j.final_price != null;
                    const needsBoth = Boolean((j as any).negotiation_occurred || (j as any).hasNegotiation);
                    const showNegotiation = !isLocked && Boolean(j.price_offer != null) && needsBoth;
                    return (
                      <tr
                        key={j.id}
                        className={["cursor-pointer", vis.row].join(" ")}
                        onClick={() => nav(`/admin/jobs/${j.id}`)}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") nav(`/admin/jobs/${j.id}`);
                        }}
                      >
                        <td className="px-4 py-3 font-semibold">#{j.id}</td>
                        <td className="px-4 py-3 text-black/70">
                          <div className="line-clamp-2">{(j.description || "").trim() || "—"}</div>
                        </td>
                        <td className="px-4 py-3">{j.contract_employee_name || `Employee #${j.contract_employee_id}`}</td>
                        <td className="px-4 py-3">
                          <NegotiationBadge show={showNegotiation || vis.negotiatingBadge} />
                        </td>
                        <td className="px-4 py-3">
                          <JobStatusBadge status={j.status} />
                        </td>
                        <td className="px-4 py-3 font-semibold tabular-nums">
                          {j.final_price != null ? formatMoney(j.final_price) : j.price_offer != null ? formatMoney(j.price_offer) : "—"}
                        </td>
                        <td className="px-4 py-3">
                          <PaidFlagBadge paid={Boolean(j.paid_flag)} />
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="inline-flex justify-end gap-2">
                            {j.status !== "cancelled" ? (
                              <Button
                                variant="danger"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setCancelTarget(j);
                                  setCancelNote("");
                                  setCancelOpen(true);
                                }}
                              >
                                Cancel
                              </Button>
                            ) : (
                              <span className="text-xs font-semibold text-black/45">—</span>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        ) : null}
      </Card>

      <Modal open={assignOpen} title="Assign job" onClose={() => (assigning ? null : setAssignOpen(false))}>
        <div className="space-y-3">
          <div className="relative">
            <Input
              label={
                <span>
                  Assign to employee <span className="text-red-600">*</span>
                </span>
              }
              value={assignEmployeeQuery}
              onChange={(e) => {
                setAssignEmployeeQuery(e.target.value);
                setAssignEmployeeDropdownOpen(true);
                // If they edit after selecting, clear the selection.
                if (assignEmployeeId) setAssignEmployeeId("");
              }}
              placeholder="Search employee…"
              onFocus={() => setAssignEmployeeDropdownOpen(true)}
              onBlur={() => {
                // Allow click selection before closing.
                window.setTimeout(() => setAssignEmployeeDropdownOpen(false), 120);
              }}
            />

            {assignEmpSelected ? (
              <div className="mt-1 text-xs font-semibold text-black/60">
                Selected: <span className="text-black">{assignEmpSelected.full_name}</span> (#{assignEmpSelected.id})
              </div>
            ) : null}

            {assignEmployeeDropdownOpen && assignEmpSuggestions.length > 0 ? (
              <div className="absolute z-50 mt-2 w-full overflow-hidden rounded-2xl border border-black/10 bg-white shadow-soft">
                <div className="max-h-72 overflow-auto p-1">
                  {assignEmpSuggestions.map((e) => (
                    <button
                      key={e.id}
                      type="button"
                      className="w-full rounded-xl px-3 py-2 text-left text-sm font-semibold text-black/80 hover:bg-black/5"
                      onMouseDown={(ev) => ev.preventDefault()}
                      onClick={() => {
                        setAssignEmployeeId(String(e.id));
                        setAssignEmployeeQuery(String(e.full_name || "").trim());
                        setAssignEmployeeDropdownOpen(false);
                      }}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0 truncate">{e.full_name}</div>
                        <div className="shrink-0 text-xs font-semibold text-black/45">#{e.id}</div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
          <label className="text-xs font-semibold text-black/60">
            Description <span className="text-red-600">*</span>
            <textarea
              className="mt-1 w-full rounded-xl border border-black/15 bg-white px-3 py-2.5 text-sm font-semibold min-h-[96px]"
              value={assignDesc}
              onChange={(e) => setAssignDesc(e.target.value)}
              placeholder="Describe the job…"
            />
          </label>
          <Input
            label="Price offer (optional)"
            value={assignPrice}
            onChange={(e) => setAssignPrice(e.target.value)}
            inputMode="decimal"
            placeholder="0"
          />
          <label className="text-xs font-semibold text-black/60">
            Image (optional)
            <input
              className="mt-1 w-full rounded-xl border border-black/15 bg-white px-3 py-2.5 text-sm font-semibold"
              type="file"
              accept="image/*"
              onChange={(e) => setAssignImageFile((e.target.files && e.target.files[0]) || null)}
            />
          </label>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" disabled={assigning} onClick={() => setAssignOpen(false)}>
              Cancel
            </Button>
            <Button
              isLoading={assigning}
              onClick={() => {
                const empId = Number(assignEmployeeId);
                if (!Number.isFinite(empId) || empId <= 0) {
                  toast.push("error", "Select an employee.");
                  return;
                }
                if (!assignDesc.trim()) {
                  toast.push("error", "Description is required.");
                  return;
                }
                if (assignPrice.trim() && !isValidThousandsCommaNumber(assignPrice)) {
                  toast.push("error", "Fix comma formatting in amount.");
                  return;
                }
                const offer = assignPrice.trim() ? parseMoneyInput(assignPrice) : null;
                if (assignPrice.trim() && (offer === null || Number.isNaN(offer) || offer <= 0)) {
                  toast.push("error", "Enter a valid offer (> 0) or leave it blank.");
                  return;
                }
                setAssigning(true);
                void (async () => {
                  let imageUrl: string | null = null;
                  if (assignImageFile) {
                    const up = await contractJobsApi.uploadImage(assignImageFile);
                    imageUrl = up.image_url;
                  }
                  await contractJobsApi.createAdmin({
                    contract_employee_id: empId,
                    description: assignDesc.trim(),
                    image_url: imageUrl || undefined,
                    price_offer: offer ?? undefined
                  });
                })()
                  .then(() => refresh())
                  .then(() => {
                    setAssignEmployeeId("");
                    setAssignEmployeeQuery("");
                    setAssignDesc("");
                    setAssignPrice("");
                    setAssignImageFile(null);
                    setAssignOpen(false);
                    toast.push("success", "Job assigned.");
                  })
                  .catch((e) => toast.push("error", getErrorMessage(e)))
                  .finally(() => setAssigning(false));
              }}
            >
              Assign
            </Button>
          </div>
        </div>
      </Modal>

      <Modal open={cancelOpen} title={cancelTarget ? `Cancel job (Job #${cancelTarget.id})` : "Cancel job"} onClose={() => (cancelling ? null : setCancelOpen(false))}>
        <div className="space-y-3">
          <div className="text-sm text-black/70">Provide a cancellation reason (required). This will notify the other party.</div>
          <Input label="Reason" value={cancelNote} onChange={(e) => setCancelNote(e.target.value)} placeholder="Reason…" />
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="ghost" disabled={cancelling} onClick={() => setCancelOpen(false)}>
              Back
            </Button>
            <Button
              variant="danger"
              isLoading={cancelling}
              onClick={() => {
                if (!cancelTarget) return;
                if (!cancelNote.trim()) {
                  toast.push("error", "Reason is required.");
                  return;
                }
                setCancelling(true);
                void contractJobsApi
                  .cancel(cancelTarget.id, { note: cancelNote.trim() })
                  .then(() => refresh())
                  .then(() => toast.push("success", "Job cancelled."))
                  .then(() => setCancelOpen(false))
                  .catch((e) => toast.push("error", getErrorMessage(e)))
                  .finally(() => setCancelling(false));
              }}
            >
              Confirm cancel
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

function useDebouncedValue<T>(value: T, delayMs: number) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setV(value), delayMs);
    return () => window.clearTimeout(t);
  }, [value, delayMs]);
  return v;
}

