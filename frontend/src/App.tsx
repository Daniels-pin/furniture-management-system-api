import { Navigate, Route, Routes, useParams } from "react-router-dom";
import { RequireAuth } from "./routes/RequireAuth";
import { AppLayout } from "./components/layout/AppLayout";
import { PageHeaderProvider } from "./components/layout/pageHeader";
import { LoginPage } from "./pages/LoginPage";
import { DashboardPage } from "./pages/DashboardPage";
import { OrdersPage } from "./pages/OrdersPage";
import { OrderDetailsPage } from "./pages/OrderDetailsPage";
import { CustomersPage } from "./pages/CustomersPage";
import { AdminUsersPage } from "./pages/AdminUsersPage";
import { AdminActivityLogPage } from "./pages/AdminActivityLogPage";
import { AdminJobsPage } from "./pages/AdminJobsPage";
import { AdminJobDetailPage } from "./pages/AdminJobDetailPage";
import { AdminCompanyLocationsPage } from "./pages/AdminCompanyLocationsPage";
import { TrashPage } from "./pages/TrashPage";
import { InventoryPage } from "./pages/InventoryPage";
import { InventoryMaterialDetailPage } from "./pages/InventoryMaterialDetailPage";
import { EquipmentPage } from "./pages/EquipmentPage";
import { ToolDetailPage } from "./pages/ToolDetailPage";
import { MachineDetailPage } from "./pages/MachineDetailPage";
import { AccountPage } from "./pages/AccountPage";
import { InvoicesPage } from "./pages/InvoicesPage";
import { InvoiceDetailPage } from "./pages/InvoiceDetailPage";
import { ProformaListPage } from "./pages/ProformaListPage";
import { ProformaFormPage } from "./pages/ProformaFormPage";
import { ProformaDetailPage } from "./pages/ProformaDetailPage";
import { QuotationListPage } from "./pages/QuotationListPage";
import { QuotationFormPage } from "./pages/QuotationFormPage";
import { QuotationDetailPage } from "./pages/QuotationDetailPage";
import { WaybillListPage } from "./pages/WaybillListPage";
import { WaybillDetailPage } from "./pages/WaybillDetailPage";
import { InvoicePdfExportPage } from "./pages/pdf-export/InvoicePdfExportPage";
import { QuotationPdfExportPage } from "./pages/pdf-export/QuotationPdfExportPage";
import { ProformaPdfExportPage } from "./pages/pdf-export/ProformaPdfExportPage";
import { WaybillPdfExportPage } from "./pages/pdf-export/WaybillPdfExportPage";
import { OrderPdfExportPage } from "./pages/pdf-export/OrderPdfExportPage";
import { EmployeesPage } from "./pages/EmployeesPage";
import { EmployeeAdminPage } from "./pages/EmployeeAdminPage";
import { EmployeeLegacyRedirect } from "./pages/EmployeeLegacyRedirect";
import { EmployeeSelfPage } from "./pages/EmployeeSelfPage";
import { MonthlyEmployeeDetailPage } from "./pages/MonthlyEmployeeDetailPage";
import { ContractEmployeeDetailPage } from "./pages/ContractEmployeeDetailPage";
import { ContractEmployeeCreatePage } from "./pages/ContractEmployeeCreatePage";
import { ContractEmployeeDashboardPage } from "./pages/ContractEmployeeDashboardPage";
import { ContractJobDetailPage } from "./pages/ContractJobDetailPage";
import { ExpensesPage } from "./pages/ExpensesPage";
import { FinanceDashboardPage } from "./pages/FinanceDashboardPage";
import { useAuth } from "./state/auth";
import { DraftRecoveryGate } from "./state/drafts";

function LegacyMachineDetailRedirect() {
  const { machineId } = useParams();
  return <Navigate to={`/equipment/machine/${machineId ?? ""}`} replace />;
}

