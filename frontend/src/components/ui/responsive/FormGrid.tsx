import type { ReactNode } from "react";

type FormGridCols = 1 | 2 | 3 | 4 | 5 | 6;

type FormGridProps = {
  children: ReactNode;
  /** Columns at default (mobile) breakpoint */
  cols?: FormGridCols;
  /** Columns at md (768px+) */
  md?: FormGridCols;
  /** Columns at lg (1024px+) */
  lg?: FormGridCols;
  /** Columns at xl (1280px+) */
  xl?: FormGridCols;
  className?: string;
};

const COL_CLASS: Record<FormGridCols, string> = {
  1: "grid-cols-1",
  2: "grid-cols-2",
  3: "grid-cols-3",
  4: "grid-cols-4",
  5: "grid-cols-5",
  6: "grid-cols-6"
};

/**
 * Responsive form field grid. Defaults to single column on mobile, two columns from md.
 */
export function FormGrid({ children, cols = 1, md = 2, lg, xl, className = "" }: FormGridProps) {
  const classes = [
    "grid gap-3",
    COL_CLASS[cols],
    md ? `md:${COL_CLASS[md]}` : "",
    lg ? `lg:${COL_CLASS[lg]}` : "",
    xl ? `xl:${COL_CLASS[xl]}` : "",
    className
  ]
    .filter(Boolean)
    .join(" ");

  return <div className={classes}>{children}</div>;
}
