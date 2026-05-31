import { Navigate, Route, Routes } from "react-router-dom";
import { AdminRoute, ProtectedRoute, RoleRoute } from "./auth/ProtectedRoute";
import { Layout } from "./components/Layout";
import { ChangePasswordPage } from "./pages/ChangePassword";
import { ConfirmedReceivedPisPage } from "./pages/ConfirmedReceivedPis";
import { ContractsPage } from "./pages/Contracts";
import { CreateTicketPage } from "./pages/CreateTicket";
import { HomePage } from "./pages/Home";
import { LoginPage } from "./pages/Login";
import { PermissionsPage } from "./pages/Permissions";
import { PiPage } from "./pages/PiPage";
import { ProductsPage } from "./pages/Products";
import { PublicTicketForm } from "./pages/PublicTicketForm";
import { ReviewPage } from "./pages/ReviewPage";
import { TemplatesPage } from "./pages/Templates";
import { TicketDetailPage } from "./pages/TicketDetail";
import { TicketFieldsConfigPage } from "./pages/TicketFieldsConfig";
import { TicketsPage } from "./pages/Tickets";

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/ticket/new" element={<PublicTicketForm />} />
      <Route element={<ProtectedRoute />}>
        <Route element={<Layout />}>
          <Route index element={<HomePage />} />
          <Route path="/change-password" element={<ChangePasswordPage />} />
          {/* PI + contract pages are for ADMIN/SALES; SERVICE is ticket-only. */}
          <Route element={<RoleRoute allow={["ADMIN", "SALES"]} />}>
            <Route path="/pi/en" element={<PiPage language="EN" />} />
            <Route path="/pi/zh" element={<PiPage language="ZH" />} />
            <Route path="/pi/confirmed-received" element={<ConfirmedReceivedPisPage />} />
            <Route path="/contracts" element={<ContractsPage />} />
          </Route>
          <Route path="/tickets" element={<TicketsPage />} />
          <Route path="/tickets/new" element={<CreateTicketPage />} />
          <Route path="/tickets/:id" element={<TicketDetailPage />} />
          {/* Questionnaire shapes the after-sales form, so SERVICE can edit it too. */}
          <Route element={<RoleRoute allow={["ADMIN", "SERVICE"]} />}>
            <Route path="/ticket-fields-config" element={<TicketFieldsConfigPage />} />
          </Route>
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
