import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { CheckCircle2, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import api from '../../lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from '@/components/ui/form';

interface SmtpConfigResponse {
  host: string | null;
  port: number;
  useTls: boolean;
  enabled: boolean;
  username: string | null;
  fromAddress: string | null;
  passwordSet: boolean;
}

const smtpSchema = z.object({
  host: z.string().min(1, 'Host is required'),
  port: z.string().refine((v) => Number.isInteger(Number(v)) && Number(v) >= 1 && Number(v) <= 65535, 'Enter a valid port'),
  useTls: z.boolean(),
  enabled: z.boolean(),
  username: z.string().min(1, 'Username is required'),
  password: z.string().optional(),
  fromAddress: z.string().min(1, 'From address is required'),
});
type SmtpValues = z.infer<typeof smtpSchema>;

export default function SmtpConfigPage() {
  const qc = useQueryClient();
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

  const { data, isLoading } = useQuery<SmtpConfigResponse>({
    queryKey: ['smtp-config'],
    queryFn: async () => (await api.get('/api/super-admin/smtp-config')).data,
  });

  const form = useForm<SmtpValues>({
    resolver: zodResolver(smtpSchema),
    defaultValues: {
      host: '', port: '587', useTls: true, enabled: false, username: '', password: '', fromAddress: '',
    },
  });

  useEffect(() => {
    if (!data) return;
    form.reset({
      host: data.host ?? '',
      port: String(data.port ?? 587),
      useTls: data.useTls,
      enabled: data.enabled,
      username: data.username ?? '',
      password: '',
      fromAddress: data.fromAddress ?? '',
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const saveMutation = useMutation({
    mutationFn: (values: SmtpValues) =>
      api.put('/api/super-admin/smtp-config', {
        host: values.host,
        port: Number(values.port),
        useTls: values.useTls,
        enabled: values.enabled,
        username: values.username,
        password: values.password || undefined,
        fromAddress: values.fromAddress,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['smtp-config'] });
      form.setValue('password', '');
    },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error saving SMTP settings'),
  });

  const testMutation = useMutation({
    mutationFn: () => api.post('/api/super-admin/smtp-config/test'),
    onSuccess: (res) => setTestResult(res.data),
    onError: (e: any) => setTestResult({ success: false, message: e.response?.data?.message || 'Connection failed' }),
  });

  const handleSave = form.handleSubmit((values) => {
    setTestResult(null);
    saveMutation.mutate(values, { onSuccess: () => toast.success('SMTP settings saved') });
  });

  const handleSaveAndTest = form.handleSubmit((values) => {
    setTestResult(null);
    saveMutation.mutate(values, {
      onSuccess: () => testMutation.mutate(),
    });
  });

  if (isLoading) return <p className="text-muted-foreground">Loading...</p>;

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold text-foreground">SMTP Configuration</h1>

      <Form {...form}>
        <form className="max-w-2xl space-y-6">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Server Settings</CardTitle>
              <FormField
                control={form.control}
                name="enabled"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-center gap-2 space-y-0">
                    <FormLabel className="text-sm font-normal text-muted-foreground">Enabled</FormLabel>
                    <FormControl>
                      <Switch checked={field.value} onCheckedChange={field.onChange} />
                    </FormControl>
                  </FormItem>
                )}
              />
            </CardHeader>
            <CardContent className="space-y-4">
              <FormField
                control={form.control}
                name="host"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Host</FormLabel>
                    <FormControl><Input placeholder="e.g. smtp.gmail.com" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="port"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Port</FormLabel>
                    <FormControl><Input type="number" placeholder="587" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="useTls"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3">
                    <FormLabel>Use TLS (STARTTLS)</FormLabel>
                    <FormControl>
                      <Switch checked={field.value} onCheckedChange={field.onChange} />
                    </FormControl>
                  </FormItem>
                )}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Authentication</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <FormField
                control={form.control}
                name="username"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Username</FormLabel>
                    <FormControl><Input placeholder="e.g. no-reply@yourcompany.com" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <div className="flex items-center gap-2">
                      <FormLabel>Password</FormLabel>
                      {data?.passwordSet && <Badge variant="success">Saved</Badge>}
                    </div>
                    <FormControl>
                      <Input
                        type="password"
                        placeholder={data?.passwordSet ? 'Leave blank to keep current password' : 'Enter password'}
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="fromAddress"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>From Address</FormLabel>
                    <FormControl><Input placeholder="Display Name <no-reply@yourcompany.com>" {...field} /></FormControl>
                    <FormDescription>Shown as the sender on outgoing emails.</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
          </Card>

          {testResult && (
            <div
              className={`flex items-center gap-2 rounded-lg border p-3 text-sm ${
                testResult.success
                  ? 'border-success/30 bg-success/10 text-success'
                  : 'border-destructive/30 bg-destructive/10 text-destructive'
              }`}
            >
              {testResult.success ? <CheckCircle2 className="size-4 shrink-0" /> : <XCircle className="size-4 shrink-0" />}
              {testResult.message}
            </div>
          )}

          <div className="flex gap-3">
            <Button type="button" onClick={handleSave} disabled={saveMutation.isPending}>
              {saveMutation.isPending ? 'Saving...' : 'Save Settings'}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={handleSaveAndTest}
              disabled={saveMutation.isPending || testMutation.isPending}
            >
              {testMutation.isPending ? 'Testing...' : 'Save & Test Connection'}
            </Button>
          </div>
        </form>
      </Form>
    </div>
  );
}
