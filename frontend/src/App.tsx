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
import ClientsPage from './pages/super-admin/ClientsPage';
import ClientFormPage from './pages/super-admin/ClientFormPage';
import FormsPage from './pages/super-admin/FormsPage';
import SmtpConfigPage from './pages/super-admin/SmtpConfigPage';

const queryClient = new QueryClient();
const isSuperAdmin = (roles: string[]) => roles.includes('SuperAdmin');

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
                        <Route path="/users" element={<UsersPage />} />
                        <Route path="/roles" element={<RolesPage />} />
                        <Route path="/organization" element={<OrganizationPage />} />
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
