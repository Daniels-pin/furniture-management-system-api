import type { PendingEmployeePaymentItem } from "../types/api";

export function collectLinkedJobIdsFromTransaction(tx: {
  contract_job_id?: number | null;
  allocations?: Array<{ contract_job_id: number }> | null;
}): number[] {
  const ids: number[] = [];
  const seen = new Set<number>();
  const directId = tx.contract_job_id;
  if (directId && directId > 0 && !seen.has(directId)) {
    seen.add(directId);
    ids.push(directId);
  }
  for (const allocation of tx.allocations ?? []) {
    const jobId = allocation.contract_job_id;
    if (jobId > 0 && !seen.has(jobId)) {
      seen.add(jobId);
      ids.push(jobId);
    }
  }
  return ids;
}

export function getPendingLinkedJobIds(item: PendingEmployeePaymentItem): number[] {
  if (item.linked_job_ids?.length) return item.linked_job_ids;
  return collectLinkedJobIdsFromTransaction(item.transaction);
}

export function isPendingPaymentFinalizable(status: string): boolean {
  return status === "sent_to_finance" || status === "pending";
}

export type MarkPaidDisabledReason = "receipt" | "requirements" | null;

export function getPendingMarkPaidDisabledReason(
  item: PendingEmployeePaymentItem,
  role: string | null | undefined
): MarkPaidDisabledReason {
  const tx = item.transaction;
  if (tx.status === "paid" || tx.status === "cancelled") return "requirements";
  if (!isPendingPaymentFinalizable(tx.status)) return "requirements";

  const isFinance = role === "finance";
  const hasReceipt = Boolean(tx.receipt_url?.trim());
  if (isFinance && !hasReceipt) return "receipt";

  if (item.employee_kind === "contract" && getPendingLinkedJobIds(item).length === 0) {
    return "requirements";
  }

  return null;
}

export function getPendingMarkPaidDisabledTooltip(reason: MarkPaidDisabledReason): string | undefined {
  if (reason === "receipt") {
    return "Upload the payment receipt before marking this payment as paid.";
  }
  if (reason === "requirements") {
    return "Complete all required payment information before marking this payment as paid.";
  }
  return undefined;
}

export function pendingPaymentNeedsAllocationModal(item: PendingEmployeePaymentItem): boolean {
  return item.employee_kind === "contract" && getPendingLinkedJobIds(item).length === 0;
}
