import { useState } from 'react';
import { useConfirm } from '@/hooks/useConfirm';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { ProjectResource, UserOption } from '../projectMeta';

const NONE = '__none__';

/**
 * The assignee dropdown for a project's work items. Every staff user is offered,
 * but picking one who is not on the project's resource plan asks first: with no
 * resource-cost row behind them, their time on the project bills at 0.
 * "No" discards the pick and reopens the list; "Yes" hands the user to
 * `onAddToResources`, which opens the Resources tab's Add Member form for them.
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
  const [open, setOpen] = useState(false);
  const { confirm, ConfirmDialog } = useConfirm();
  const planned = new Set(resources.map((r) => r.userId).filter(Boolean));

  const pick = async (v: string) => {
    const userId = v === NONE ? '' : v;
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
    // Let the confirm dialog finish closing (and hand focus back) before reopening the list.
    else setTimeout(() => setOpen(true), 0);
  };

  return (
    <>
      {ConfirmDialog}
      <Select open={open} onOpenChange={setOpen} value={value || NONE} onValueChange={pick} disabled={disabled}>
        <SelectTrigger size={size} className={className}><SelectValue placeholder="Unassigned" /></SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>Unassigned</SelectItem>
          {users.map((u) => <SelectItem key={u.id} value={u.id}>{u.username}</SelectItem>)}
        </SelectContent>
      </Select>
    </>
  );
}
