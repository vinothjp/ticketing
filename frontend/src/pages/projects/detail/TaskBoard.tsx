import { useState } from 'react';
import {
  DndContext, DragOverlay, PointerSensor, useSensor, useSensors,
  useDraggable, useDroppable, type DragEndEvent, type DragStartEvent,
} from '@dnd-kit/core';
import { Pencil, Trash2, Flag, User } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/hooks/useConfirm';
import {
  TASK_STATUSES, labelOf, priorityVariant, taskKey,
  type ProjectTask, type ProjectMilestone,
} from '../projectMeta';

const COLUMN_META: Record<string, { label: string; accent: string }> = {
  TODO: { label: 'To Do', accent: 'bg-muted-foreground/40' },
  IN_PROGRESS: { label: 'In Progress', accent: 'bg-primary' },
  REVIEW: { label: 'Review', accent: 'bg-secondary-foreground/40' },
  COMPLETED: { label: 'Completed', accent: 'bg-success' },
};

function CardBody({
  task, keyStr, listName, onEdit, onDelete, dragging, editable = true,
}: {
  task: ProjectTask;
  keyStr?: string;
  listName?: string;
  onEdit?: (t: ProjectTask) => void;
  onDelete?: (id: string) => void;
  dragging?: boolean;
  editable?: boolean;
}) {
  return (
    <div className={`rounded-lg border bg-card p-3 shadow-sm ${dragging ? 'rotate-2 shadow-lg' : ''}`}>
      {keyStr && <div className="mb-1 text-[11px] font-medium text-muted-foreground">{keyStr}</div>}
      <div className="mb-1.5 flex items-start justify-between gap-2">
        <span className="flex items-center gap-1.5 text-sm font-medium text-foreground">
          {task.type === 'MILESTONE' && <Flag className="size-3.5 shrink-0 text-primary" />}
          {task.title}
        </span>
        {onEdit && (
          <div className="flex shrink-0 gap-1 opacity-0 transition-opacity group-hover:opacity-100">
            <Button
              size="icon" variant="ghost" className="size-6"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => onEdit(task)}
            >
              <Pencil className="size-3.5" />
            </Button>
            {editable && onDelete && (
              <Button
                size="icon" variant="ghost" className="size-6 text-destructive hover:text-destructive"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => onDelete(task.id)}
              >
                <Trash2 className="size-3.5" />
              </Button>
            )}
          </div>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {listName && <Badge variant="secondary">{listName}</Badge>}
        {task.priority && <Badge variant={priorityVariant(task.priority)}>{labelOf(task.priority)}</Badge>}
        {task.dueDate && (
          <span className="text-xs text-muted-foreground">{new Date(task.dueDate).toLocaleDateString()}</span>
        )}
        {task.assigneeName && (
          <span className="ml-auto flex items-center gap-1 text-xs text-muted-foreground">
            <User className="size-3" /> {task.assigneeName}
          </span>
        )}
      </div>
    </div>
  );
}

function DraggableCard({
  task, keyStr, listName, editable, onEdit, onDelete,
}: {
  task: ProjectTask;
  keyStr?: string;
  listName?: string;
  editable: boolean;
  onEdit: (t: ProjectTask) => void;
  onDelete: (id: string) => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: task.id, disabled: !editable });
  return (
    <div
      ref={setNodeRef}
      {...(editable ? listeners : {})}
      {...attributes}
      className={`group touch-none ${editable ? 'cursor-grab active:cursor-grabbing' : ''} ${isDragging ? 'opacity-40' : ''}`}
    >
      <CardBody task={task} keyStr={keyStr} listName={listName} editable={editable} onEdit={onEdit} onDelete={onDelete} />
    </div>
  );
}

function Column({
  status, tasks, projectKey, listNames, canEdit, onEdit, onDelete,
}: {
  status: string;
  tasks: ProjectTask[];
  projectKey?: string | null;
  listNames: Map<string, string>;
  canEdit: (t: ProjectTask) => boolean;
  onEdit: (t: ProjectTask) => void;
  onDelete: (id: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  const meta = COLUMN_META[status];
  return (
    <div
      ref={setNodeRef}
      className={`flex flex-col rounded-lg border bg-muted/30 p-2 transition-colors ${
        isOver ? 'border-primary bg-primary/5' : ''
      }`}
    >
      <div className="mb-2 flex items-center gap-2 px-1 py-1">
        <span className={`size-2 rounded-full ${meta.accent}`} />
        <span className="text-sm font-medium text-foreground">{meta.label}</span>
        <span className="text-xs text-muted-foreground">{tasks.length}</span>
      </div>
      <div className="flex min-h-24 flex-col gap-2">
        {tasks.length === 0 && (
          <div className="rounded-lg border border-dashed py-6 text-center text-xs text-muted-foreground">
            Drop tasks here
          </div>
        )}
        {tasks.map((t) => (
          <DraggableCard
            key={t.id}
            task={t}
            keyStr={taskKey(projectKey, t.taskNumber)}
            listName={t.milestoneId ? listNames.get(t.milestoneId) : undefined}
            editable={canEdit(t)}
            onEdit={onEdit}
            onDelete={onDelete}
          />
        ))}
      </div>
    </div>
  );
}

export default function TaskBoard({
  tasks, milestones = [], projectKey, canEdit = () => true, onMove, onEdit, onDelete,
}: {
  tasks: ProjectTask[];
  milestones?: ProjectMilestone[];
  projectKey?: string | null;
  canEdit?: (t: ProjectTask) => boolean;
  onMove: (id: string, status: string) => void;
  onEdit: (t: ProjectTask) => void;
  onDelete: (id: string) => void;
}) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const { confirm, ConfirmDialog } = useConfirm();
  const confirmDelete = async (id: string) => {
    if (await confirm({ title: 'Delete task?', destructive: true, confirmText: 'Delete' })) onDelete(id);
  };
  const listNames = new Map(milestones.map((l) => [l.id, l.name]));
  // A small activation distance lets the edit/delete buttons stay clickable.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const activeTask = tasks.find((t) => t.id === activeId) ?? null;

  const handleStart = (e: DragStartEvent) => setActiveId(String(e.active.id));
  const handleEnd = (e: DragEndEvent) => {
    const overStatus = e.over ? String(e.over.id) : null;
    const task = tasks.find((t) => t.id === e.active.id);
    if (task && overStatus && task.status !== overStatus) onMove(task.id, overStatus);
    setActiveId(null);
  };

  return (
    <>
      {ConfirmDialog}
      <DndContext sensors={sensors} onDragStart={handleStart} onDragEnd={handleEnd} onDragCancel={() => setActiveId(null)}>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {TASK_STATUSES.map((status) => (
            <Column
              key={status}
              status={status}
              tasks={tasks.filter((t) => t.status === status)}
              projectKey={projectKey}
              listNames={listNames}
              canEdit={canEdit}
              onEdit={onEdit}
              onDelete={confirmDelete}
            />
          ))}
        </div>
        <DragOverlay>
          {activeTask ? <div className="w-72"><CardBody task={activeTask} dragging /></div> : null}
        </DragOverlay>
      </DndContext>
    </>
  );
}
