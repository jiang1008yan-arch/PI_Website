import { Navigate, Route, Routes } from "react-router-dom";
import { AdminRoute, ProtectedRoute, RoleRoute } from "./auth/ProtectedRoute";
import { Layout } from "./components/Layout";
import { AiSettingsPage } from "./pages/AiSettings";
import { ApprovedPisPage } from "./pages/ApprovedPisPage";
import { ChangePasswordPage } from "./pages/ChangePassword";
import { CommerceQueuePage } from "./pages/CommerceQueuePage";
import { ConfirmedReceivedPisPage } from "./pages/ConfirmedReceivedPis";
import { ContractsPage } from "./pages/Contracts";
import { CreateTicketPage } from "./pages/CreateTicket";
import { FaultAnalyticsPage } from "./pages/FaultAnalyticsPage";
import { HomePage } from "./pages/Home";
import { LoginPage } from "./pages/Login";
import { PermissionsPage } from "./pages/Permissions";
import { PiDetailPage } from "./pages/PiDetailPage";
import { PiPage } from "./pages/PiPage";
import { ProductsPage } from "./pages/Products";
import { RequirementPoolPage } from "./pages/RequirementPoolPage";
import { ReviewPage } from "./pages/ReviewPage";
import { TemplatesPage } from "./pages/Templates";
import { TicketDetailPage } from "./pages/TicketDetail";
import { TicketNotificationsPage } from "./pages/TicketNotificationsPage";
import { TicketsPage } from "./pages/Tickets";

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<ProtectedRoute />}>
        <Route element={<Layout />}>
          <Route index element={<HomePage />} />
          <Route path="/change-password" element={<ChangePasswordPage />} />
          <Route path="/account/ai" element={<AiSettingsPage />} />
          {/* PI + contract pages are for ADMIN/SALES; SERVICE is ticket-only. */}
          <Route element={<RoleRoute allow={["ADMIN", "SALES"]} />}>
            <Route path="/pi/en" element={<PiPage language="EN" />} />
            <Route path="/pi/confirmed-received" element={<ConfirmedReceivedPisPage />} />
          </Route>
          {/* PRESALES opens Chinese PIs from the review queue to confirm them. */}
          <Route element={<RoleRoute allow={["ADMIN", "SALES", "PRESALES"]} />}>
            <Route path="/pi/zh" element={<PiPage language="ZH" />} />
          </Route>
          <Route element={<RoleRoute allow={["ADMIN", "PRESALES"]} />}>
            <Route path="/reviews" element={<ReviewPage />} />
          </Route>
          <Route element={<RoleRoute allow={["ADMIN", "SALES", "COMMERCE"]} />}>
            <Route path="/contracts" element={<ContractsPage />} />
          </Route>
          {/* Read-only PI view; the server decides which PIs each role may open. */}
          <Route path="/pi/view/:id" element={<PiDetailPage />} />
          <Route element={<RoleRoute allow={["ADMIN", "COMMERCE", "SERVICE", "PRESALES"]} />}>
            <Route path="/pi/approved" element={<ApprovedPisPage />} />
          </Route>
          <Route element={<RoleRoute allow={["ADMIN", "COMMERCE"]} />}>
            <Route path="/commerce" element={<CommerceQueuePage />} />
          </Route>
          <Route element={<RoleRoute allow={["ADMIN", "SALES", "SERVICE"]} />}>
            <Route path="/tickets" element={<TicketsPage />} />
            <Route path="/tickets/:id" element={<TicketDetailPage />} />
            {/* Fault analytics: statistics for all three; settings tab for ADMIN/SERVICE. */}
            <Route path="/fault-analytics" element={<FaultAnalyticsPage />} />
          </Route>
          <Route element={<RoleRoute allow={["ADMIN", "SERVICE"]} />}>
            <Route path="/tickets/new" element={<CreateTicketPage />} />
          </Route>
          <Route element={<AdminRoute />}>
            <Route path="/products" element={<ProductsPage />} />
            <Route path="/permissions" element={<PermissionsPage />} />
            <Route path="/excel-templates" element={<TemplatesPage />} />
            <Route path="/requirement-pool" element={<RequirementPoolPage />} />
            <Route path="/ticket-notifications" element={<TicketNotificationsPage />} />
          </Route>
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
