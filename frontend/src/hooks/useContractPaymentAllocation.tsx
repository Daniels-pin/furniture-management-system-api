import { useCallback, useEffect, useMemo, useState } from "react";
import { contractEmployeesApi, employeePaymentsApi } from "../services/endpoints";
import { getErrorMessage } from "../services/api";
import type { PendingEmployeePaymentItem } from "../types/api";
import { parseMoneyInput } from "../utils/moneyInput";
import {
  buildAllocationPayload,
  clampAllocationInput,
  collectLinkedJobIds,
  filterActiveAllocJobs,
  mergeAllocJobRows,
  type AllocJobRow,
  type LinkedJobPreview,
  toAllocFiniteNumber
} from "../utils/paymentAllocation";
import { getPendingLinkedJobIds, pendingPaymentNeedsAllocationModal } from "../utils/pendingPaymentMarkPaid";
import { ContractPaymentAllocationModal } from "../components/finance/ContractPaymentAllocationModal";

type AuthSlice = { role: string | null | undefined; isAdmin: boolean };

type Options = {
  auth: AuthSlice;
  busyId: number | null;
  setBusyId: (id: number | null) => void;
  onMarkedPaid: () => Promise<void>;
  onError: (message: string) => void;
};

type OpenArgs = {
  transactionId: number;
  employeeId: number;
  employeeName: string;
  amount: string | number;
  linkedJobs?: LinkedJobPreview[];
  linkedJobIds?: number[];
  contractJobId?: number | null;
  receiptUrl?: string | null;
};

