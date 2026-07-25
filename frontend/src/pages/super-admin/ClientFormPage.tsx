import { useEffect, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { ArrowLeft, Plus, Building2, X } from 'lucide-react';
import { toast } from 'sonner';
import api from '../../lib/api';
import { assetUrl } from '@/lib/assetUrl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from '@/components/ui/form';

interface ClientUser {
  id: string;
  username: string;
  email: string;
  isActive: boolean;
  userRoles: { role: { name: string } }[];
}
interface License {
  plan: string; maxUsers: number; startDate: string; expiryDate: string;
  status: 'ACTIVE' | 'EXPIRED' | 'CANCELLED'; notes?: string | null;
}
interface ClientDetail {
  id: string; name: string; code: string; status: 'ACTIVE' | 'SUSPENDED' | 'TRIAL';
  contactEmail?: string | null; contactPhone?: string | null; logoUrl?: string | null;
  license: License | null; users: ClientUser[]; _count: { users: number };
}

const toDateInput = (iso: string) => (iso ? iso.slice(0, 10) : '');

function BackLink() {
  return (
    <Link
      to="/platform/clients"
      className="mb-4 flex w-fit items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft className="size-4" /> Back to Clients
    </Link>
  );
}

export default function ClientFormPage() {
  const { id } = useParams<{ id: string }>();
  return id ? <EditClientForm id={id} /> : <NewClientForm />;
}

// ---------------------------------------------------------------------------
// New client — one combined form: client info + optional license + optional admin user
// ---------------------------------------------------------------------------

const newClientSchema = z
  .object({
    name: z.string().min(1, 'Name is required'),
    code: z.string().min(1, 'Code is required'),
    contactEmail: z.string().email('Enter a valid email').optional().or(z.literal('')),
    contactPhone: z.string().optional(),
    status: z.enum(['ACTIVE', 'SUSPENDED', 'TRIAL']),

    createLicense: z.boolean(),
    licensePlan: z.string().optional(),
    licenseMaxUsers: z.string().optional(),
    licenseStartDate: z.string().optional(),
    licenseExpiryDate: z.string().optional(),

    createAdminUser: z.boolean(),
    adminUsername: z.string().optional(),
    adminEmail: z.string().optional(),
    adminPassword: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.createLicense) {
      if (!data.licensePlan) {
        ctx.addIssue({ path: ['licensePlan'], code: z.ZodIssueCode.custom, message: 'Plan is required' });
      }
      if (!data.licenseMaxUsers || !Number.isInteger(Number(data.licenseMaxUsers)) || Number(data.licenseMaxUsers) < 1) {
        ctx.addIssue({ path: ['licenseMaxUsers'], code: z.ZodIssueCode.custom, message: 'Must be at least 1' });
      }
      if (!data.licenseStartDate) {
        ctx.addIssue({ path: ['licenseStartDate'], code: z.ZodIssueCode.custom, message: 'Start date is required' });
      }
      if (!data.licenseExpiryDate) {
        ctx.addIssue({ path: ['licenseExpiryDate'], code: z.ZodIssueCode.custom, message: 'Expiry date is required' });
      }
    }
    if (data.createAdminUser) {
      if (!data.adminUsername) {
        ctx.addIssue({ path: ['adminUsername'], code: z.ZodIssueCode.custom, message: 'Admin username is required' });
      }
      if (!data.adminEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.adminEmail)) {
        ctx.addIssue({ path: ['adminEmail'], code: z.ZodIssueCode.custom, message: 'Enter a valid admin email' });
      }
      if (!data.adminPassword || data.adminPassword.length < 8) {
        ctx.addIssue({ path: ['adminPassword'], code: z.ZodIssueCode.custom, message: 'Min 8 characters' });
      }
    }
  });
type NewClientValues = z.infer<typeof newClientSchema>;

