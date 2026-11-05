import { Combobox, type ComboboxOption } from '@/components/ui/combobox';

// The one staff user who owns a client (account manager) or one of a client's
// products (product manager). Saves on pick, like the client screens' other
// single-value controls. Typeable, so a long staff list is searched rather than
// scrolled; a saved manager who has since been deactivated is still shown
// rather than silently dropped.

export interface ManagerOption { id: string; username: string; name?: string | null; isActive?: boolean }

const NONE = '__none__';
// Seven people at a time, plus the "Not assigned" row that clears it.
const VISIBLE_PEOPLE = 7;

export default function ManagerSelect({ label, value, valueName, staff, readOnly, onChange }: {
  label: string;
  value: string | null | undefined;
  /** Saved manager's name from the server — shown read-only, and as the option when they are no longer active. */
  valueName?: string | null;
  staff: ManagerOption[];
  readOnly?: boolean;
  onChange: (userId: string | null) => void;
}) {
  const current = value ?? '';
  const active = staff.filter((u) => u.isActive !== false);
  const options: ComboboxOption[] = [
    { value: NONE, label: 'Not assigned' },
    ...(current && !active.some((u) => u.id === current)
      ? [{ value: current, label: valueName ?? 'Unknown user', hint: 'inactive' }]
      : []),
    // The username rides along as a hint, so typing either finds the person.
    ...active.map((u) => ({ value: u.id, label: u.name?.trim() || u.username, hint: u.name?.trim() ? u.username : null })),
  ];
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="font-medium text-muted-foreground">{label}</span>
      {readOnly ? (
        <span className="text-foreground">{valueName ?? 'Not assigned'}</span>
      ) : (
        <Combobox
          className="w-56"
          size="sm"
          value={current || NONE}
          options={options}
          placeholder="Type a name…"
          maxRows={VISIBLE_PEOPLE + 1}
          onChange={(v) => {
            const next = v === NONE ? '' : v;
            if (next !== current) onChange(next || null);
          }}
        />
      )}
    </div>
  );
}
