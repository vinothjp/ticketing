import { useQuery } from '@tanstack/react-query';
import api from '../../../lib/api';

export interface Worklog {
  id: string;
  hours: number | string;
  workDate: string;
  note?: string | null;
  consultantName?: string | null;
  /** The task this time was spent on, if the logger linked one. */
  taskId?: string | null;
  taskTitle?: string | null;
}

export interface TicketComment {
  id: string;
  taskId?: string | null;
  authorUserId?: string | null;
  authorName?: string | null;
  body: string;
  createdAt: string;
}

/**
 * The ticket's logged time. This is the **only** thing that charges the
 * customer's support-hours pool — a task's own hours are an audit of how long it
 * stood in progress and are deliberately never booked here, or the same work
 * would be counted twice.
 */
export function useWorklogs(ticketId: string) {
  return useQuery<Worklog[]>({
    queryKey: ['ticket-worklogs', ticketId],
    queryFn: async () => (await api.get(`/api/tickets/${ticketId}/worklogs`)).data,
  });
}

/**
 * Every comment on the ticket in one cache entry, ticket-level and per-task
 * alike. Each mounted thread filters the slice it owns, so the Comments tab can
 * render a group per task without a request each, and a count taken here can
 * never disagree with the list it labels.
 */
export function useTicketComments(ticketId: string) {
  return useQuery<TicketComment[]>({
    queryKey: ['ticket-comments', ticketId],
    queryFn: async () => (await api.get(`/api/tickets/${ticketId}/comments`)).data,
  });
}
