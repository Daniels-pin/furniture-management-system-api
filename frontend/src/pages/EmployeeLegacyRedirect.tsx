import { Navigate, useParams, useSearchParams } from "react-router-dom";

export function EmployeeLegacyRedirect() {
  const { employeeId } = useParams();
  const [sp] = useSearchParams();
  const year = sp.get("year");
  const month = sp.get("month");
  const qs = new URLSearchParams();
  qs.set("tab", "monthly");
  if (employeeId) qs.set("drawer", `monthly:${employeeId}`);
  if (year) qs.set("year", year);
  if (month) qs.set("month", month);
  return <Navigate to={`/employees?${qs.toString()}`} replace />;
}