function DashboardGate() {
  const auth = useAuth();
  if (auth.role === "finance") return <Navigate to="/finance" replace />;
  if (auth.role === "contract_employee") return <Navigate to="/contract" replace />;
  return <DashboardPage />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />

      <Route path="/pdf-export/invoice/:invoiceId" element={<InvoicePdfExportPage />} />
      <Route path="/pdf-export/quotation/:quotationId" element={<QuotationPdfExportPage />} />
      <Route path="/pdf-export/proforma/:proformaId" element={<ProformaPdfExportPage />} />
      <Route path="/pdf-export/waybill/:waybillId" element={<WaybillPdfExportPage />} />
      <Route path="/pdf-export/order/:orderId" element={<OrderPdfExportPage />} />

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
              <OrdersPage />
            </RequireAuth>
          }
        />
        <Route
          path="orders/:orderId"
          element={
            <RequireAuth roles={["admin", "showroom", "factory", "finance"]}>
              <OrderDetailsPage />
            </RequireAuth>
          }
        />
        <Route
          path="invoices"
          element={
            <RequireAuth roles={["admin", "showroom", "finance"]}>
              <InvoicesPage />
            </RequireAuth>
          }
        />
        <Route
          path="invoices/:invoiceId"
          element={
            <RequireAuth roles={["admin", "showroom", "finance"]}>
              <InvoiceDetailPage />
            </RequireAuth>
          }
        />
        <Route
          path="quotations/new"
          element={
            <RequireAuth roles={["admin", "showroom", "finance"]}>
              <QuotationFormPage />
            </RequireAuth>
          }
        />
        <Route
          path="quotations/:quotationId/edit"
          element={
            <RequireAuth roles={["admin", "showroom", "finance"]}>
              <QuotationFormPage />
            </RequireAuth>
          }
        />
        <Route
          path="quotations/:quotationId"
          element={
            <RequireAuth roles={["admin", "showroom", "finance"]}>
              <QuotationDetailPage />
            </RequireAuth>
          }
        />
        <Route
          path="quotations"
          element={
            <RequireAuth roles={["admin", "showroom", "finance"]}>
              <QuotationListPage />
            </RequireAuth>
          }
        />
        <Route
          path="waybills/:waybillId"
          element={
            <RequireAuth roles={["admin", "showroom", "finance"]}>
              <WaybillDetailPage />
            </RequireAuth>
          }
        />
        <Route
          path="waybills"
          element={
            <RequireAuth roles={["admin", "showroom", "finance"]}>
              <WaybillListPage />
            </RequireAuth>
          }
        />
        <Route
          path="proforma/new"
          element={
            <RequireAuth roles={["admin", "showroom", "finance"]}>
              <ProformaFormPage />
            </RequireAuth>
          }
        />
        <Route
          path="proforma/:proformaId/edit"
          element={
            <RequireAuth roles={["admin", "showroom", "finance"]}>
              <ProformaFormPage />
            </RequireAuth>
          }
        />
        <Route
          path="proforma/:proformaId"
          element={
            <RequireAuth roles={["admin", "showroom", "finance"]}>
              <ProformaDetailPage />
            </RequireAuth>
          }
        />
        <Route
          path="proforma"
          element={
            <RequireAuth roles={["admin", "showroom", "finance"]}>
              <ProformaListPage />
            </RequireAuth>
          }
        />
        <Route
          path="customers"
          element={
            <RequireAuth roles={["admin", "showroom", "finance"]}>
              <CustomersPage />
            </RequireAuth>
          }
        />
        <Route
          path="trash"
          element={
            <RequireAuth roles={["admin", "showroom", "factory"]}>
              <TrashPage />
            </RequireAuth>
          }
        />
        <Route
          path="inventory/:materialId"
          element={
            <RequireAuth roles={["admin", "factory"]}>
              <InventoryMaterialDetailPage />
            </RequireAuth>
          }
        />
        <Route
          path="inventory"
          element={
            <RequireAuth roles={["admin", "factory"]}>
              <InventoryPage />
            </RequireAuth>
          }
        />
        <Route
          path="equipment/tool/:toolId"
          element={
            <RequireAuth roles={["admin", "factory"]}>
              <ToolDetailPage />
            </RequireAuth>
          }
        />
        <Route
          path="equipment/machine/:machineId"
          element={
            <RequireAuth roles={["admin", "factory"]}>
              <MachineDetailPage />
            </RequireAuth>
          }
        />
        <Route
          path="equipment"
          element={
            <RequireAuth roles={["admin", "factory"]}>
              <EquipmentPage />
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
        <Route path="employee-details" element={<EmployeeSelfPage />} />
        <Route
          path="finance"
          element={
            <RequireAuth roles={["finance", "admin"]}>
              <FinanceDashboardPage />
            </RequireAuth>
          }
        />
        <Route
          path="employees"
          element={
            <RequireAuth roles={["admin", "finance", "factory"]}>
              <EmployeesPage />
            </RequireAuth>
          }
        />
        <Route
          path="contract"
          element={
            <RequireAuth roles={["contract_employee"]}>
              <ContractEmployeeDashboardPage />
            </RequireAuth>
          }
        />
        <Route
          path="contract/jobs/:jobId"
          element={
            <RequireAuth roles={["contract_employee"]}>
              <ContractJobDetailPage />
            </RequireAuth>
          }
        />
        <Route
          path="employees/new"
          element={
            <RequireAuth roles={["admin", "factory"]}>
              <EmployeeAdminPage />
            </RequireAuth>
          }
        />
        <Route
          path="employees/:employeeId/detail"
          element={
            <RequireAuth roles={["admin"]}>
              <MonthlyEmployeeDetailPage />
            </RequireAuth>
          }
        />
        <Route
          path="contract-employees/new"
          element={
            <RequireAuth roles={["admin", "factory"]}>
              <ContractEmployeeCreatePage />
            </RequireAuth>
          }
        />
        <Route
          path="contract-employees/:contractEmployeeId"
          element={
            <RequireAuth roles={["admin"]}>
              <ContractEmployeeDetailPage />
            </RequireAuth>
          }
        />
        <Route
          path="employees/:employeeId"
          element={
            <RequireAuth roles={["admin"]}>
              <EmployeeLegacyRedirect />
            </RequireAuth>
          }
        />
        <Route
          path="expenses"
          element={
            <RequireAuth roles={["admin", "finance"]}>
              <ExpensesPage />
            </RequireAuth>
          }
        />
        <Route
          path="admin/users"
          element={
            <RequireAuth roles={["admin"]}>
              <AdminUsersPage />
            </RequireAuth>
          }
        />
        <Route
          path="admin/locations"
          element={
            <RequireAuth roles={["admin"]}>
              <AdminCompanyLocationsPage />
            </RequireAuth>
          }
        />
        <Route
          path="admin/jobs"
          element={
            <RequireAuth roles={["admin"]}>
              <AdminJobsPage />
            </RequireAuth>
          }
        />
        <Route
          path="admin/jobs/:jobId"
          element={
            <RequireAuth roles={["admin"]}>
              <AdminJobDetailPage />
            </RequireAuth>
          }
        />
        <Route
          path="admin/activity"
          element={
            <RequireAuth roles={["admin"]}>
              <AdminActivityLogPage />
            </RequireAuth>
          }
        />
      </Route>

      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}

