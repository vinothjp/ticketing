import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import api from '../../../lib/api';

// Module-scope helpers keep a stable identity so inputs don't remount (focus loss).
export function Field({ label, children, className = '' }: { label: string; children: React.ReactNode; className?: string }) {
  return <div className={`space-y-1.5 ${className}`}><label className="text-sm font-medium">{label}</label>{children}</div>;
}

export function Section({ title, children, cols = 2 }: { title: string; children: React.ReactNode; cols?: 1 | 2 }) {
  return (
    <section className="rounded-lg border p-4">
      <h2 className="mb-3 text-sm font-semibold text-foreground">{title}</h2>
      <div className={cols === 1 ? 'space-y-3' : 'grid grid-cols-1 gap-3 sm:grid-cols-2'}>{children}</div>
    </section>
  );
}

// Shared PATCH mutation for a CR detail section (invalidates the CR tree + toasts).
export function useCrSaver(crId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: Record<string, unknown>) => api.patch(`/api/change-requests/${crId}`, patch),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['change-requests'] }); toast.success('Change request saved'); },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error saving change request'),
  });
}
