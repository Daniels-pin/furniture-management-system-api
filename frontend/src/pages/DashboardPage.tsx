import { useEffect, useMemo, useState } from "react";
import { auditApi, dashboardApi, inventoryApi } from "../services/endpoints";
import { getErrorMessage } from "../services/api";
import { useToast } from "../state/toast";
import { useAuth } from "../state/auth";
import { APP_NAME } from "../config/app";
import { usePageHeader } from "../components/layout/pageHeader";
import { MonthlyEmployeeAttendanceCard } from "../components/employee/MonthlyEmployeeAttendanceCard";
import { useMonthlyEmployeeAttendance } from "../hooks/useMonthlyEmployeeAttendance";
import { DashboardKpiGrid } from "../components/dashboard/DashboardKpiGrid";
import { DashboardFinancialSummary } from "../components/dashboard/DashboardFinancialSummary";
import { DashboardQuickActions } from "../components/dashboard/DashboardQuickActions";
import { DashboardRevenueChart } from "../components/dashboard/DashboardRevenueChart";
import { DashboardOrdersStatusChart } from "../components/dashboard/DashboardOrdersStatusChart";
import { DashboardUpcomingOrders } from "../components/dashboard/DashboardUpcomingOrders";
import { DashboardRecentOrders } from "../components/dashboard/DashboardRecentOrders";
import { DashboardRecentActivity } from "../components/dashboard/DashboardRecentActivity";
import { DashboardLowStockAlerts } from "../components/dashboard/DashboardLowStockAlerts";
import type { AuditLogItem } from "../types/api";
import type { InventoryMaterial } from "../types/api";

export function DashboardPage() {
  const toast = useToast();
  const auth = useAuth();
  const [isLoading, setIsLoading] = useState(true);
  const [data, setData] = useState<Awaited<ReturnType<typeof dashboardApi.get>> | null>(null);
  const [activity, setActivity] = useState<AuditLogItem[]>([]);
  const [activityLoading, setActivityLoading] = useState(false);
  const [lowStock, setLowStock] = useState<InventoryMaterial[]>([]);
  const [lowStockLoading, setLowStockLoading] = useState(false);

  const attendanceEnabled = auth.role !== "admin";
  const attendance = useMonthlyEmployeeAttendance({ enabled: attendanceEnabled });

  usePageHeader({
    title: "Dashboard",
    subtitle: "Overview of orders, revenue, and operations."
  });

  const kpiItems = useMemo(() => {
    const rows = [
      { label: "Total Orders", value: data?.total_orders ?? 0 },
      { label: "Pending Orders", value: data?.pending_orders ?? 0 },
      { label: "Orders In Progress", value: data?.in_progress_orders ?? 0 },
      { label: "Completed Orders", value: data?.completed_orders ?? 0 }
    ];
    if (auth.role !== "factory") {
      rows.splice(1, 0, { label: "Total Customers", value: data?.total_customers ?? 0 });
    }
    return rows;
  }, [data, auth.role]);

  const kpiCols = auth.role === "factory" ? "sm:grid-cols-2 lg:grid-cols-4" : "sm:grid-cols-2 lg:grid-cols-5";

  useEffect(() => {
    let alive = true;
    (async () => {
      setIsLoading(true);
      try {
        const res = await dashboardApi.get();
        if (!alive) return;
        setData(res);
      } catch (err) {
        toast.push("error", getErrorMessage(err));
      } finally {
        if (alive) setIsLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [toast]);

  useEffect(() => {
    if (auth.role !== "admin") {
      setActivity([]);
      return;
    }
    let alive = true;
    setActivityLoading(true);
    void auditApi
      .list({ limit: 8, offset: 0 })
      .then((res) => {
        if (!alive) return;
        setActivity(Array.isArray(res.items) ? res.items : []);
      })
      .catch(() => {
        if (!alive) return;
        setActivity([]);
      })
      .finally(() => {
        if (alive) setActivityLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [auth.role]);

  useEffect(() => {
    if (auth.role !== "admin" && auth.role !== "factory") {
      setLowStock([]);
      return;
    }
    let alive = true;
    setLowStockLoading(true);
    void (async () => {
      try {
        const lowRes = await inventoryApi.list({ limit: 50, stock_level: "low" });
        if (!alive) return;
        let items = Array.isArray(lowRes.items) ? lowRes.items : [];
        if (items.length === 0) {
          const medRes = await inventoryApi.list({ limit: 50, stock_level: "medium" });
          if (!alive) return;
          items = Array.isArray(medRes.items) ? medRes.items : [];
        }
        setLowStock(items);
      } catch {
        if (!alive) return;
        setLowStock([]);
      } finally {
        if (alive) setLowStockLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [auth.role]);

  const showLowStock = auth.role === "admin" || auth.role === "factory";
  const showActivity = auth.role === "admin";

  return (
    <div className="space-y-10">
      {attendanceEnabled ? (
        <MonthlyEmployeeAttendanceCard
          empLoading={attendance.empLoading}
          emp={attendance.emp}
          attendance={attendance.attendance}
          attBusy={attendance.attBusy}
          clockRes={attendance.clockRes}
          clockOutRes={attendance.clockOutRes}
          todayEntry={attendance.todayEntry}
          checkInAllowed={attendance.checkInAllowed}
          checkOutAllowed={attendance.checkOutAllowed}
          dayCompleted={attendance.dayCompleted}
          onMarkAttendanceWithShift={attendance.markAttendance}
          onRequestMarkAttendance={attendance.requestMarkAttendance}
          onSignOutAttendance={attendance.signOutAttendance}
          onRequestSignOut={attendance.requestSignOut}
          shiftModalOpen={attendance.shiftModalOpen}
          onShiftModalClose={() => attendance.setShiftModalOpen(false)}
          signOutConfirmOpen={attendance.signOutConfirmOpen}
          signOutPreview={attendance.signOutPreview}
          onSignOutConfirmClose={() => attendance.setSignOutConfirmOpen(false)}
          resultFeedback={attendance.resultFeedback}
          onDismissResultFeedback={attendance.dismissResultFeedback}
          showHistory
        />
      ) : null}

      <DashboardQuickActions role={auth.role} />

      <DashboardKpiGrid items={kpiItems} isLoading={isLoading} columnClass={kpiCols} />

      {auth.role === "admin" ? (
        <DashboardFinancialSummary data={data} isLoading={isLoading} />
      ) : null}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2 xl:gap-8">
        <DashboardRevenueChart isLoading={isLoading} />
        <DashboardOrdersStatusChart
          pending={data?.pending_orders ?? 0}
          inProgress={data?.in_progress_orders ?? 0}
          completed={data?.completed_orders ?? 0}
          isLoading={isLoading}
        />
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2 xl:gap-8">
        <DashboardUpcomingOrders orders={data?.upcoming_due_orders ?? []} isLoading={isLoading} />
        <DashboardRecentOrders orders={data?.recent_orders ?? []} isLoading={isLoading} />
      </div>

      {showActivity || showLowStock ? (
        <div
          className={[
            "grid grid-cols-1 gap-6 xl:gap-8",
            showActivity && showLowStock ? "xl:grid-cols-2" : ""
          ].join(" ")}
        >
          {showActivity ? (
            <DashboardRecentActivity
              items={activity}
              isLoading={activityLoading}
              showViewAll
            />
          ) : null}
          {showLowStock ? (
            <DashboardLowStockAlerts materials={lowStock} isLoading={lowStockLoading} />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
