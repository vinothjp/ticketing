import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Mail, MessagesSquare, Paperclip, Send } from 'lucide-react';
import api from '../../../lib/api';
import { useAuth } from '../../../context/AuthContext';
import { assetUrl } from '@/lib/assetUrl';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useDateFormat } from '@/lib/dateFormat';

interface MessageAttachment { id: string; fileName: string; filePath: string; }
interface Message {
  id: string;
  channel: string;
  direction: string;
  isInternal: boolean;
  authorUserId?: string | null;
  authorName?: string | null;
  fromAddress?: string | null;
  toAddress?: string | null;
  body: string;
  status: string;
  createdAt: string;
  attachments: MessageAttachment[];
}

export default function ConversationTab({ ticketId }: { ticketId: string }) {
  const { fmtDateTime } = useDateFormat();
  const qc = useQueryClient();
  const { user } = useAuth();
  // Chat is a shared thread — the client sees it and can post in it too. Staff
  // still start on Chat (their working channel), the client on Email reply
  // (theirs), and either side can switch.
  const isStaff = !!user?.roles.some((r) => r === 'Admin' || r === 'Viewer');
  const [channel, setChannel] = useState<'EMAIL' | 'INTERNAL'>(isStaff ? 'INTERNAL' : 'EMAIL');
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
            <SelectTrigger className="h-8 w-44"><SelectValue placeholder="Chat" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="INTERNAL">Chat</SelectItem>
              <SelectItem value="EMAIL">Email reply</SelectItem>
            </SelectContent>
          </Select>
          {channel === 'INTERNAL' && (
            <span className="text-xs text-muted-foreground">
              {isStaff
                ? 'Posted in the shared thread — the client sees it and can reply here'
                : 'Posted in the shared thread — your support team sees it and can reply here'}
            </span>
          )}
        </div>
        <Textarea
          rows={3}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={
            channel === 'EMAIL'
              ? isStaff ? 'Write a reply to the requester…' : 'Write a reply to your support team…'
              : 'Chat about this ticket…'
          }
          className={channel === 'INTERNAL' ? 'bg-sky-50 dark:bg-sky-950/20' : undefined}
        />
        <div className="mt-2 flex items-center justify-between gap-2">
          <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
            <Paperclip className="size-4" />
            {files.length ? `${files.length} file(s)` : 'Attach'}
            <input type="file" multiple className="hidden" onChange={(e) => setFiles(Array.from(e.target.files ?? []))} />
          </label>
          <Button size="sm" onClick={() => send.mutate()} disabled={!body.trim() || send.isPending}>
            <Send className="size-4" /> {send.isPending ? 'Sending…' : channel === 'EMAIL' ? 'Send email' : 'Send chat'}
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
            // Chat-style: the viewer's own messages on the right, everyone else on the left.
            const mine = !!m.authorUserId && m.authorUserId === user?.id;
            return (
              <div key={m.id} className={cn('flex', mine ? 'justify-end' : 'justify-start')}>
                <div
                  className={cn(
                    'max-w-[85%] rounded-lg border px-3 py-2 text-sm',
                    // Chat is tinted to separate it from the emailed replies —
                    // no longer a "private, hide from the customer" warning.
                    internal
                      ? 'border-sky-300 bg-sky-50 dark:border-sky-900 dark:bg-sky-950/20'
                      : mine
                        ? 'bg-primary/5'
                        : 'bg-muted',
                  )}
                >
                  <div className="mb-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                    {internal ? <MessagesSquare className="size-3" /> : <Mail className="size-3" />}
                    <span className="font-medium text-foreground">{m.authorName ?? m.fromAddress ?? 'External'}</span>
                    <span>· {fmtDateTime(m.createdAt)}</span>
                    {internal && <span>· chat</span>}
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
