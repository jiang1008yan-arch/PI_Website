import { Navigate, Route, Routes } from "react-router-dom";
import { AdminRoute, ProtectedRoute, RoleRoute } from "./auth/ProtectedRoute";
import { Layout } from "./components/Layout";
import { ApprovedPisPage } from "./pages/ApprovedPisPage";
import { ChangePasswordPage } from "./pages/ChangePassword";
import { CommerceQueuePage } from "./pages/CommerceQueuePage";
import { ConfirmedReceivedPisPage } from "./pages/ConfirmedReceivedPis";
import { ContractsPage } from "./pages/Contracts";
import { CreateTicketPage } from "./pages/CreateTicket";
import { FaultAnalyticsPage } from "./pages/FaultAnalyticsPage";
import { FeishuBindPage } from "./pages/FeishuBindPage";
import { HomePage } from "./pages/Home";
import { LoginPage } from "./pages/Login";
import { PermissionsPage } from "./pages/Permissions";
import { PiDetailPage } from "./pages/PiDetailPage";
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
          </Route>
          <Route element={<RoleRoute allow={["ADMIN", "SALES", "COMMERCE"]} />}>
            <Route path="/contracts" element={<ContractsPage />} />
          </Route>
          <Route path="/feishu/bind" element={<FeishuBindPage />} />
          {/* Read-only PI view; the server decides which PIs each role may open. */}
          <Route path="/pi/view/:id" element={<PiDetailPage />} />
          <Route element={<RoleRoute allow={["ADMIN", "COMMERCE", "SERVICE"]} />}>
            <Route path="/pi/approved" element={<ApprovedPisPage />} />
          </Route>
          <Route element={<RoleRoute allow={["ADMIN", "COMMERCE"]} />}>
            <Route path="/commerce" element={<CommerceQueuePage />} />
          </Route>
          <Route element={<RoleRoute allow={["ADMIN", "SALES", "SERVICE"]} />}>
            <Route path="/tickets" element={<TicketsPage />} />
            <Route path="/tickets/new" element={<CreateTicketPage />} />
            <Route path="/tickets/:id" element={<TicketDetailPage />} />
            {/* Fault analytics: statistics for all three; settings tab for ADMIN/SERVICE. */}
            <Route path="/fault-analytics" element={<FaultAnalyticsPage />} />
          </Route>
          <Route element={<AdminRoute />}>
            <Route path="/ticket-fields-config" element={<TicketFieldsConfigPage />} />
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
