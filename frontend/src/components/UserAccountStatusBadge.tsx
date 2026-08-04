type Props = {
  active: boolean;
  className?: string;
};

export function UserAccountStatusBadge({ active, className = "" }: Props) {
  return (
    <span
      className={[
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold",
        active ? "bg-emerald-100 text-emerald-900 ring-1 ring-inset ring-emerald-200" : "bg-black/10 text-black/60",
        className
      ].join(" ")}
    >
      {active ? "Active" : "Inactive"}
    </span>
  );
}

export function UserAccountInactiveBadge({ className = "" }: { className?: string }) {
  return <UserAccountStatusBadge active={false} className={className} />;
}
