import { useEffect } from "react";
import { Button } from "../ui/Button";
import type { AttendanceResultFeedback } from "../../utils/attendance";

type Props = {
  feedback: AttendanceResultFeedback | null;
  onConfirm: () => void;
};

const variantStyles = {
  success: {
    icon: "✓",
    iconBg: "bg-emerald-100 text-emerald-900",
    title: "text-emerald-950"
  },
  error: {
    icon: "!",
    iconBg: "bg-red-100 text-red-900",
    title: "text-red-950"
  },
  info: {
    icon: "i",
    iconBg: "bg-amber-100 text-amber-900",
    title: "text-amber-950"
  }
} as const;

export function AttendanceResultModal({ feedback, onConfirm }: Props) {
  const open = feedback !== null;

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (!feedback) return null;

  const styles = variantStyles[feedback.variant];

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4 pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))]"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="attendance-result-title"
      aria-describedby="attendance-result-message"
    >
      <div className="absolute inset-0 bg-black/50" aria-hidden />
      <div className="relative w-full max-w-md overflow-hidden rounded-2xl border border-black/10 bg-white shadow-xl">
        <div className="px-5 py-6 text-center sm:px-6 sm:py-7">
          <div
            className={[
              "mx-auto flex h-14 w-14 items-center justify-center rounded-full text-2xl font-bold",
              styles.iconBg
            ].join(" ")}
            aria-hidden
          >
            {styles.icon}
          </div>
          <h2 id="attendance-result-title" className={["mt-4 text-lg font-bold tracking-tight", styles.title].join(" ")}>
            {feedback.title}
          </h2>
          <p id="attendance-result-message" className="mt-3 text-sm leading-relaxed text-black/75">
            {feedback.message}
          </p>
          <Button type="button" className="mt-6 w-full sm:w-auto sm:min-w-[8rem]" onClick={onConfirm}>
            OK
          </Button>
        </div>
      </div>
    </div>
  );
}
