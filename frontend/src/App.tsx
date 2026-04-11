import { Navigate, Route, Routes, useParams } from "react-router-dom";
import { RequireAuth } from "./routes/RequireAuth";
import { AppLayout } from "./components/layout/AppLayout";
import { LoginPage } from "./pages/LoginPage";
import { DashboardPage } from "./pages/DashboardPage";
import { OrdersPage } from "./pages/OrdersPage";
import { OrderDetailsPage } from "./pages/OrderDetailsPage";
import { CustomersPage } from "./pages/CustomersPage";
import { AdminUsersPage } from "./pages/AdminUsersPage";
import { AdminActivityLogPage } from "./pages/AdminActivityLogPage";
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

function LegacyMachineDetailRedirect() {
  const { machineId } = useParams();
  return <Navigate to={`/equipment/machine/${machineId ?? ""}`} replace />;
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
            <AppLayout />
          </RequireAuth>
        }
      >
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="dashboard" element={<DashboardPage />} />
        <Route path="orders" element={<OrdersPage />} />
        <Route path="orders/:orderId" element={<OrderDetailsPage />} />
        <Route
          path="invoices"
          element={
            <RequireAuth roles={["admin", "showroom"]}>
              <InvoicesPage />
            </RequireAuth>
          }
        />
        <Route
          path="invoices/:invoiceId"
          element={
            <RequireAuth roles={["admin", "showroom"]}>
              <InvoiceDetailPage />
            </RequireAuth>
          }
        />
        <Route
          path="quotations/new"
          element={
            <RequireAuth roles={["admin", "showroom"]}>
              <QuotationFormPage />
            </RequireAuth>
          }
        />
        <Route
          path="quotations/:quotationId/edit"
          element={
            <RequireAuth roles={["admin", "showroom"]}>
              <QuotationFormPage />
            </RequireAuth>
          }
        />
        <Route
          path="quotations/:quotationId"
          element={
            <RequireAuth roles={["admin", "showroom"]}>
              <QuotationDetailPage />
            </RequireAuth>
          }
        />
        <Route
          path="quotations"
          element={
            <RequireAuth roles={["admin", "showroom"]}>
              <QuotationListPage />
            </RequireAuth>
          }
        />
        <Route
          path="waybills/:waybillId"
          element={
            <RequireAuth roles={["admin", "showroom"]}>
              <WaybillDetailPage />
            </RequireAuth>
          }
        />
        <Route
          path="waybills"
          element={
            <RequireAuth roles={["admin", "showroom"]}>
              <WaybillListPage />
            </RequireAuth>
          }
        />
        <Route
          path="proforma/new"
          element={
            <RequireAuth roles={["admin", "showroom"]}>
              <ProformaFormPage />
            </RequireAuth>
          }
        />
        <Route
          path="proforma/:proformaId/edit"
          element={
            <RequireAuth roles={["admin", "showroom"]}>
              <ProformaFormPage />
            </RequireAuth>
          }
        />
        <Route
          path="proforma/:proformaId"
          element={
            <RequireAuth roles={["admin", "showroom"]}>
              <ProformaDetailPage />
            </RequireAuth>
          }
        />
        <Route
          path="proforma"
          element={
            <RequireAuth roles={["admin", "showroom"]}>
              <ProformaListPage />
            </RequireAuth>
          }
        />
        <Route
          path="customers"
          element={
            <RequireAuth roles={["admin", "showroom"]}>
              <CustomersPage />
            </RequireAuth>
          }
        />
        <Route path="trash" element={<TrashPage />} />
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
        <Route
          path="admin/users"
          element={
            <RequireAuth roles={["admin"]}>
              <AdminUsersPage />
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

