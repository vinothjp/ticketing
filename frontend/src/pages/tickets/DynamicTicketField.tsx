import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

export type FieldDataType =
  | 'TEXT' | 'TEXTAREA' | 'SELECT' | 'MULTI_SELECT_USER' | 'DATE' | 'DATETIME'
  | 'BOOLEAN' | 'EMAIL_LIST' | 'FILE' | 'SYSTEM';

export interface MergedTemplateField {
  fieldKey: string;
  visibility: 'VISIBLE' | 'HIDDEN';
  requirement: 'MANDATORY' | 'OPTIONAL';
  readOnly: boolean;
  sortOrder: number;
  label: string;
  group: 'ticket_info' | 'ticket_detail' | 'root_cause';
  dataType: FieldDataType;
  picklistKey?: string | null;
  systemManaged: boolean;
  helperText: string;
}

interface Option { value: string; label: string; }
interface UserOption { id: string; username: string; }

export default function DynamicTicketField({
  field,
  value,
  onChange,
  error,
  options,
  users,
  systemDisplayValue,
  files,
  onFilesChange,
}: {
  field: MergedTemplateField;
  value: any;
  onChange: (v: any) => void;
  error?: string;
  options?: Option[];
  users?: UserOption[];
  systemDisplayValue?: string;
  files?: File[];
  onFilesChange?: (files: File[]) => void;
}) {
  const required = field.requirement === 'MANDATORY';
  const disabled = field.readOnly;

  return (
    <div className="space-y-1.5">
      <label className="text-sm font-medium text-foreground">
        {field.label}
        {required && !field.systemManaged && <span className="ml-0.5 text-destructive">*</span>}
      </label>

      {field.dataType === 'SYSTEM' && (
        <Input disabled value={systemDisplayValue ?? ''} />
      )}

      {field.dataType === 'TEXT' && (
        <Input value={value ?? ''} disabled={disabled} onChange={(e) => onChange(e.target.value)} />
      )}

      {field.dataType === 'TEXTAREA' && (
        <Textarea rows={4} value={value ?? ''} disabled={disabled} onChange={(e) => onChange(e.target.value)} />
      )}

      {field.dataType === 'DATE' && (
        <Input type="date" value={value ?? ''} disabled={disabled} onChange={(e) => onChange(e.target.value)} />
      )}

      {field.dataType === 'DATETIME' && (
        <Input
          type="datetime-local"
          value={value ?? ''}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
        />
      )}

      {field.dataType === 'BOOLEAN' && (
        <div>
          <Switch checked={!!value} disabled={disabled} onCheckedChange={onChange} />
        </div>
      )}

      {field.dataType === 'EMAIL_LIST' && (
        <Input
          value={value ?? ''}
          disabled={disabled}
          placeholder="alice@example.com, bob@example.com"
          onChange={(e) => onChange(e.target.value)}
        />
      )}

      {field.dataType === 'SELECT' && (
        <Select value={value || undefined} disabled={disabled} onValueChange={onChange}>
          <SelectTrigger className="w-full"><SelectValue placeholder="Select..." /></SelectTrigger>
          <SelectContent>
            {(options ?? []).map((o) => (
              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {field.dataType === 'MULTI_SELECT_USER' && (
        <div className="space-y-2 rounded-lg border p-3">
          {(users ?? []).length === 0 && <p className="text-sm text-muted-foreground">No users available.</p>}
          {(users ?? []).map((u) => {
            const selected: string[] = value ?? [];
            return (
              <div key={u.id} className="flex items-center gap-2">
                <Checkbox
                  checked={selected.includes(u.id)}
                  disabled={disabled}
                  onCheckedChange={(checked) =>
                    onChange(checked ? [...selected, u.id] : selected.filter((id) => id !== u.id))
                  }
                />
                <span className="text-sm text-foreground">{u.username}</span>
              </div>
            );
          })}
        </div>
      )}

      {field.dataType === 'FILE' && (
        <div>
          <Input
            type="file"
            multiple
            disabled={disabled}
            onChange={(e) => onFilesChange?.(Array.from(e.target.files ?? []))}
          />
          {!!files?.length && (
            <ul className="mt-1 text-xs text-muted-foreground">
              {files.map((f) => <li key={f.name}>{f.name}</li>)}
            </ul>
          )}
        </div>
      )}

      {error ? (
        <p className="text-xs text-destructive">{error}</p>
      ) : (
        <p className="text-xs text-muted-foreground">{field.helperText}</p>
      )}
    </div>
  );
}
