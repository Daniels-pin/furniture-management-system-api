import React from "react";
import { Navigate, useLocation } from "react-router-dom";
import { Role, useAuth } from "../state/auth";

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
    if (!auth.role || !roles.includes(auth.role)) {
      return <Navigate to={auth.role === "finance" ? "/finance" : "/dashboard"} replace />;
    }
  }

  return <>{children}</>;
}

