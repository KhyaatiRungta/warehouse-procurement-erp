import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import type { ReactNode } from "react";
import { useAuth } from "./lib/auth";
import { Layout } from "./components/Layout";
import { Loading } from "./components/ui";
import { LoginPage } from "./pages/Login";
import { DashboardPage } from "./pages/Dashboard";
import { SuppliersPage, SupplierDetailPage, SupplierFormPage } from "./pages/Suppliers";
import { InventoryPage, ItemDetailPage } from "./pages/Inventory";
import { RequisitionsPage, RequisitionDetailPage, RequisitionFormPage } from "./pages/Requisitions";
import { PurchaseOrdersPage, PurchaseOrderDetailPage, PurchaseOrderFormPage } from "./pages/PurchaseOrders";
import { ReceiptsPage, ReceiveGoodsPage } from "./pages/Receipts";
import { AlertsPage } from "./pages/Alerts";
import { AuditPage } from "./pages/Audit";

function RequireAuth({ children }: { children: ReactNode }) {
  const { user, ready } = useAuth();
  const location = useLocation();
  if (!ready) return <div className="boot"><Loading rows={3} label="Checking your session" /></div>;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <>{children}</>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        element={
          <RequireAuth>
            <Layout />
          </RequireAuth>
        }
      >
        <Route index element={<DashboardPage />} />
        <Route path="suppliers" element={<SuppliersPage />} />
        <Route path="suppliers/new" element={<SupplierFormPage />} />
        <Route path="suppliers/:id" element={<SupplierDetailPage />} />
        <Route path="suppliers/:id/edit" element={<SupplierFormPage />} />
        <Route path="inventory" element={<InventoryPage />} />
        <Route path="inventory/:id" element={<ItemDetailPage />} />
        <Route path="requisitions" element={<RequisitionsPage />} />
        <Route path="requisitions/new" element={<RequisitionFormPage />} />
        <Route path="requisitions/:id/edit" element={<RequisitionFormPage />} />
        <Route path="requisitions/:id" element={<RequisitionDetailPage />} />
        <Route path="purchase-orders" element={<PurchaseOrdersPage />} />
        <Route path="purchase-orders/new" element={<PurchaseOrderFormPage />} />
        <Route path="purchase-orders/:id" element={<PurchaseOrderDetailPage />} />
        <Route path="purchase-orders/:id/edit" element={<PurchaseOrderFormPage />} />
        <Route path="receipts" element={<ReceiptsPage />} />
        <Route path="receipts/new" element={<ReceiveGoodsPage />} />
        <Route path="alerts" element={<AlertsPage />} />
        <Route path="audit" element={<AuditPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
