import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from './context/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';
import RoleGate from './components/RoleGate';
import Layout from './components/Layout';
import { Toaster } from '@/components/ui/sonner';
import LoginPage from './pages/LoginPage';
import ForgotPasswordPage from './pages/ForgotPasswordPage';
import ResetPasswordPage from './pages/ResetPasswordPage';
import DashboardPage from './pages/DashboardPage';
import UsersPage from './pages/UsersPage';
import RolesPage from './pages/RolesPage';
import OrganizationPage from './pages/OrganizationPage';
import CustomerCompaniesPage from './pages/CustomerCompaniesPage';
import TenantSmtpConfigPage from './pages/SmtpConfigPage';
import ClientsPage from './pages/super-admin/ClientsPage';
import ClientFormPage from './pages/super-admin/ClientFormPage';
import FormsPage from './pages/super-admin/FormsPage';
import SmtpConfigPage from './pages/super-admin/SmtpConfigPage';
import TemplatesListPage from './pages/templates/TemplatesListPage';
import TemplateDesignerPage from './pages/templates/TemplateDesignerPage';
import PicklistOptionsPage from './pages/PicklistOptionsPage';
import SlaPolicyPage from './pages/SlaPolicyPage';
import ChannelsPage from './pages/ChannelsPage';
import CreateTicketPage from './pages/tickets/CreateTicketPage';
import TicketListPage from './pages/tickets/TicketListPage';
import TicketDetailPage from './pages/tickets/TicketDetailPage';
import KnowledgeBasePage from './pages/KnowledgeBasePage';
import ProjectsPage from './pages/ProjectsPage';

const queryClient = new QueryClient();
const isSuperAdmin = (roles: string[]) => roles.includes('SuperAdmin');
const isTenantAdmin = (roles: string[]) => roles.includes('Admin');
// SMTP settings: admins + agents (Viewer), never customers.
const isStaff = (roles: string[]) => roles.includes('Admin') || roles.includes('Viewer');

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter>
          <Toaster richColors position="top-right" />
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/forgot-password" element={<ForgotPasswordPage />} />
            <Route path="/reset-password" element={<ResetPasswordPage />} />

            <Route
              path="/platform/*"
              element={
                <ProtectedRoute>
                  <RoleGate allow={isSuperAdmin} redirectTo="/dashboard">
                    <Layout>
                      <Routes>
                        <Route path="clients" element={<ClientsPage />} />
                        <Route path="clients/new" element={<ClientFormPage />} />
                        <Route path="clients/:id" element={<ClientFormPage />} />
                        <Route path="forms" element={<FormsPage />} />
                        <Route path="smtp-config" element={<SmtpConfigPage />} />
                        <Route path="*" element={<Navigate to="/platform/clients" replace />} />
                      </Routes>
                    </Layout>
                  </RoleGate>
                </ProtectedRoute>
              }
            />

            <Route
              path="/*"
              element={
                <ProtectedRoute>
                  <RoleGate allow={(roles) => !isSuperAdmin(roles)} redirectTo="/platform/clients">
                    <Layout>
                      <Routes>
                        <Route path="/dashboard" element={<DashboardPage />} />
                        <Route path="/tickets/new" element={<CreateTicketPage />} />
                        <Route path="/tickets/:id" element={<TicketDetailPage />} />
                        <Route path="/tickets" element={<TicketListPage />} />
                        <Route path="/knowledge-base" element={<KnowledgeBasePage />} />
                        <Route path="/projects" element={<ProjectsPage />} />
                        {/* Admin-only sections — non-admins are redirected to their tickets */}
                        <Route path="/users" element={<RoleGate allow={isTenantAdmin} redirectTo="/tickets"><UsersPage /></RoleGate>} />
                        <Route path="/admin/customer-companies" element={<RoleGate allow={isTenantAdmin} redirectTo="/tickets"><CustomerCompaniesPage /></RoleGate>} />
                        <Route path="/roles" element={<RoleGate allow={isTenantAdmin} redirectTo="/tickets"><RolesPage /></RoleGate>} />
                        <Route path="/organization" element={<RoleGate allow={isTenantAdmin} redirectTo="/tickets"><OrganizationPage /></RoleGate>} />
                        <Route path="/admin/templates" element={<RoleGate allow={isTenantAdmin} redirectTo="/tickets"><TemplatesListPage /></RoleGate>} />
                        <Route path="/admin/templates/new" element={<RoleGate allow={isTenantAdmin} redirectTo="/tickets"><TemplateDesignerPage /></RoleGate>} />
                        <Route path="/admin/templates/:id" element={<RoleGate allow={isTenantAdmin} redirectTo="/tickets"><TemplateDesignerPage /></RoleGate>} />
                        <Route path="/admin/picklists" element={<RoleGate allow={isTenantAdmin} redirectTo="/tickets"><PicklistOptionsPage /></RoleGate>} />
                        <Route path="/admin/sla" element={<RoleGate allow={isTenantAdmin} redirectTo="/tickets"><SlaPolicyPage /></RoleGate>} />
                        <Route path="/admin/channels" element={<RoleGate allow={isTenantAdmin} redirectTo="/tickets"><ChannelsPage /></RoleGate>} />
                        <Route path="/admin/smtp-config" element={<RoleGate allow={isStaff} redirectTo="/tickets"><TenantSmtpConfigPage /></RoleGate>} />
                        <Route path="*" element={<Navigate to="/dashboard" replace />} />
                      </Routes>
                    </Layout>
                  </RoleGate>
                </ProtectedRoute>
              }
            />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  );
}
