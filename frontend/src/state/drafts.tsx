import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "../components/ui/Button";
import { Modal } from "../components/ui/Modal";
import { draftsApi } from "../services/endpoints";
import type { DraftModule, DraftSummary } from "../types/api";
import { getErrorMessage } from "../services/api";
import { useAuth } from "./auth";
import { useToast } from "./toast";

const RECOVERY_KEY = "furniture_draft_recover_v1";

export function consumeDraftRecoveryIntent(): DraftModule | null {
  try {
    const raw = sessionStorage.getItem(RECOVERY_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(RECOVERY_KEY);
    const parsed = JSON.parse(raw) as { module?: DraftModule } | null;
    const m = parsed?.module;
    if (m === "quotation" || m === "order" || m === "proforma") return m;
    return null;
  } catch {
    sessionStorage.removeItem(RECOVERY_KEY);
    return null;
  }
}

function setDraftRecoveryIntent(module: DraftModule) {
  try {
    sessionStorage.setItem(RECOVERY_KEY, JSON.stringify({ module }));
  } catch {
    // ignore
  }
}

function moduleLabel(m: DraftModule): string {
  if (m === "quotation") return "Quotation";
  if (m === "order") return "Order";
  return "Proforma";
}

function moduleRoute(m: DraftModule): string {
  if (m === "quotation") return "/quotations/new";
  if (m === "proforma") return "/proforma/new";
  return "/orders";
}

export function DraftRecoveryGate({ children }: { children: React.ReactNode }) {
  const auth = useAuth();
  const toast = useToast();
  const nav = useNavigate();

  const [draft, setDraft] = useState<DraftSummary | null>(null);
  const [open, setOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const isAuthed = auth.isAuthed;

  useEffect(() => {
    if (!isAuthed) {
      setDraft(null);
      setOpen(false);
      return;
    }
    if (auth.role === "staff") {
      setDraft(null);
      setOpen(false);
      return;
    }
    let alive = true;
    (async () => {
      setIsLoading(true);
      try {
        const res = await draftsApi.latest({ modules: ["quotation", "order", "proforma"] });
        if (!alive) return;
        if (res.draft) {
          setDraft(res.draft);
          setOpen(true);
        } else {
          setDraft(null);
          setOpen(false);
        }
      } catch (e) {
        // Don't block login; just skip the prompt if drafts fetch fails.
        console.warn("[drafts] latest fetch failed:", e);
      } finally {
        if (alive) setIsLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [isAuthed, auth.role]);

  const title = useMemo(() => {
    if (!draft) return "Unfinished draft";
    return `Unfinished ${moduleLabel(draft.module)}`;
  }, [draft]);

  return (
    <>
      {children}
      <Modal
        open={open && Boolean(draft)}
        title={title}
        onClose={() => {
          // Prevent "click outside" from dismissing without a choice.
        }}
      >
        <div className="space-y-4">
          <div className="text-sm text-black/70">
            {draft ? (
              <>
                You have an unfinished <span className="font-semibold">{moduleLabel(draft.module)}</span>. Do you want to
                continue where you left off?
              </>
            ) : (
              "You have an unfinished draft. Do you want to continue?"
            )}
          </div>
          {draft?.updated_at ? (
            <div className="text-xs font-semibold text-black/40">
              Last saved: {new Date(draft.updated_at).toLocaleString()}
            </div>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button
              variant="secondary"
              disabled={isLoading || !draft}
              onClick={async () => {
                if (!draft) return;
                try {
                  await draftsApi.remove(draft.module);
                  toast.push("success", "Draft discarded");
                } catch (e) {
                  toast.push("error", getErrorMessage(e));
                } finally {
                  setOpen(false);
                  setDraft(null);
                }
              }}
            >
              Discard
            </Button>
            <Button
              isLoading={isLoading}
              disabled={!draft}
              onClick={() => {
                if (!draft) return;
                setDraftRecoveryIntent(draft.module);
                setOpen(false);
                nav(moduleRoute(draft.module), { replace: true });
              }}
            >
              Continue
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}

