import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import api from '../lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';

interface Channel { id: string; type: string; enabled: boolean; configured: boolean; fromIdentity?: string | null; }

export default function ChannelsPage() {
  const qc = useQueryClient();
  const [host, setHost] = useState('');
  const [port, setPort] = useState('993');
  const [user, setUser] = useState('');
  const [password, setPassword] = useState('');
  const [tls, setTls] = useState(true);
  const [enabled, setEnabled] = useState(false);

  const { data: channels = [] } = useQuery<Channel[]>({
    queryKey: ['messaging-channels'],
    queryFn: async () => (await api.get('/api/messaging-channels')).data,
  });
  const imap = channels.find((c) => c.type === 'EMAIL_IMAP');

  useEffect(() => {
    if (imap) {
      setEnabled(imap.enabled);
      setUser(imap.fromIdentity ?? '');
    }
  }, [imap?.id]);

  const save = useMutation({
    mutationFn: () =>
      api.put('/api/messaging-channels', {
        type: 'EMAIL_IMAP',
        provider: 'imap',
        enabled,
        fromIdentity: user,
        // Only send credentials when the password field is filled (avoids overwriting with blanks).
        ...(host || password
          ? { config: { host, port: Number(port) || 993, user, password, tls } }
          : {}),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['messaging-channels'] });
      setPassword('');
      toast.success('Inbound email settings saved');
    },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error saving settings'),
  });

  return (
    <div className="max-w-xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-foreground">Inbound Email (IMAP)</h1>
        <p className="text-sm text-muted-foreground">
          Connect a support mailbox so requester email replies thread back onto their tickets. Outbound
          email uses your SMTP settings.
          {imap?.configured ? ' A mailbox is configured.' : ' Not configured yet.'}
        </p>
      </div>

      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-3">
          <div className="col-span-2 space-y-1.5">
            <label className="text-sm font-medium">IMAP host</label>
            <Input value={host} onChange={(e) => setHost(e.target.value)} placeholder="imap.gmail.com" />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Port</label>
            <Input value={port} onChange={(e) => setPort(e.target.value)} placeholder="993" />
          </div>
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-medium">Mailbox address / username</label>
          <Input value={user} onChange={(e) => setUser(e.target.value)} placeholder="support@yourhospital.ae" />
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-medium">Password / app password</label>
          <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={imap?.configured ? '•••••••• (leave blank to keep)' : ''} />
        </div>
        <label className="flex items-center gap-2 text-sm"><Switch checked={tls} onCheckedChange={setTls} /> Use TLS</label>
        <div className="flex items-center justify-between border-t pt-4">
          <span className="text-sm font-medium">Enable inbound polling</span>
          <Switch checked={enabled} onCheckedChange={setEnabled} />
        </div>
        <Button onClick={() => save.mutate()} disabled={save.isPending}>
          {save.isPending ? 'Saving…' : 'Save settings'}
        </Button>
        <p className="text-xs text-muted-foreground">
          Note: inbound polling requires the <code>imapflow</code> package on the server. Until a mailbox is
          enabled, replies can be simulated for testing.
        </p>
      </div>
    </div>
  );
}
