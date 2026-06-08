/** Luxury-minimal dashboard surfaces — accent palette: black, green, amber, red */
export const dashboardSurfaces = {
  card: "rounded-xl bg-[var(--surface)] p-5 shadow-soft sm:p-6",
  cardInset: "rounded-xl bg-[var(--surface-muted)] p-5 sm:p-6",
  sectionEyebrow: "text-[11px] font-medium uppercase tracking-[0.1em] text-[var(--text-faint)]",
  sectionTitle: "text-[15px] font-semibold tracking-tight text-[var(--text-primary)]",
  sectionDesc: "mt-0.5 text-[13px] leading-relaxed text-[var(--text-muted)]",
  mutedText: "text-[var(--text-muted)]",
  skeleton: "animate-pulse rounded-md bg-[var(--skeleton)]",
  divider: "border-t border-black/[0.06] dark:border-white/[0.06]",
  link: "text-[13px] font-medium text-[var(--text-primary)] underline-offset-4 hover:underline"
} as const;

export const dashboardAccents = {
  green: "#16a34a",
  amber: "#d97706",
  red: "#dc2626",
  black: "#0a0a0a"
} as const;
