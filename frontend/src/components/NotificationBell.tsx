import { useCallback, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Bell, CheckCheck } from 'lucide-react';
import api from '../lib/api';
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
} from '@/components/ui/dropdown-menu';

interface Notification {
  id: string;
  type: string;
  title: string;
  body?: string | null;
  ticketId?: string | null;
  link?: string | null;
  read: boolean;
  createdAt: string;
}
interface Feed { items: Notification[]; unread: number }

/**
 * A notification body, clamped to two lines with a trailing "… More" that expands
 * it in place. The clamp is `max-h-8` over `text-xs leading-4` (two 1rem lines)
 * rather than `line-clamp-2`, so the toggle can be a float that *reserves* space
 * on the second line: text wraps around it instead of being masked by it, which
 * an overlay would have to do — and an overlay cannot mask cleanly over the row's
 * translucent unread tint or its hover colour.
 */
function NotificationBody({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);
  // A callback ref, not an effect: it measures once at commit, while the toggle
  // is still unrendered, so the height compared is the text's own.
  const measure = useCallback((el: HTMLDivElement | null) => {
    if (el) setOverflows(el.scrollHeight > el.clientHeight);
  }, []);

  const toggle = (
    <button
      type="button"
      // The row navigates on click; this control must not.
      onClick={(e) => { e.stopPropagation(); setExpanded((v) => !v); }}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') e.stopPropagation(); }}
      className="pl-1 text-xs leading-4 font-medium text-primary hover:underline"
    >
      {expanded ? 'Less' : '… More'}
    </button>
  );

  if (expanded) {
    return (
      <div className="w-full pl-4 text-xs leading-4 break-words whitespace-pre-wrap text-muted-foreground">
        {text} {toggle}
      </div>
    );
  }

  return (
    <div ref={measure} className="max-h-8 w-full overflow-hidden pl-4 text-xs leading-4 break-words text-muted-foreground">
      {overflows && (
        <>
          {/* A zero-width float one line tall; `clear-right` on the toggle then
              drops it to the second line, where it reserves its own width. */}
          <span aria-hidden className="float-right h-4 w-0" />
          <span className="float-right clear-right">{toggle}</span>
        </>
      )}
      {text}
    </div>
  );
}

function timeAgo(iso: string) {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export default function NotificationBell() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);

  const { data } = useQuery<Feed>({
    queryKey: ['notifications'],
    queryFn: async () => (await api.get('/api/notifications')).data,
    refetchInterval: 20000, // poll every 20s
  });
  const unread = data?.unread ?? 0;
  const items = data?.items ?? [];

  const invalidate = () => qc.invalidateQueries({ queryKey: ['notifications'] });
  const markRead = useMutation({ mutationFn: (id: string) => api.post(`/api/notifications/${id}/read`), onSuccess: invalidate });
  const markAll = useMutation({ mutationFn: () => api.post('/api/notifications/read-all'), onSuccess: invalidate });

  const onOpenNotification = (n: Notification) => {
    if (!n.read) markRead.mutate(n.id);
    setMenuOpen(false); // close the dropdown when a notification is opened
    // `link` is the explicit destination. Client-visit notifications predating it
    // still land on the visit list rather than falling through to a ticket.
    if (n.link) navigate(n.link);
    else if (n.type.startsWith('CLIENT_VISIT')) navigate('/client-visits');
    else if (n.ticketId) navigate(`/tickets/${n.ticketId}`);
  };

  return (
    <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
      <DropdownMenuTrigger className="relative flex size-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground outline-none hover:bg-accent hover:text-foreground">
        <Bell className="size-5" />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 flex min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold leading-4 text-destructive-foreground">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <span className="text-sm font-semibold">Notifications</span>
          {unread > 0 && (
            <button onClick={() => markAll.mutate()} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
              <CheckCheck className="size-3.5" /> Mark all read
            </button>
          )}
        </div>
        <div className="max-h-96 overflow-y-auto">
          {items.length === 0 ? (
            <p className="px-3 py-8 text-center text-sm text-muted-foreground">No notifications yet.</p>
          ) : (
            items.map((n) => (
              // A div, not a button: the More/Less toggle is a real button and
              // one button may not nest inside another.
              <div
                key={n.id}
                role="button"
                tabIndex={0}
                onClick={() => onOpenNotification(n)}
                onKeyDown={(e) => {
                  // Ignore keys already handled by the toggle inside this row.
                  if (e.target !== e.currentTarget) return;
                  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpenNotification(n); }
                }}
                className={`flex w-full cursor-pointer flex-col items-start gap-0.5 border-b px-3 py-2.5 text-left transition-colors hover:bg-accent ${n.read ? '' : 'bg-primary/5'}`}
              >
                <div className="flex w-full items-center gap-2">
                  {!n.read && <span className="size-2 shrink-0 rounded-full bg-primary" />}
                  <span className="flex-1 truncate text-sm font-medium text-foreground">{n.title}</span>
                  <span className="shrink-0 text-[11px] text-muted-foreground">{timeAgo(n.createdAt)}</span>
                </div>
                {n.body && <NotificationBody text={n.body} />}
              </div>
            ))
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