export function useContractPaymentAllocation({
  auth,
  busyId,
  setBusyId,
  onMarkedPaid,
  onError
}: Options) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [transactionId, setTransactionId] = useState<number | null>(null);
  const [employeeName, setEmployeeName] = useState("");
  const [paymentAmount, setPaymentAmount] = useState("");
  const [jobs, setJobs] = useState<AllocJobRow[]>([]);
  const [allocLines, setAllocLines] = useState<Record<number, string>>({});
  const [linkedJobIds, setLinkedJobIds] = useState<number[]>([]);
  const [linkedJobsPreview, setLinkedJobsPreview] = useState<LinkedJobPreview[]>([]);
  const [confirmWithoutReceipt, setConfirmWithoutReceipt] = useState(false);
  const [overpayConfirm, setOverpayConfirm] = useState(false);

  const activeJobs = useMemo(() => filterActiveAllocJobs(jobs, linkedJobIds), [jobs, linkedJobIds]);

  const reset = useCallback(() => {
    setOpen(false);
    setLoading(false);
    setTransactionId(null);
    setEmployeeName("");
    setPaymentAmount("");
    setJobs([]);
    setAllocLines({});
    setLinkedJobIds([]);
    setLinkedJobsPreview([]);
    setConfirmWithoutReceipt(false);
    setOverpayConfirm(false);
  }, []);

  const openForPayment = useCallback((args: OpenArgs) => {
    const ids = args.linkedJobIds ?? collectLinkedJobIds(args.linkedJobs, args.contractJobId);
    setTransactionId(args.transactionId);
    setEmployeeName(args.employeeName);
    setPaymentAmount(String(args.amount ?? ""));
    setLinkedJobIds(ids);
    setLinkedJobsPreview(args.linkedJobs ?? []);
    setAllocLines({});
    setJobs([]);
    setConfirmWithoutReceipt(auth.isAdmin && !args.receiptUrl?.trim());
    setOverpayConfirm(false);
    setOpen(true);
    setLoading(true);

    void contractEmployeesApi
      .finances(args.employeeId)
      .then((d) => {
        const financeJobs = Array.isArray(d?.jobs) ? d.jobs : [];
        setJobs(mergeAllocJobRows(financeJobs, args.linkedJobs ?? [], ids));
        const primaryLinkedId = ids[0];
        if (primaryLinkedId) {
          const pay = parseMoneyInput(String(args.amount ?? ""));
          const payAmount = pay === null || Number.isNaN(pay) ? 0 : pay;
          setAllocLines({ [primaryLinkedId]: payAmount > 0 ? String(payAmount) : "" });
        }
      })
      .catch((er) => {
        setJobs(mergeAllocJobRows([], args.linkedJobs ?? [], ids));
        onError(getErrorMessage(er));
      })
      .finally(() => setLoading(false));
  }, [auth.isAdmin, onError]);

  const openFromPendingItem = useCallback(
    (item: PendingEmployeePaymentItem) => {
      const tx = item.transaction;
      openForPayment({
        transactionId: tx.id,
        employeeId: item.employee_id,
        employeeName: item.employee_name,
        amount: tx.amount,
        linkedJobIds: getPendingLinkedJobIds(item),
        contractJobId: tx.contract_job_id,
        receiptUrl: tx.receipt_url
      });
    },
    [openForPayment]
  );

  const beginMarkPaidFromPendingItem = useCallback(
    (
      item: PendingEmployeePaymentItem,
      openConfirm: (target: { id: number; kind: "monthly" | "contract" }) => void
    ) => {
      const tx = item.transaction;
      if (item.employee_kind === "contract" && pendingPaymentNeedsAllocationModal(item)) {
        openFromPendingItem(item);
        return;
      }
      openConfirm({ id: tx.id, kind: item.employee_kind });
    },
    [openFromPendingItem]
  );

  useEffect(() => {
    if (!open) return;
    if (loading) return;
    if (Object.keys(allocLines).length > 0) return;
    if (activeJobs.length === 0) return;

    const pay = parseMoneyInput(paymentAmount);
    const payAmount = pay === null || Number.isNaN(pay) ? 0 : pay;

    let chosenIdx = 0;
    let chosenBal = toAllocFiniteNumber(activeJobs[0]?.balance) ?? Number.POSITIVE_INFINITY;
    for (let i = 1; i < activeJobs.length; i++) {
      const bal = toAllocFiniteNumber(activeJobs[i]?.balance);
      if (bal === null) continue;
      if (bal < chosenBal) {
        chosenBal = bal;
        chosenIdx = i;
      }
    }
    const chosen = activeJobs[chosenIdx];
    const remaining = toAllocFiniteNumber(chosen.balance) ?? 0;
    const autoAlloc = Math.max(0, Math.min(payAmount, remaining));
    setAllocLines({ [chosen.id]: autoAlloc > 0 ? String(autoAlloc) : "" });
  }, [open, loading, activeJobs, paymentAmount, allocLines]);

  const toggleJob = useCallback((jobId: number, checked: boolean) => {
    setAllocLines((prev) => {
      const next = { ...prev };
      if (checked) next[jobId] = next[jobId] ?? "";
      else delete next[jobId];
      return next;
    });
  }, []);

  const changeAllocation = useCallback((jobId: number, raw: string, maxBalance: unknown) => {
    setAllocLines((prev) => clampAllocationInput(raw, maxBalance, prev, jobId));
  }, []);

  const confirmAllocation = useCallback(() => {
    if (!transactionId) return;
    const cleanedAllocations = buildAllocationPayload(allocLines);
    setBusyId(transactionId);
    void employeePaymentsApi
      .markPaid(
        transactionId,
        confirmWithoutReceipt || overpayConfirm
          ? {
              confirm_without_receipt: confirmWithoutReceipt ? true : undefined,
              confirm_overpay: overpayConfirm ? true : undefined
            }
          : undefined,
        {
          amount_override: paymentAmount?.trim() ? paymentAmount.replaceAll(",", "").trim() : null,
          allocations: cleanedAllocations
        }
      )
      .then(() => onMarkedPaid())
      .then(() => reset())
      .catch((er: any) => {
        const detail = er?.response?.data?.detail;
        if (detail?.code === "OVERPAY_CONFIRM_REQUIRED") {
          setOverpayConfirm(true);
          return;
        }
        onError(getErrorMessage(er));
      })
      .finally(() => setBusyId(null));
  }, [
    allocLines,
    confirmWithoutReceipt,
    onError,
    onMarkedPaid,
    overpayConfirm,
    paymentAmount,
    reset,
    setBusyId,
    transactionId
  ]);

  const modal = (
    <ContractPaymentAllocationModal
      open={open}
      onClose={reset}
      employeeName={employeeName}
      paymentAmount={paymentAmount}
      onPaymentAmountChange={setPaymentAmount}
      linkedJobsPreview={linkedJobsPreview}
      linkedJobIds={linkedJobIds}
      activeJobs={activeJobs}
      loading={loading}
      allocLines={allocLines}
      onToggleJob={toggleJob}
      onAllocationChange={changeAllocation}
      onConfirm={confirmAllocation}
      busy={busyId !== null}
      busyId={busyId}
      transactionId={transactionId}
    />
  );

  return {
    modal,
    open,
    openForPayment,
    openFromPendingItem,
    beginMarkPaidFromPendingItem,
    reset
  };
}
