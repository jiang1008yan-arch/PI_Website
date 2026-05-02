import { Navigate, Route, Routes } from "react-router-dom";
import { AdminRoute, ProtectedRoute } from "./auth/ProtectedRoute";
import { Layout } from "./components/Layout";
import { LoginPage } from "./pages/Login";
import { HomePage } from "./pages/Home";
import { PermissionsPage } from "./pages/Permissions";
import { ProductsPage } from "./pages/Products";
import { TemplatesPage } from "./pages/Templates";
import { PiPage } from "./pages/PiPage";
import { ReviewPage } from "./pages/ReviewPage";
import { ContractsPage } from "./pages/Contracts";
import { ConfirmedReceivedPisPage } from "./pages/ConfirmedReceivedPis";

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<ProtectedRoute />}>
        <Route element={<Layout />}>
          <Route index element={<HomePage />} />
          <Route path="/pi/en" element={<PiPage language="EN" />} />
          <Route path="/pi/zh" element={<PiPage language="ZH" />} />
          <Route path="/pi/confirmed-received" element={<ConfirmedReceivedPisPage />} />
          <Route path="/contracts" element={<ContractsPage />} />
          <Route element={<AdminRoute />}>
            <Route path="/products" element={<ProductsPage />} />
            <Route path="/reviews" element={<ReviewPage />} />
            <Route path="/permissions" element={<PermissionsPage />} />
            <Route path="/excel-templates" element={<TemplatesPage />} />
          </Route>
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
