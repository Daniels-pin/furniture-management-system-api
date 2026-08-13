import { parseMoneyInput, sanitizeMoneyInput } from "./moneyInput";

export type AllocJobRow = {
  id: number;
  status: string;
  final_price?: string | number | null;
  amount_paid: string | number;
  balance?: string | number | null;
};

export type LinkedJobPreview = {
  id: number;
  status: string;
  final_price?: string | number | null;
};

export function toAllocFiniteNumber(x: unknown): number | null {
  if (typeof x === "number") return Number.isFinite(x) ? x : null;
  if (typeof x === "string") {
    const n = Number(sanitizeMoneyInput(x));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export function mergeAllocJobRows(
  financeJobs: AllocJobRow[],
  linkedJobs: LinkedJobPreview[],
  linkedJobIds: number[]
): AllocJobRow[] {
  const byId = new Map<number, AllocJobRow>();
  for (const j of financeJobs) {
    byId.set(j.id, j);
  }
  for (const j of linkedJobs) {
    if (byId.has(j.id)) continue;
    const fp = toAllocFiniteNumber(j.final_price);
    byId.set(j.id, {
      id: j.id,
      status: j.status,
      final_price: j.final_price ?? null,
      amount_paid: 0,
      balance: fp
    });
  }
  for (const jobId of linkedJobIds) {
    if (jobId <= 0 || byId.has(jobId)) continue;
    byId.set(jobId, {
      id: jobId,
      status: "linked",
      final_price: null,
      amount_paid: 0,
      balance: null
    });
  }
  return Array.from(byId.values()).sort((a, b) => b.id - a.id);
}

export function collectLinkedJobIds(
  linkedJobs: Array<{ id: number }> | null | undefined,
  contractJobId?: number | null
): number[] {
  const ids: number[] = [];
  const seen = new Set<number>();
  for (const j of linkedJobs ?? []) {
    if (j.id > 0 && !seen.has(j.id)) {
      seen.add(j.id);
      ids.push(j.id);
    }
  }
  if (contractJobId && contractJobId > 0 && !seen.has(contractJobId)) {
    ids.push(contractJobId);
  }
  return ids;
}

export function filterActiveAllocJobs(jobs: AllocJobRow[], linkedJobIds: number[]): AllocJobRow[] {
  const linkedSet = new Set(linkedJobIds);
  return jobs.filter((j) => {
    if (j.status === "cancelled") return false;
    if (linkedSet.has(j.id)) return true;
    const bal = toAllocFiniteNumber(j.balance);
    if (bal === null) return false;
    if (bal <= 0) return false;
    return true;
  });
}

export function sumAllocationLines(allocLines: Record<number, string>): number {
  let total = 0;
  for (const raw of Object.values(allocLines)) {
    const n = parseMoneyInput(raw);
    if (n !== null && !Number.isNaN(n)) total += n;
  }
  return total;
}

export function computeAllocationSummary(allocLines: Record<number, string>, paymentAmountRaw: string) {
  const selectedTotal = sumAllocationLines(allocLines);
  const paymentAmount = parseMoneyInput(paymentAmountRaw);
  const paymentTotal = paymentAmount === null || Number.isNaN(paymentAmount) ? 0 : paymentAmount;
  const remaining = paymentTotal - selectedTotal;
  return { selectedTotal, paymentTotal, remaining };
}

export function buildAllocationPayload(allocLines: Record<number, string>) {
  return Object.entries(allocLines)
    .map(([jobId, amt]) => ({ contract_job_id: Number(jobId), amount: amt }))
    .filter((x) => x.contract_job_id > 0)
    .map((x) => ({
      contract_job_id: x.contract_job_id,
      amount: String(x.amount ?? "").replaceAll(",", "").trim()
    }))
    .filter((x) => x.amount);
}

export function clampAllocationInput(
  raw: string,
  maxBalance: unknown,
  currentLines: Record<number, string>,
  jobId: number
) {
  const n = parseMoneyInput(raw);
  if (n !== null && !Number.isNaN(n)) {
    const max = toAllocFiniteNumber(maxBalance);
    if (max !== null) {
      const clamped = Math.max(0, Math.min(n, max));
      return { ...currentLines, [jobId]: String(clamped) };
    }
  }
  return { ...currentLines, [jobId]: raw };
}
