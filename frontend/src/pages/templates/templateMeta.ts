import {
  AlertTriangle,
  Settings,
  Bug,
  RefreshCw,
  UserPlus,
  Lock,
  MessageCircle,
  Ticket,
  FileText,
  Wrench,
  Shield,
  Calendar,
  Mail,
  LayoutTemplate,
  type LucideIcon,
} from 'lucide-react';
import type { FieldDataType } from '../tickets/DynamicTicketField';

export const TEMPLATE_ICONS: { value: string; Icon: LucideIcon }[] = [
  { value: 'layout-template', Icon: LayoutTemplate },
  { value: 'alert-triangle', Icon: AlertTriangle },
  { value: 'settings', Icon: Settings },
  { value: 'bug', Icon: Bug },
  { value: 'refresh-cw', Icon: RefreshCw },
  { value: 'user-plus', Icon: UserPlus },
  { value: 'lock', Icon: Lock },
  { value: 'message-circle', Icon: MessageCircle },
  { value: 'ticket', Icon: Ticket },
  { value: 'file-text', Icon: FileText },
  { value: 'wrench', Icon: Wrench },
  { value: 'shield', Icon: Shield },
  { value: 'calendar', Icon: Calendar },
  { value: 'mail', Icon: Mail },
];

const ICON_MAP = new Map(TEMPLATE_ICONS.map((i) => [i.value, i.Icon]));

export function iconFor(name?: string | null): LucideIcon {
  return (name && ICON_MAP.get(name)) || LayoutTemplate;
}

export const TEMPLATE_COLORS = [
  '#e11d48', '#d97706', '#ca8a04', '#16a34a', '#0d9488',
  '#2563eb', '#4f46e5', '#7c3aed', '#c026d3', '#64748b',
];

export const TEMPLATE_CATEGORIES = [
  'Incident',
  'Service Request',
  'Problem',
  'Change',
  'HR',
  'Access',
  'Facilities',
  'Finance',
  'General',
];

/** Custom field types an admin can design, with UI labels. Mirrors CUSTOM_FIELD_DATA_TYPES on the backend. */
export const CUSTOM_FIELD_TYPES: { value: FieldDataType; label: string }[] = [
  { value: 'TEXT', label: 'Text' },
  { value: 'TEXTAREA', label: 'Long Description' },
  { value: 'NUMBER', label: 'Number' },
  { value: 'SELECT', label: 'Dropdown' },
  { value: 'MULTI_SELECT', label: 'Multi-select' },
  { value: 'RADIO', label: 'Radio buttons' },
  { value: 'DATE', label: 'Date' },
  { value: 'DATETIME', label: 'Date & time' },
  { value: 'BOOLEAN', label: 'Checkbox (yes/no)' },
  { value: 'EMAIL_LIST', label: 'Email list' },
  { value: 'PHONE', label: 'Phone' },
  { value: 'FILE', label: 'Attachment' },
];

export const OPTION_BACKED_TYPES: FieldDataType[] = ['SELECT', 'MULTI_SELECT', 'RADIO'];

/** Max upload size (MB) enforced on all Attachment fields, client + server. */
export const MAX_FILE_SIZE_MB = 5;

/** File types an admin can allow on an Attachment field. `value` is the input `accept` string. */
export const FILE_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: '.pdf', label: 'PDF' },
  { value: '.doc,.docx', label: 'Word' },
  { value: '.xls,.xlsx', label: 'Excel' },
  { value: '.ppt,.pptx', label: 'PowerPoint' },
  { value: '.png,.jpg,.jpeg,.gif', label: 'Images' },
  { value: '.txt', label: 'Text' },
  { value: '.csv', label: 'CSV' },
  { value: '.zip', label: 'Zip' },
];

export const FIELD_GROUPS: { value: 'ticket_info' | 'ticket_detail' | 'root_cause'; label: string }[] = [
  { value: 'ticket_info', label: 'Ticket Info' },
  { value: 'ticket_detail', label: 'Ticket Detail' },
  { value: 'root_cause', label: 'Root Cause Analysis' },
];

export function typeLabel(dataType: string): string {
  return CUSTOM_FIELD_TYPES.find((t) => t.value === dataType)?.label ?? dataType;
}
