import React, { useEffect, useMemo } from "react";

export function ImageLightbox({
  open,
  title,
  images,
  index,
  onIndexChange,
  onClose
}: {
  open: boolean;
  title?: string;
  images: string[];
  index: number;
  onIndexChange(nextIndex: number): void;
  onClose(): void;
}) {
  const safeImages = useMemo(() => images.filter(Boolean), [images]);
  const safeIndex = Math.min(Math.max(0, index), Math.max(0, safeImages.length - 1));
  const src = safeImages[safeIndex] || "";

  const canPrev = safeImages.length > 1 && safeIndex > 0;
  const canNext = safeImages.length > 1 && safeIndex < safeImages.length - 1;

  useEffect(() => {
    if (!open) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft" && canPrev) onIndexChange(safeIndex - 1);
      if (e.key === "ArrowRight" && canNext) onIndexChange(safeIndex + 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, onIndexChange, safeIndex, canPrev, canNext]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50">
      <button
        type="button"
        className="absolute inset-0 bg-black/70"
        aria-label="Close image preview"
        onClick={onClose}
      />

      <div className="relative mx-auto flex h-[100dvh] w-[min(1200px,calc(100vw-1.5rem))] flex-col py-4">
        <div className="mx-auto flex w-full items-center justify-between gap-3 rounded-2xl border border-white/10 bg-black/60 px-4 py-3 backdrop-blur">
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-white/90">{title || "Image preview"}</div>
            {safeImages.length > 1 ? (
              <div className="mt-0.5 text-xs font-semibold text-white/70">
                {safeIndex + 1} of {safeImages.length}
              </div>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {safeImages.length > 1 ? (
              <>
                <button
                  type="button"
                  className="rounded-xl px-3 py-1.5 text-sm font-semibold text-white/85 hover:bg-white/10 disabled:opacity-40"
                  onClick={() => onIndexChange(safeIndex - 1)}
                  disabled={!canPrev}
                >
                  Prev
                </button>
                <button
                  type="button"
                  className="rounded-xl px-3 py-1.5 text-sm font-semibold text-white/85 hover:bg-white/10 disabled:opacity-40"
                  onClick={() => onIndexChange(safeIndex + 1)}
                  disabled={!canNext}
                >
                  Next
                </button>
              </>
            ) : null}
            <button
              type="button"
              className="rounded-xl px-3 py-1.5 text-sm font-semibold text-white/85 hover:bg-white/10"
              onClick={onClose}
            >
              Close
            </button>
          </div>
        </div>

        <div className="mt-3 min-h-0 w-full flex-1 overflow-auto rounded-3xl border border-white/10 bg-black shadow-soft">
          <div className="flex min-h-full items-center justify-center p-3">
            <img
              src={src}
              alt="Preview"
              className="max-h-[calc(100dvh-10rem)] w-auto max-w-full object-contain"
              draggable={false}
            />
          </div>
        </div>

        {safeImages.length > 1 ? (
          <div className="mt-3 flex w-full gap-2 overflow-x-auto pb-1">
            {safeImages.map((u, i) => (
              <button
                key={`${u}-${i}`}
                type="button"
                onClick={() => onIndexChange(i)}
                className={[
                  "shrink-0 overflow-hidden rounded-2xl border bg-black/40",
                  i === safeIndex ? "border-white/60" : "border-white/10 hover:border-white/30"
                ].join(" ")}
                aria-label={`Preview image ${i + 1}`}
              >
                <img src={u} alt="" className="h-16 w-24 object-cover" draggable={false} />
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

