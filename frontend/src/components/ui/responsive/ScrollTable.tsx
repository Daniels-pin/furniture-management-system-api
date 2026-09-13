import type { ReactNode } from "react";

type ScrollTableProps = {
  children: ReactNode;
  /** Minimum table width in px — enables horizontal scroll on tablet when needed */
  minWidth?: number;
  className?: string;
};

/**
 * Horizontally scrollable table wrapper for desktop/tablet.
 * Use with ResponsiveDataList for pages that keep tables on md+.
 */
export function ScrollTable({ children, minWidth, className = "" }: ScrollTableProps) {
  return (
    <div className={["min-w-0 overflow-x-touch", className].filter(Boolean).join(" ")}>
      <table
        className="w-full text-left text-sm"
        style={minWidth ? { minWidth: `${minWidth}px` } : undefined}
      >
        {children}
      </table>
    </div>
  );
}
