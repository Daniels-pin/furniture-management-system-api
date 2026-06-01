import { useQuery, useQueryClient } from "@tanstack/react-query";
import { companyLocationsApi, employeesApi, notificationsApi } from "../services/endpoints";
import type { NotificationItem } from "../types/api";

export const queryKeys = {
  companyLocations: (search?: string) => ["company-locations", search ?? ""] as const,
  payrollPeriodsNav: ["payroll-periods-nav"] as const,
  notificationsUnread: (role: string) => ["notifications", "unread", role] as const,
  notificationsList: (limit: number) => ["notifications", "list", limit] as const
};

export function useCompanyLocations(search?: string) {
  return useQuery({
    queryKey: queryKeys.companyLocations(search),
    queryFn: () => companyLocationsApi.list(search ? { search } : undefined),
    staleTime: 60_000
  });
}

export function usePayrollPeriodsNav(enabled = true) {
  return useQuery({
    queryKey: queryKeys.payrollPeriodsNav,
    queryFn: () => employeesApi.payrollPeriodsNav(),
    staleTime: 60_000,
    enabled
  });
}

function notificationPollMs(): number | false {
  if (typeof document === "undefined") return 12_000;
  return document.visibilityState === "hidden" ? 60_000 : 12_000;
}

export function useUnreadNotifications(role: string, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.notificationsUnread(role),
    queryFn: () => notificationsApi.my({ unread_only: true, limit: 200 }),
    staleTime: 30_000,
    enabled,
    refetchInterval: enabled ? notificationPollMs : false
  });
}

export function useNotificationsList(limit: number, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.notificationsList(limit),
    queryFn: () => notificationsApi.my({ limit }),
    staleTime: 30_000,
    enabled
  });
}

export function useInvalidateNotifications() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ["notifications"] });
  };
}

export type { NotificationItem };
