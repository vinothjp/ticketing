import SmtpConfigForm from './super-admin/SmtpConfigPage';

// Tenant-level SMTP settings (Admin + Agents) — reuses the shared form, scoped to the org.
export default function SmtpConfigPage() {
  return <SmtpConfigForm basePath="/api/smtp-config" queryKey="tenant-smtp-config" />;
}
