import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function RoleGate({
  allow,
  redirectTo,
  children,
}: {
  allow: (roles: string[]) => boolean;
  redirectTo: string;
  children: ReactNode;
}) {
  const { user } = useAuth();
  if (!user || !allow(user.roles)) return <Navigate to={redirectTo} replace />;
  return <>{children}</>;
}
