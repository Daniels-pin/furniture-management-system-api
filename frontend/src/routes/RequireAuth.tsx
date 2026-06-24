import React from "react";
import { Navigate, useLocation } from "react-router-dom";
import { Role, useAuth } from "../state/auth";
import { roleSatisfiesAllowed } from "../utils/roles";

export function RequireAuth({
  children,
  roles
}: {
  children: React.ReactNode;
  roles?: Role[];
}) {
  const auth = useAuth();
  const location = useLocation();

  if (!auth.isAuthed) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  if (roles && roles.length > 0) {
    if (!roleSatisfiesAllowed(auth.role, roles)) {
      const fallback =
        auth.role === "finance" ? "/dashboard" : auth.role === "contract_employee" ? "/contract" : "/dashboard";
      return <Navigate to={fallback} replace />;
    }
  }

  return <>{children}</>;
}
