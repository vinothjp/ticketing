import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Mail, Lock, Paperclip, Send } from 'lucide-react';
import api from '../../../lib/api';
import { assetUrl } from '@/lib/assetUrl';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

interface MessageAttachment { id: string; fileName: string; filePath: string; }
interface Message {
  id: string;
  channel: string;
  direction: string;
  isInternal: boolean;
  authorName?: string | null;
  fromAddress?: string | null;
  toAddress?: string | null;
  body: string;
  status: string;
  createdAt: string;
  attachments: MessageAttachment[];
}

export default function ConversationTab({ ticketId }: { ticketId: string }) {
  const qc = useQueryClient();
  const [channel, setChannel] = useState<'EMAIL' | 'INTERNAL'>('EMAIL');
  const [body, setBody] = useState('');
  const [files, setFiles] = useState<File[]>([]);

  const { data: messages = [] } = useQuery<Message[]>({
    queryKey: ['ticket-messages', ticketId],
    queryFn: async () => (await api.get(`/api/tickets/${ticketId}/messages`)).data,
    refetchInterval: 10000,
  });

  const send = useMutation({
    mutationFn: async () => {
      const fd = new FormData();
      fd.append('channel', channel);
      fd.append('body', body);
      files.forEach((f) => fd.append('attachments', f));
      return api.post(`/api/tickets/${ticketId}/messages`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ticket-messages', ticketId] });
      qc.invalidateQueries({ queryKey: ['ticket-activity', ticketId] });
      qc.invalidateQueries({ queryKey: ['tickets', ticketId] });
      setBody('');
      setFiles([]);
    },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error sending message'),
  });

  return (
    <div className="space-y-5">
      {/* Composer */}
      <div className="rounded-lg border p-3">
        <div className="mb-2 flex items-center gap-2">
          <Select value={channel} onValueChange={(v) => setChannel(v as 'EMAIL' | 'INTERNAL')}>
            <SelectTrigger className="h-8 w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="EMAIL">Email reply</SelectItem>
              <SelectItem value="INTERNAL">Internal note</SelectItem>
            </SelectContent>
          </Select>
          {channel === 'INTERNAL' && <span className="text-xs text-muted-foreground">Private — not sent to the requester</span>}
        </div>
        <Textarea
          rows={3}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={channel === 'EMAIL' ? 'Write a reply to the requester…' : 'Add a private note for your team…'}
          className={channel === 'INTERNAL' ? 'bg-amber-50 dark:bg-amber-950/20' : undefined}
        />
        <div className="mt-2 flex items-center justify-between gap-2">
          <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
            <Paperclip className="size-4" />
            {files.length ? `${files.length} file(s)` : 'Attach'}
            <input type="file" multiple className="hidden" onChange={(e) => setFiles(Array.from(e.target.files ?? []))} />
          </label>
          <Button size="sm" onClick={() => send.mutate()} disabled={!body.trim() || send.isPending}>
            <Send className="size-4" /> {send.isPending ? 'Sending…' : channel === 'EMAIL' ? 'Send email' : 'Add note'}
          </Button>
        </div>
      </div>

      {/* Thread */}
      {messages.length === 0 ? (
        <p className="text-sm text-muted-foreground">No messages yet.</p>
      ) : (
        <div className="space-y-3">
          {messages.map((m) => {
            const outbound = m.direction === 'OUTBOUND';
            const internal = m.isInternal;
            return (
              <div key={m.id} className={cn('flex', outbound ? 'justify-end' : 'justify-start')}>
                <div
                  className={cn(
                    'max-w-[85%] rounded-lg border px-3 py-2 text-sm',
                    internal
                      ? 'border-amber-300 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/20'
                      : outbound
                        ? 'bg-primary/5'
                        : 'bg-muted',
                  )}
                >
                  <div className="mb-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                    {internal ? <Lock className="size-3" /> : <Mail className="size-3" />}
                    <span className="font-medium text-foreground">{m.authorName ?? m.fromAddress ?? 'External'}</span>
                    <span>· {new Date(m.createdAt).toLocaleString()}</span>
                    {internal && <span>· internal</span>}
                    {!internal && outbound && <span>· {m.status.toLowerCase()}</span>}
                    {!outbound && <span>· received</span>}
                  </div>
                  <div className="whitespace-pre-wrap text-foreground">{m.body}</div>
                  {m.attachments.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {m.attachments.map((a) => (
                        <a
                          key={a.id}
                          href={assetUrl(a.filePath)!}
                          target="_blank"
                          rel="noreferrer"
                          className="flex items-center gap-1 rounded-full border bg-background px-2 py-0.5 text-xs hover:bg-accent"
                        >
                          <Paperclip className="size-3" /> {a.fileName}
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
