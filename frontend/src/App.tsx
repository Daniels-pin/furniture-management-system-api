import { lazy, Suspense, type ReactNode } from "react";
import { Navigate, Route, Routes, useParams } from "react-router-dom";
import { RequireAuth } from "./routes/RequireAuth";
import { AppLayout } from "./components/layout/AppLayout";
import { PageHeaderProvider } from "./components/layout/pageHeader";
import { LoginPage } from "./pages/LoginPage";
import { DashboardPage } from "./pages/DashboardPage";
import { StaffDashboardPage } from "./pages/StaffDashboardPage";
import { AccountPage } from "./pages/AccountPage";
import { useAuth } from "./state/auth";
import { DraftRecoveryGate } from "./state/drafts";

const OrdersPage = lazy(() => import("./pages/OrdersPage").then((m) => ({ default: m.OrdersPage })));
const OrderDetailsPage = lazy(() =>
  import("./pages/OrderDetailsPage").then((m) => ({ default: m.OrderDetailsPage }))
);
const CustomersPage = lazy(() => import("./pages/CustomersPage").then((m) => ({ default: m.CustomersPage })));
const AdminUsersPage = lazy(() => import("./pages/AdminUsersPage").then((m) => ({ default: m.AdminUsersPage })));
const AdminActivityLogPage = lazy(() =>
  import("./pages/AdminActivityLogPage").then((m) => ({ default: m.AdminActivityLogPage }))
);
const AdminJobsPage = lazy(() => import("./pages/AdminJobsPage").then((m) => ({ default: m.AdminJobsPage })));
const AdminJobDetailPage = lazy(() =>
  import("./pages/AdminJobDetailPage").then((m) => ({ default: m.AdminJobDetailPage }))
);
const AdminCompanyLocationsPage = lazy(() =>
  import("./pages/AdminCompanyLocationsPage").then((m) => ({ default: m.AdminCompanyLocationsPage }))
);
const TrashPage = lazy(() => import("./pages/TrashPage").then((m) => ({ default: m.TrashPage })));
const InventoryPage = lazy(() => import("./pages/InventoryPage").then((m) => ({ default: m.InventoryPage })));
const InventoryMaterialDetailPage = lazy(() =>
  import("./pages/InventoryMaterialDetailPage").then((m) => ({ default: m.InventoryMaterialDetailPage }))
);
const EquipmentPage = lazy(() => import("./pages/EquipmentPage").then((m) => ({ default: m.EquipmentPage })));
const ProductionMaterialTrackingPage = lazy(() =>
  import("./pages/ProductionMaterialTrackingPage").then((m) => ({ default: m.ProductionMaterialTrackingPage }))
);
const ToolDetailPage = lazy(() => import("./pages/ToolDetailPage").then((m) => ({ default: m.ToolDetailPage })));
const MachineDetailPage = lazy(() =>
  import("./pages/MachineDetailPage").then((m) => ({ default: m.MachineDetailPage }))
);
const InvoicesPage = lazy(() => import("./pages/InvoicesPage").then((m) => ({ default: m.InvoicesPage })));
const InvoiceDetailPage = lazy(() =>
  import("./pages/InvoiceDetailPage").then((m) => ({ default: m.InvoiceDetailPage }))
);
const ProformaListPage = lazy(() => import("./pages/ProformaListPage").then((m) => ({ default: m.ProformaListPage })));
const ProformaFormPage = lazy(() => import("./pages/ProformaFormPage").then((m) => ({ default: m.ProformaFormPage })));
const ProformaDetailPage = lazy(() =>
  import("./pages/ProformaDetailPage").then((m) => ({ default: m.ProformaDetailPage }))
);
const QuotationListPage = lazy(() =>
  import("./pages/QuotationListPage").then((m) => ({ default: m.QuotationListPage }))
);
const QuotationFormPage = lazy(() =>
  import("./pages/QuotationFormPage").then((m) => ({ default: m.QuotationFormPage }))
);
const QuotationDetailPage = lazy(() =>
  import("./pages/QuotationDetailPage").then((m) => ({ default: m.QuotationDetailPage }))
);
const WaybillListPage = lazy(() => import("./pages/WaybillListPage").then((m) => ({ default: m.WaybillListPage })));
const WaybillDetailPage = lazy(() =>
  import("./pages/WaybillDetailPage").then((m) => ({ default: m.WaybillDetailPage }))
);
const InvoicePdfExportPage = lazy(() =>
  import("./pages/pdf-export/InvoicePdfExportPage").then((m) => ({ default: m.InvoicePdfExportPage }))
);
const QuotationPdfExportPage = lazy(() =>
  import("./pages/pdf-export/QuotationPdfExportPage").then((m) => ({ default: m.QuotationPdfExportPage }))
);
const ProformaPdfExportPage = lazy(() =>
  import("./pages/pdf-export/ProformaPdfExportPage").then((m) => ({ default: m.ProformaPdfExportPage }))
);
const WaybillPdfExportPage = lazy(() =>
  import("./pages/pdf-export/WaybillPdfExportPage").then((m) => ({ default: m.WaybillPdfExportPage }))
);
const OrderPdfExportPage = lazy(() =>
  import("./pages/pdf-export/OrderPdfExportPage").then((m) => ({ default: m.OrderPdfExportPage }))
);
const PayrollPdfExportPage = lazy(() =>
  import("./pages/pdf-export/PayrollPdfExportPage").then((m) => ({ default: m.PayrollPdfExportPage }))
);
const EmployeesPage = lazy(() => import("./pages/EmployeesPage").then((m) => ({ default: m.EmployeesPage })));
const EmployeeAdminPage = lazy(() =>
  import("./pages/EmployeeAdminPage").then((m) => ({ default: m.EmployeeAdminPage }))
);
const EmployeeLegacyRedirect = lazy(() =>
  import("./pages/EmployeeLegacyRedirect").then((m) => ({ default: m.EmployeeLegacyRedirect }))
);
const EmployeeSelfPage = lazy(() =>
  import("./pages/EmployeeSelfPage").then((m) => ({ default: m.EmployeeSelfPage }))
);
const MonthlyEmployeeDetailPage = lazy(() =>
  import("./pages/MonthlyEmployeeDetailPage").then((m) => ({ default: m.MonthlyEmployeeDetailPage }))
);
const AttendanceRecordsPage = lazy(() =>
  import("./pages/AttendanceRecordsPage").then((m) => ({ default: m.AttendanceRecordsPage }))
);
const EmployeeAttendanceDetailPage = lazy(() =>
  import("./pages/EmployeeAttendanceDetailPage").then((m) => ({ default: m.EmployeeAttendanceDetailPage }))
);
const ContractEmployeeDetailPage = lazy(() =>
  import("./pages/ContractEmployeeDetailPage").then((m) => ({ default: m.ContractEmployeeDetailPage }))
);
const ContractEmployeeCreatePage = lazy(() =>
  import("./pages/ContractEmployeeCreatePage").then((m) => ({ default: m.ContractEmployeeCreatePage }))
);
const ContractEmployeeDashboardPage = lazy(() =>
  import("./pages/ContractEmployeeDashboardPage").then((m) => ({ default: m.ContractEmployeeDashboardPage }))
);
const ContractJobDetailPage = lazy(() =>
  import("./pages/ContractJobDetailPage").then((m) => ({ default: m.ContractJobDetailPage }))
);
const ExpensesPage = lazy(() => import("./pages/ExpensesPage").then((m) => ({ default: m.ExpensesPage })));
const FinanceDashboardPage = lazy(() =>
  import("./pages/FinanceDashboardPage").then((m) => ({ default: m.FinanceDashboardPage }))
);
const FinanceRoleDashboardPage = lazy(() =>
  import("./pages/FinanceRoleDashboardPage").then((m) => ({ default: m.FinanceRoleDashboardPage }))
);
const StaffFinanceSelf = lazy(() => import("./pages/StaffFinanceSelf").then((m) => ({ default: m.StaffFinanceSelf })));
const StaffProfilePage = lazy(() => import("./pages/StaffProfilePage").then((m) => ({ default: m.StaffProfilePage })));

