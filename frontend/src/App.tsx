import { Navigate, Route, Routes } from "react-router-dom";
import { RequireAuth } from "./routes/RequireAuth";
import { AppLayout } from "./components/layout/AppLayout";
import { LoginPage } from "./pages/LoginPage";
import { DashboardPage } from "./pages/DashboardPage";
import { OrdersPage } from "./pages/OrdersPage";
import { OrderDetailsPage } from "./pages/OrderDetailsPage";
import { CustomersPage } from "./pages/CustomersPage";
import { AdminUsersPage } from "./pages/AdminUsersPage";
import { AdminActivityLogPage } from "./pages/AdminActivityLogPage";
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

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />

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
        <Route path="customers" element={<CustomersPage />} />
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