function NewClientForm() {
  const navigate = useNavigate();
  const qc = useQueryClient();

  const form = useForm<NewClientValues>({
    resolver: zodResolver(newClientSchema),
    defaultValues: {
      name: '', code: '', contactEmail: '', contactPhone: '', status: 'ACTIVE',
      createLicense: true, licensePlan: '', licenseMaxUsers: '25', licenseStartDate: '', licenseExpiryDate: '',
      createAdminUser: true, adminUsername: '', adminEmail: '', adminPassword: '',
    },
  });
  const createLicense = form.watch('createLicense');
  const createAdminUser = form.watch('createAdminUser');

  const createMutation = useMutation({
    mutationFn: (values: NewClientValues) =>
      api.post('/api/super-admin/clients', {
        name: values.name,
        code: values.code,
        contactEmail: values.contactEmail || undefined,
        contactPhone: values.contactPhone || undefined,
        status: values.status,
        createLicense: values.createLicense,
        licensePlan: values.createLicense ? values.licensePlan : undefined,
        licenseMaxUsers: values.createLicense ? Number(values.licenseMaxUsers) : undefined,
        licenseStartDate: values.createLicense ? values.licenseStartDate : undefined,
        licenseExpiryDate: values.createLicense ? values.licenseExpiryDate : undefined,
        createAdminUser: values.createAdminUser,
        adminUsername: values.createAdminUser ? values.adminUsername : undefined,
        adminEmail: values.createAdminUser ? values.adminEmail : undefined,
        adminPassword: values.createAdminUser ? values.adminPassword : undefined,
      }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['super-admin-clients'] });
      toast.success('Client created');
      navigate(`/platform/clients/${res.data.id}`);
    },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error creating client'),
  });

  return (
    <div>
      <BackLink />
      <h1 className="mb-6 text-2xl font-bold text-foreground">New Client</h1>

      <Form {...form}>
        <form onSubmit={form.handleSubmit((v) => createMutation.mutate(v))} className="max-w-2xl space-y-6">
          <Card>
            <CardHeader><CardTitle>Client Information</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Name</FormLabel>
                    <FormControl><Input placeholder="e.g. Acme Corp" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="code"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Code</FormLabel>
                    <FormControl><Input placeholder="e.g. ACME" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="contactEmail"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Contact Email</FormLabel>
                    <FormControl><Input type="email" placeholder="Optional" {...field} /></FormControl>
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
                    <FormControl><Input placeholder="Optional" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="status"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Status</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="ACTIVE">Active</SelectItem>
                        <SelectItem value="SUSPENDED">Suspended</SelectItem>
                        <SelectItem value="TRIAL">Trial</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>License</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <FormField
                control={form.control}
                name="createLicense"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3">
                    <div className="space-y-0.5">
                      <FormLabel>Set up a license</FormLabel>
                      <FormDescription>Users can't sign in until the client has an active license.</FormDescription>
                    </div>
                    <FormControl>
                      <Switch checked={field.value} onCheckedChange={field.onChange} />
                    </FormControl>
                  </FormItem>
                )}
              />

              {createLicense && (
                <div className="space-y-4 rounded-lg border border-dashed p-3">
                  <FormField
                    control={form.control}
                    name="licensePlan"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Plan</FormLabel>
                        <FormControl><Input placeholder="e.g. Enterprise" {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="licenseMaxUsers"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Seat Limit</FormLabel>
                        <FormControl><Input type="number" min={1} {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <div className="grid grid-cols-2 gap-3">
                    <FormField
                      control={form.control}
                      name="licenseStartDate"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Start Date</FormLabel>
                          <FormControl><Input type="date" {...field} /></FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="licenseExpiryDate"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Expiry Date</FormLabel>
                          <FormControl><Input type="date" {...field} /></FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Admin User</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <FormField
                control={form.control}
                name="createAdminUser"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3">
                    <div className="space-y-0.5">
                      <FormLabel>Create admin user</FormLabel>
                      <FormDescription>Adds a client Admin role and its first user so they can sign in right away.</FormDescription>
                    </div>
                    <FormControl>
                      <Switch checked={field.value} onCheckedChange={field.onChange} />
                    </FormControl>
                  </FormItem>
                )}
              />

              {createAdminUser && (
                <div className="space-y-4 rounded-lg border border-dashed p-3">
                  <FormField
                    control={form.control}
                    name="adminUsername"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Admin Username</FormLabel>
                        <FormControl><Input placeholder="e.g. admin" {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="adminEmail"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Admin Email</FormLabel>
                        <FormControl><Input type="email" placeholder="e.g. admin@client.com" {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="adminPassword"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Admin Password</FormLabel>
                        <FormControl><Input type="password" placeholder="Min 8 characters" {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              )}
            </CardContent>
          </Card>

          <Button type="submit" disabled={createMutation.isPending}>
            {createMutation.isPending ? 'Creating...' : 'Create Client'}
          </Button>
        </form>
      </Form>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Edit client — independent client info / license / users sections
// ---------------------------------------------------------------------------

const clientSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  code: z.string().min(1, 'Code is required'),
  contactEmail: z.string().email('Enter a valid email').optional().or(z.literal('')),
  contactPhone: z.string().optional(),
  status: z.enum(['ACTIVE', 'SUSPENDED', 'TRIAL']),
});
type ClientValues = z.infer<typeof clientSchema>;

const licenseSchema = z.object({
  plan: z.string().min(1, 'Plan is required'),
  maxUsers: z.string().refine((v) => Number.isInteger(Number(v)) && Number(v) >= 1, 'Must be at least 1'),
  startDate: z.string().min(1, 'Start date is required'),
  expiryDate: z.string().min(1, 'Expiry date is required'),
  status: z.enum(['ACTIVE', 'EXPIRED', 'CANCELLED']),
  notes: z.string().optional(),
});
type LicenseValues = z.infer<typeof licenseSchema>;

const addUserSchema = z.object({
  username: z.string().min(1, 'Username is required'),
  email: z.string().email('Enter a valid email'),
  password: z.string().min(8, 'Min 8 characters'),
});
type AddUserValues = z.infer<typeof addUserSchema>;

function EditClientForm({ id }: { id: string }) {
  const qc = useQueryClient();

  const { data: client, isLoading } = useQuery<ClientDetail>({
    queryKey: ['super-admin-client', id],
    queryFn: async () => (await api.get(`/api/super-admin/clients/${id}`)).data,
  });

  const clientForm = useForm<ClientValues>({
    resolver: zodResolver(clientSchema),
    defaultValues: { name: '', code: '', contactEmail: '', contactPhone: '', status: 'ACTIVE' },
  });

  const licenseForm = useForm<LicenseValues>({
    resolver: zodResolver(licenseSchema),
    defaultValues: { plan: '', maxUsers: '1', startDate: '', expiryDate: '', status: 'ACTIVE', notes: '' },
  });

  const userForm = useForm<AddUserValues>({
    resolver: zodResolver(addUserSchema),
    defaultValues: { username: '', email: '', password: '' },
  });

  useEffect(() => {
    if (!client) return;
    clientForm.reset({
      name: client.name,
      code: client.code,
      contactEmail: client.contactEmail ?? '',
      contactPhone: client.contactPhone ?? '',
      status: client.status,
    });
    licenseForm.reset({
      plan: client.license?.plan ?? '',
      maxUsers: String(client.license?.maxUsers ?? 1),
      startDate: toDateInput(client.license?.startDate ?? ''),
      expiryDate: toDateInput(client.license?.expiryDate ?? ''),
      status: client.license?.status ?? 'ACTIVE',
      notes: client.license?.notes ?? '',
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client]);

  const updateClientMutation = useMutation({
    mutationFn: (values: ClientValues) =>
      api.put(`/api/super-admin/clients/${id}`, {
        ...values,
        contactEmail: values.contactEmail || undefined,
        contactPhone: values.contactPhone || undefined,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['super-admin-client', id] });
      qc.invalidateQueries({ queryKey: ['super-admin-clients'] });
      toast.success('Client updated');
    },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error updating client'),
  });

  const saveLicenseMutation = useMutation({
    mutationFn: (values: LicenseValues) =>
      api.put(`/api/super-admin/clients/${id}/license`, { ...values, maxUsers: Number(values.maxUsers) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['super-admin-client', id] });
      qc.invalidateQueries({ queryKey: ['super-admin-clients'] });
      toast.success('License saved');
    },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error saving license'),
  });

  const addUserMutation = useMutation({
    mutationFn: (values: AddUserValues) => api.post(`/api/super-admin/clients/${id}/users`, values),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['super-admin-client', id] });
      qc.invalidateQueries({ queryKey: ['super-admin-clients'] });
      userForm.reset();
      toast.success('User added');
    },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error adding user'),
  });

  const fileInputRef = useRef<HTMLInputElement>(null);

  const uploadLogoMutation = useMutation({
    mutationFn: (file: File) => {
      const formData = new FormData();
      formData.append('logo', file);
      return api.post(`/api/super-admin/clients/${id}/logo`, formData);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['super-admin-client', id] });
      qc.invalidateQueries({ queryKey: ['super-admin-clients'] });
      toast.success('Logo updated');
    },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error uploading logo'),
  });

  const removeLogoMutation = useMutation({
    mutationFn: () => api.delete(`/api/super-admin/clients/${id}/logo`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['super-admin-client', id] });
      qc.invalidateQueries({ queryKey: ['super-admin-clients'] });
      toast.success('Logo removed');
    },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error removing logo'),
  });

  if (isLoading || !client) return <p className="text-muted-foreground">Loading...</p>;

  return (
    <div>
      <BackLink />
      <h1 className="mb-6 text-2xl font-bold text-foreground">{client.name}</h1>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Client Information</CardTitle></CardHeader>
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

            <Form {...clientForm}>
              <form onSubmit={clientForm.handleSubmit((v) => updateClientMutation.mutate(v))} className="space-y-4">
                <FormField
                  control={clientForm.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Name</FormLabel>
                      <FormControl><Input {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={clientForm.control}
                  name="code"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Code</FormLabel>
                      <FormControl><Input {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={clientForm.control}
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
                  control={clientForm.control}
                  name="contactPhone"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Contact Phone</FormLabel>
                      <FormControl><Input {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={clientForm.control}
                  name="status"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Status</FormLabel>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <FormControl>
                          <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="ACTIVE">Active</SelectItem>
                          <SelectItem value="SUSPENDED">Suspended</SelectItem>
                          <SelectItem value="TRIAL">Trial</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <Button type="submit" disabled={updateClientMutation.isPending}>
                  {updateClientMutation.isPending ? 'Saving...' : 'Save Client'}
                </Button>
              </form>
            </Form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>License</CardTitle></CardHeader>
          <CardContent>
            <Form {...licenseForm}>
              <form onSubmit={licenseForm.handleSubmit((v) => saveLicenseMutation.mutate(v))} className="space-y-4">
                <FormField
                  control={licenseForm.control}
                  name="plan"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Plan</FormLabel>
                      <FormControl><Input placeholder="e.g. Enterprise" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={licenseForm.control}
                  name="maxUsers"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Seat Limit</FormLabel>
                      <FormControl><Input type="number" min={1} {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <div className="grid grid-cols-2 gap-3">
                  <FormField
                    control={licenseForm.control}
                    name="startDate"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Start Date</FormLabel>
                        <FormControl><Input type="date" {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={licenseForm.control}
                    name="expiryDate"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Expiry Date</FormLabel>
                        <FormControl><Input type="date" {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                <FormField
                  control={licenseForm.control}
                  name="status"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Status</FormLabel>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <FormControl>
                          <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="ACTIVE">Active</SelectItem>
                          <SelectItem value="EXPIRED">Expired</SelectItem>
                          <SelectItem value="CANCELLED">Cancelled</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={licenseForm.control}
                  name="notes"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Notes</FormLabel>
                      <FormControl><Input placeholder="Optional" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <Button type="submit" disabled={saveLicenseMutation.isPending}>
                  {saveLicenseMutation.isPending ? 'Saving...' : 'Save License'}
                </Button>
              </form>
            </Form>
          </CardContent>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader><CardTitle>Admin Users</CardTitle></CardHeader>
        <CardContent className="space-y-6">
          {client.users.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Username</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Roles</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {client.users.map((u) => (
                  <TableRow key={u.id}>
                    <TableCell className="font-medium">{u.username}</TableCell>
                    <TableCell>{u.email}</TableCell>
                    <TableCell>{u.userRoles.map((r) => r.role.name).join(', ') || '—'}</TableCell>
                    <TableCell>
                      <Badge variant={u.isActive ? 'success' : 'destructive'}>
                        {u.isActive ? 'Active' : 'Inactive'}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="text-sm text-muted-foreground">No users yet for this client.</p>
          )}

          <Form {...userForm}>
            <form
              onSubmit={userForm.handleSubmit((v) => addUserMutation.mutate(v))}
              className="grid gap-4 rounded-lg border border-dashed p-4 sm:grid-cols-3 sm:items-end"
            >
              <FormField
                control={userForm.control}
                name="username"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Username</FormLabel>
                    <FormControl><Input placeholder="e.g. admin" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={userForm.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email</FormLabel>
                    <FormControl><Input type="email" placeholder="e.g. admin@client.com" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={userForm.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Password</FormLabel>
                    <FormControl><Input type="password" placeholder="Min 8 characters" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="sm:col-span-3">
                <Button type="submit" disabled={addUserMutation.isPending}>
                  <Plus className="size-4" />
                  {addUserMutation.isPending ? 'Adding...' : 'Add User'}
                </Button>
              </div>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
