import type { ReactNode } from "react";

type ResponsiveDataListProps = {
  mobile: ReactNode;
  desktop: ReactNode;
  /** Extra classes on the mobile stack wrapper */
  mobileClassName?: string;
  /** Extra classes on the desktop table wrapper */
  desktopClassName?: string;
};

/**
 * Standard list pattern: card stack below md, table at md+.
 * Desktop layout is unchanged; mobile gets a dedicated card view.
 */
export function ResponsiveDataList({
  mobile,
  desktop,
  mobileClassName = "",
  desktopClassName = ""
}: ResponsiveDataListProps) {
  return (
    <>
      <div className={["space-y-3 md:hidden", mobileClassName].filter(Boolean).join(" ")}>{mobile}</div>
      <div className={["hidden min-w-0 md:block", desktopClassName].filter(Boolean).join(" ")}>{desktop}</div>
    </>
  );
}
