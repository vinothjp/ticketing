import { useRef } from 'react';
import { useConfirm } from '@/hooks/useConfirm';
import { Combobox } from '@/components/ui/combobox';
import type { ProjectResource, UserOption } from '../projectMeta';

/**
 * The assignee dropdown for a project's work items. Every staff user is offered,
 * but picking one who is not on the project's resource plan asks first: with no
 * resource-cost row behind them, their time on the project bills at 0.
 * "No" discards the pick and reopens the list; "Yes" hands the user to
 * `onAddToResources`, which opens the Resources tab's Add Member form for them.
 * Type-to-search, so a long staff list never runs the height of the screen.
 */
export default function AssigneeSelect({
  value, onChange, users, resources, onAddToResources, disabled, size, className = 'w-full',
}: {
  value: string;                              // '' = unassigned
  onChange: (userId: string) => void;         // '' = unassigned
  users: UserOption[];
  resources: ProjectResource[];
  onAddToResources?: (userId: string) => void;
  disabled?: boolean;
  size?: 'sm' | 'default';
  className?: string;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const { confirm, ConfirmDialog } = useConfirm();
  const planned = new Set(resources.map((r) => r.userId).filter(Boolean));

  const pick = async (userId: string) => {
    if (userId === value) return;
    if (!userId || planned.has(userId)) { onChange(userId); return; }

    const name = users.find((u) => u.id === userId)?.username ?? 'This person';
    const add = await confirm({
      title: `${name} is not in Resource Cost`,
      description: `${name} is not on this project's resource plan, so their time on it may be billed at 0. Add them to Resource Cost?`,
      confirmText: 'Yes, add to Resource Cost',
      cancelText: 'No',
    });
    if (add) onAddToResources?.(userId);
    // Let the confirm dialog finish closing (and hand focus back) before reopening
    // the list — the combobox opens on focus.
    else setTimeout(() => boxRef.current?.querySelector('input')?.focus(), 0);
  };

  return (
    <>
      {ConfirmDialog}
      <div ref={boxRef} className={className}>
        <Combobox
          size={size} placeholder="Unassigned" emptyText="No matching user"
          value={value}
          onChange={pick}
          disabled={disabled}
          options={[{ value: '', label: 'Unassigned' }, ...users.map((u) => ({ value: u.id, label: u.username }))]}
        />
      </div>
    </>
  );
}
