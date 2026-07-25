import { useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Building2, X } from 'lucide-react';
import { toast } from 'sonner';
import api from '../lib/api';
import { assetUrl } from '@/lib/assetUrl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';

interface License {
  plan: string; maxUsers: number; expiryDate: string;
  status: 'ACTIVE' | 'EXPIRED' | 'CANCELLED';
}
interface MyClientDetail {
  id: string; name: string; code: string; status: 'ACTIVE' | 'SUSPENDED' | 'TRIAL';
  contactEmail?: string | null; contactPhone?: string | null; logoUrl?: string | null;
  license: License | null; _count: { users: number };
}

const orgSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  contactEmail: z.string().email('Enter a valid email').optional().or(z.literal('')),
  contactPhone: z.string().optional(),
});
type OrgValues = z.infer<typeof orgSchema>;

const statusVariant: Record<MyClientDetail['status'], 'success' | 'destructive' | 'secondary'> = {
  ACTIVE: 'success',
  SUSPENDED: 'destructive',
  TRIAL: 'secondary',
};

export default function OrganizationPage() {
  const qc = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: client, isLoading } = useQuery<MyClientDetail>({
    queryKey: ['my-client-detail'],
    queryFn: async () => (await api.get('/api/my-client')).data,
  });

  const form = useForm<OrgValues>({
    resolver: zodResolver(orgSchema),
    defaultValues: { name: '', contactEmail: '', contactPhone: '' },
  });

  useEffect(() => {
    if (!client) return;
    form.reset({
      name: client.name,
      contactEmail: client.contactEmail ?? '',
      contactPhone: client.contactPhone ?? '',
    });
  }, [client, form]);

  const updateMutation = useMutation({
    mutationFn: (values: OrgValues) =>
      api.put('/api/my-client', {
        ...values,
        contactEmail: values.contactEmail || undefined,
        contactPhone: values.contactPhone || undefined,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['my-client-detail'] });
      qc.invalidateQueries({ queryKey: ['my-client'] });
      toast.success('Organization details updated');
    },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error updating organization'),
  });

  const uploadLogoMutation = useMutation({
    mutationFn: (file: File) => {
      const formData = new FormData();
      formData.append('logo', file);
      return api.post('/api/my-client/logo', formData);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['my-client-detail'] });
      qc.invalidateQueries({ queryKey: ['my-client'] });
      toast.success('Logo updated');
    },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error uploading logo'),
  });

  const removeLogoMutation = useMutation({
    mutationFn: () => api.delete('/api/my-client/logo'),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['my-client-detail'] });
      qc.invalidateQueries({ queryKey: ['my-client'] });
      toast.success('Logo removed');
    },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error removing logo'),
  });

  if (isLoading || !client) return <p className="text-muted-foreground">Loading...</p>;

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold text-foreground">Organization</h1>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Organization Information</CardTitle></CardHeader>
          <CardContent>
            <div className="mb-6 flex items-center gap-4">
              {client.logoUrl ? (
                <img src={assetUrl(client.logoUrl)!} alt={client.name} className="size-16 rounded-lg border object-cover" />
              ) : (
                <div className="flex size-16 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Building2 className="size-7" />
                </div>
              )}
              <div className="flex flex-col gap-1.5">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) uploadLogoMutation.mutate(file);
                    e.target.value = '';
                  }}
                />
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploadLogoMutation.isPending}
                  >
                    {uploadLogoMutation.isPending ? 'Uploading...' : 'Change Logo'}
                  </Button>
                  {client.logoUrl && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => removeLogoMutation.mutate()}
                      disabled={removeLogoMutation.isPending}
                    >
                      <X className="size-4" /> Remove
                    </Button>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">PNG or JPG, up to 2MB.</p>
              </div>
            </div>

            <Form {...form}>
              <form onSubmit={form.handleSubmit((v) => updateMutation.mutate(v))} className="space-y-4">
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Name</FormLabel>
                      <FormControl><Input {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <div className="flex items-center gap-3">
                  <div className="flex-1">
                    <FormLabel className="mb-2 block">Code</FormLabel>
                    <Input value={client.code} disabled />
                  </div>
                  <div>
                    <FormLabel className="mb-2 block">Status</FormLabel>
                    <Badge variant={statusVariant[client.status]}>{client.status}</Badge>
                  </div>
                </div>
                <FormField
                  control={form.control}
                  name="contactEmail"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Contact Email</FormLabel>
                      <FormControl><Input type="email" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="contactPhone"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Contact Phone</FormLabel>
                      <FormControl><Input {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <Button type="submit" disabled={updateMutation.isPending}>
                  {updateMutation.isPending ? 'Saving...' : 'Save'}
                </Button>
              </form>
            </Form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>License</CardTitle></CardHeader>
          <CardContent>
            {client.license ? (
              <dl className="space-y-3 text-sm">
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Plan</dt>
                  <dd className="font-medium text-foreground">{client.license.plan}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Seats</dt>
                  <dd className="font-medium text-foreground">{client._count.users} / {client.license.maxUsers}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Expiry</dt>
                  <dd className="font-medium text-foreground">{new Date(client.license.expiryDate).toLocaleDateString()}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Status</dt>
                  <dd>
                    <Badge variant={client.license.status === 'ACTIVE' ? 'success' : 'destructive'}>
                      {client.license.status}
                    </Badge>
                  </dd>
                </div>
              </dl>
            ) : (
              <p className="text-sm text-muted-foreground">No license on file. Contact your platform administrator.</p>
            )}
            <p className="mt-4 text-xs text-muted-foreground">
              License and billing details are managed by your platform administrator.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
