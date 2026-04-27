import { Navigate, useParams, useSearchParams } from "react-router-dom";

export function EmployeeLegacyRedirect() {
  const { employeeId } = useParams();
  const [sp] = useSearchParams();
  const year = sp.get("year");
  const month = sp.get("month");
  const qs = new URLSearchParams();
  if (year) qs.set("year", year);
  if (month) qs.set("month", month);
  return <Navigate to={`/employees/${employeeId ?? ""}/detail?${qs.toString()}`} replace />;
}