function LazyPage({ children }: { children: ReactNode }) {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[12rem] items-center justify-center p-6 text-sm text-black/60">Loading…</div>
      }
    >
      {children}
    </Suspense>
  );
}

function LegacyMachineDetailRedirect() {
  const { machineId } = useParams();
  return <Navigate to={`/equipment/machine/${machineId ?? ""}`} replace />;
}

function DashboardGate() {
  const auth = useAuth();
  if (auth.role === "finance") {
    return (
      <LazyPage>
        <FinanceRoleDashboardPage />
      </LazyPage>
    );
  }
  if (auth.role === "contract_employee") return <Navigate to="/contract" replace />;
  if (auth.role === "staff") return <StaffDashboardPage />;
  return <DashboardPage />;
}

function FinanceEntry() {
  const auth = useAuth();
  if (auth.role === "staff") {
    return (
      <LazyPage>
        <StaffFinanceSelf />
      </LazyPage>
    );
  }
  return (
    <LazyPage>
      <FinanceDashboardPage />
    </LazyPage>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />

      <Route
        path="/pdf-export/invoice/:invoiceId"
        element={
          <LazyPage>
            <InvoicePdfExportPage />
          </LazyPage>
        }
      />
      <Route
        path="/pdf-export/quotation/:quotationId"
        element={
          <LazyPage>
            <QuotationPdfExportPage />
          </LazyPage>
        }
      />
      <Route
        path="/pdf-export/proforma/:proformaId"
        element={
          <LazyPage>
            <ProformaPdfExportPage />
          </LazyPage>
        }
      />
      <Route
        path="/pdf-export/waybill/:waybillId"
        element={
          <LazyPage>
            <WaybillPdfExportPage />
          </LazyPage>
        }
      />
      <Route
        path="/pdf-export/order/:orderId"
        element={
          <LazyPage>
            <OrderPdfExportPage />
          </LazyPage>
        }
      />
      <Route
        path="/pdf-export/payroll/:periodId"
        element={
          <LazyPage>
            <PayrollPdfExportPage />
          </LazyPage>
        }
      />

      <Route
        path="/"
        element={
          <RequireAuth>
            <PageHeaderProvider>
              <DraftRecoveryGate>
                <AppLayout />
              </DraftRecoveryGate>
            </PageHeaderProvider>
          </RequireAuth>
        }
      >
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="dashboard" element={<DashboardGate />} />
        <Route
          path="orders"
          element={
            <RequireAuth roles={["admin", "showroom", "factory", "finance"]}>
              <LazyPage>
                <OrdersPage />
              </LazyPage>
            </RequireAuth>
          }
        />
        <Route
          path="orders/:orderId"
          element={
            <RequireAuth roles={["admin", "showroom", "factory", "finance"]}>
              <LazyPage>
                <OrderDetailsPage />
              </LazyPage>
            </RequireAuth>
          }
        />
        <Route
          path="invoices"
          element={
            <RequireAuth roles={["admin", "showroom", "finance"]}>
              <LazyPage>
                <InvoicesPage />
              </LazyPage>
            </RequireAuth>
          }
        />
        <Route
          path="invoices/:invoiceId"
          element={
            <RequireAuth roles={["admin", "showroom", "finance"]}>
              <LazyPage>
                <InvoiceDetailPage />
              </LazyPage>
            </RequireAuth>
          }
        />
        <Route
          path="quotations/new"
          element={
            <RequireAuth roles={["admin", "showroom", "finance"]}>
              <LazyPage>
                <QuotationFormPage />
              </LazyPage>
            </RequireAuth>
          }
        />
        <Route
          path="quotations/:quotationId/edit"
          element={
            <RequireAuth roles={["admin", "showroom", "finance"]}>
              <LazyPage>
                <QuotationFormPage />
              </LazyPage>
            </RequireAuth>
          }
        />
        <Route
          path="quotations/:quotationId"
          element={
            <RequireAuth roles={["admin", "showroom", "finance"]}>
              <LazyPage>
                <QuotationDetailPage />
              </LazyPage>
            </RequireAuth>
          }
        />
        <Route
          path="quotations"
          element={
            <RequireAuth roles={["admin", "showroom", "finance"]}>
              <LazyPage>
                <QuotationListPage />
              </LazyPage>
            </RequireAuth>
          }
        />
        <Route
          path="waybills/:waybillId"
          element={
            <RequireAuth roles={["admin", "showroom", "finance"]}>
              <LazyPage>
                <WaybillDetailPage />
              </LazyPage>
            </RequireAuth>
          }
        />
        <Route
          path="waybills"
          element={
            <RequireAuth roles={["admin", "showroom", "finance"]}>
              <LazyPage>
                <WaybillListPage />
              </LazyPage>
            </RequireAuth>
          }
        />
        <Route
          path="proforma/new"
          element={
            <RequireAuth roles={["admin", "showroom", "finance"]}>
              <LazyPage>
                <ProformaFormPage />
              </LazyPage>
            </RequireAuth>
          }
        />
        <Route
          path="proforma/:proformaId/edit"
          element={
            <RequireAuth roles={["admin", "showroom", "finance"]}>
              <LazyPage>
                <ProformaFormPage />
              </LazyPage>
            </RequireAuth>
          }
        />
        <Route
          path="proforma/:proformaId"
          element={
            <RequireAuth roles={["admin", "showroom", "finance"]}>
              <LazyPage>
                <ProformaDetailPage />
              </LazyPage>
            </RequireAuth>
          }
        />
        <Route
          path="proforma"
          element={
            <RequireAuth roles={["admin", "showroom", "finance"]}>
              <LazyPage>
                <ProformaListPage />
              </LazyPage>
            </RequireAuth>
          }
        />
        <Route
          path="customers"
          element={
            <RequireAuth roles={["admin", "showroom", "finance"]}>
              <LazyPage>
                <CustomersPage />
              </LazyPage>
            </RequireAuth>
          }
        />
        <Route
          path="trash"
          element={
            <RequireAuth roles={["admin", "showroom", "factory"]}>
              <LazyPage>
                <TrashPage />
              </LazyPage>
            </RequireAuth>
          }
        />
        <Route
          path="inventory/:materialId"
          element={
            <RequireAuth roles={["admin", "factory"]}>
              <LazyPage>
                <InventoryMaterialDetailPage />
              </LazyPage>
            </RequireAuth>
          }
        />
        <Route
          path="inventory"
          element={
            <RequireAuth roles={["admin", "factory"]}>
              <LazyPage>
                <InventoryPage />
              </LazyPage>
            </RequireAuth>
          }
        />
        <Route
          path="equipment/tool/:toolId"
          element={
            <RequireAuth roles={["admin", "factory"]}>
              <LazyPage>
                <ToolDetailPage />
              </LazyPage>
            </RequireAuth>
          }
        />
        <Route
          path="equipment/machine/:machineId"
          element={
            <RequireAuth roles={["admin", "factory"]}>
              <LazyPage>
                <MachineDetailPage />
              </LazyPage>
            </RequireAuth>
          }
        />
        <Route
          path="equipment"
          element={
            <RequireAuth roles={["admin", "factory"]}>
              <LazyPage>
                <EquipmentPage />
              </LazyPage>
            </RequireAuth>
          }
        />
        <Route
          path="production/materials"
          element={
            <RequireAuth roles={["admin", "factory"]}>
              <LazyPage>
                <ProductionMaterialTrackingPage />
              </LazyPage>
            </RequireAuth>
          }
        />
        <Route path="tools" element={<Navigate to="/equipment" replace />} />
        <Route path="machines" element={<Navigate to="/equipment" replace />} />
        <Route
          path="machines/:machineId"
          element={
            <RequireAuth roles={["admin", "factory"]}>
              <LegacyMachineDetailRedirect />
            </RequireAuth>
          }
        />
        <Route path="account" element={<AccountPage />} />
        <Route
          path="employee-details"
          element={
            <RequireAuth roles={["admin", "factory", "finance", "showroom"]}>
              <LazyPage>
                <EmployeeSelfPage />
              </LazyPage>
            </RequireAuth>
          }
        />
        <Route
          path="profile"
          element={
            <RequireAuth roles={["staff"]}>
              <LazyPage>
                <StaffProfilePage />
              </LazyPage>
            </RequireAuth>
          }
        />
        <Route path="finance" element={<RequireAuth roles={["finance", "admin", "staff"]}><FinanceEntry /></RequireAuth>} />
        <Route
          path="employees"
          element={
            <RequireAuth roles={["admin", "finance", "factory"]}>
              <LazyPage>
                <EmployeesPage />
              </LazyPage>
            </RequireAuth>
          }
        />
        <Route
          path="contract"
          element={
            <RequireAuth roles={["contract_employee"]}>
              <LazyPage>
                <ContractEmployeeDashboardPage />
              </LazyPage>
            </RequireAuth>
          }
        />
        <Route
          path="contract/jobs/:jobId"
          element={
            <RequireAuth roles={["contract_employee"]}>
              <LazyPage>
                <ContractJobDetailPage />
              </LazyPage>
            </RequireAuth>
          }
        />
        <Route
          path="employees/new"
          element={
            <RequireAuth roles={["admin", "factory"]}>
              <LazyPage>
                <EmployeeAdminPage />
              </LazyPage>
            </RequireAuth>
          }
        />
        <Route
          path="employees/:employeeId/detail"
          element={
            <RequireAuth roles={["admin"]}>
              <LazyPage>
                <MonthlyEmployeeDetailPage />
              </LazyPage>
            </RequireAuth>
          }
        />
        <Route
          path="attendance-records"
          element={
            <RequireAuth roles={["admin", "factory"]}>
              <LazyPage>
                <AttendanceRecordsPage />
              </LazyPage>
            </RequireAuth>
          }
        />
        <Route
          path="attendance-records/:employeeId"
          element={
            <RequireAuth roles={["admin", "factory"]}>
              <LazyPage>
                <EmployeeAttendanceDetailPage />
              </LazyPage>
            </RequireAuth>
          }
        />
        <Route
          path="contract-employees/new"
          element={
            <RequireAuth roles={["admin", "factory"]}>
              <LazyPage>
                <ContractEmployeeCreatePage />
              </LazyPage>
            </RequireAuth>
          }
        />
        <Route
          path="contract-employees/:contractEmployeeId"
          element={
            <RequireAuth roles={["admin"]}>
              <LazyPage>
                <ContractEmployeeDetailPage />
              </LazyPage>
            </RequireAuth>
          }
        />
        <Route
          path="employees/:employeeId"
          element={
            <RequireAuth roles={["admin"]}>
              <LazyPage>
                <EmployeeLegacyRedirect />
              </LazyPage>
            </RequireAuth>
          }
        />
        <Route
          path="expenses"
          element={
            <RequireAuth roles={["admin", "finance"]}>
              <LazyPage>
                <ExpensesPage />
              </LazyPage>
            </RequireAuth>
          }
        />
        <Route
          path="admin/users"
          element={
            <RequireAuth roles={["admin"]}>
              <LazyPage>
                <AdminUsersPage />
              </LazyPage>
            </RequireAuth>
          }
        />
        <Route
          path="admin/locations"
          element={
            <RequireAuth roles={["admin"]}>
              <LazyPage>
                <AdminCompanyLocationsPage />
              </LazyPage>
            </RequireAuth>
          }
        />
        <Route
          path="admin/jobs"
          element={
            <RequireAuth roles={["admin"]}>
              <LazyPage>
                <AdminJobsPage />
              </LazyPage>
            </RequireAuth>
          }
        />
        <Route
          path="admin/jobs/:jobId"
          element={
            <RequireAuth roles={["admin"]}>
              <LazyPage>
                <AdminJobDetailPage />
              </LazyPage>
            </RequireAuth>
          }
        />
        <Route
          path="admin/activity"
          element={
            <RequireAuth roles={["admin"]}>
              <LazyPage>
                <AdminActivityLogPage />
              </LazyPage>
            </RequireAuth>
          }
        />
      </Route>

      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}
