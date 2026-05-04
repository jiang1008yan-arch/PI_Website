import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { AdminRoute, ProtectedRoute } from "./auth/ProtectedRoute";
import { Layout } from "./components/Layout";

const LoginPage = lazy(() => import("./pages/Login").then((module) => ({ default: module.LoginPage })));
const HomePage = lazy(() => import("./pages/Home").then((module) => ({ default: module.HomePage })));
const PermissionsPage = lazy(() => import("./pages/Permissions").then((module) => ({ default: module.PermissionsPage })));
const ProductsPage = lazy(() => import("./pages/Products").then((module) => ({ default: module.ProductsPage })));
const TemplatesPage = lazy(() => import("./pages/Templates").then((module) => ({ default: module.TemplatesPage })));
const PiPage = lazy(() => import("./pages/PiPage").then((module) => ({ default: module.PiPage })));
const ReviewPage = lazy(() => import("./pages/ReviewPage").then((module) => ({ default: module.ReviewPage })));
const ContractsPage = lazy(() => import("./pages/Contracts").then((module) => ({ default: module.ContractsPage })));
const ConfirmedReceivedPisPage = lazy(() =>
  import("./pages/ConfirmedReceivedPis").then((module) => ({ default: module.ConfirmedReceivedPisPage }))
);

export default function App() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-[#63749b]">Loading...</div>}>
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
    </Suspense>
  );
}
