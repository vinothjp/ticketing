import { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft, ArrowUp, ArrowDown, Plus, Trash2, Pencil, X,
} from 'lucide-react';
import { toast } from 'sonner';
import api from '../../lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import DynamicTicketField, { type MergedTemplateField, type FieldDataType, type FieldOption } from '../tickets/DynamicTicketField';
import {
  TEMPLATE_CATEGORIES, TEMPLATE_COLORS, TEMPLATE_ICONS, CUSTOM_FIELD_TYPES,
  OPTION_BACKED_TYPES, FIELD_GROUPS, typeLabel, iconFor,
} from './templateMeta';

type Group = 'ticket_info' | 'ticket_detail' | 'root_cause';

interface CatalogField {
  key: string;
  label: string;
  group: Group;
  dataType: FieldDataType;
  picklistKey?: string;
  systemManaged?: boolean;
  defaultHelperText: string;
}

interface DesignerField {
  key: string;              // local React key
  fieldKey?: string;        // backend key (persisted fields / catalog keys)
  isCustom: boolean;
  label: string;
  dataType: FieldDataType;
  group: Group;
  picklistKey?: string | null;
  systemManaged: boolean;
  placeholder?: string;
  options: FieldOption[];
  helperText: string;       // catalog default helper (display only)
  helperTextOverride?: string;
  visibility: 'VISIBLE' | 'HIDDEN';
  requirement: 'MANDATORY' | 'OPTIONAL';
  readOnly: boolean;
}

const GROUP_LABEL: Record<Group, string> = {
  ticket_info: 'Ticket Info',
  ticket_detail: 'Ticket Detail',
  root_cause: 'Root Cause Analysis',
};
const GROUP_ORDER: Group[] = ['ticket_info', 'ticket_detail', 'root_cause'];

const uid = () =>
  (crypto.randomUUID?.() ?? `k_${Math.random().toString(36).slice(2)}`);
const slug = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'option';

export default function TemplateDesignerPage() {
  const { id } = useParams<{ id: string }>();
  const isNew = !id || id === 'new';
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [name, setName] = useState('');
  const [category, setCategory] = useState<string>('');
  const [description, setDescription] = useState('');
  const [descriptionGuidance, setDescriptionGuidance] = useState('');
  const [icon, setIcon] = useState('layout-template');
  const [color, setColor] = useState(TEMPLATE_COLORS[6]);
  const [isActive, setIsActive] = useState(true);
  const [fields, setFields] = useState<DesignerField[]>([]);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [previewValues, setPreviewValues] = useState<Record<string, any>>({});

  const { data: catalog = [] } = useQuery<CatalogField[]>({
    queryKey: ['field-catalog'],
    queryFn: async () => (await api.get('/api/field-catalog')).data,
  });

  const { data: template } = useQuery({
    queryKey: ['templates', id],
    queryFn: async () => (await api.get(`/api/templates/${id}`)).data,
    enabled: !isNew,
  });

  useEffect(() => {
    if (!template) return;
    setName(template.name ?? '');
    setCategory(template.category ?? '');
    setDescription(template.description ?? '');
    setDescriptionGuidance(template.descriptionGuidance ?? '');
    setIcon(template.icon ?? 'layout-template');
    setColor(template.color ?? TEMPLATE_COLORS[6]);
    setIsActive(template.isActive ?? true);
    setFields(
      (template.fields ?? [])
        .filter((f: any) => f.visibility === 'VISIBLE')
        .map((f: any) => ({
        key: uid(),
        fieldKey: f.fieldKey,
        isCustom: f.isCustom,
        label: f.label,
        dataType: f.dataType,
        group: f.group,
        picklistKey: f.picklistKey,
        systemManaged: f.systemManaged,
        placeholder: f.placeholder ?? '',
        options: f.options ?? [],
        helperText: f.helperText ?? '',
        helperTextOverride: f.helperTextOverride ?? '',
        visibility: f.visibility,
        requirement: f.requirement,
        readOnly: f.readOnly,
      })),
    );
  }, [template]);

  const usedKeys = useMemo(() => new Set(fields.map((f) => f.fieldKey).filter(Boolean)), [fields]);
  const availableCatalog = useMemo(
    () => catalog.filter((c) => !usedKeys.has(c.key)),
    [catalog, usedKeys],
  );

  // Picklists for previewing catalog dropdowns.
  const picklistKeys = useMemo(
    () => Array.from(new Set(fields.map((f) => f.picklistKey).filter((k): k is string => !!k))),
    [fields],
  );
  const { data: picklistData = {} } = useQuery<Record<string, FieldOption[]>>({
    queryKey: ['picklist-options', 'bulk', picklistKeys],
    queryFn: async () => {
      const entries = await Promise.all(
        picklistKeys.map(async (key) => {
          const res = await api.get('/api/picklist-options', { params: { listKey: key } });
          return [key, (res.data as any[]).filter((o) => o.isActive)] as const;
        }),
      );
      return Object.fromEntries(entries);
    },
    enabled: picklistKeys.length > 0,
  });

  const patch = (key: string, p: Partial<DesignerField>) =>
    setFields((prev) => prev.map((f) => (f.key === key ? { ...f, ...p } : f)));

  const move = (key: string, dir: -1 | 1) =>
    setFields((prev) => {
      const i = prev.findIndex((f) => f.key === key);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });

  const addCatalogField = (catalogKey: string) => {
    const c = catalog.find((x) => x.key === catalogKey);
    if (!c) return;
    const field: DesignerField = {
      key: uid(),
      fieldKey: c.key,
      isCustom: false,
      label: c.label,
      dataType: c.dataType,
      group: c.group,
      picklistKey: c.picklistKey ?? null,
      systemManaged: !!c.systemManaged,
      options: [],
      helperText: c.defaultHelperText,
      helperTextOverride: '',
      visibility: 'VISIBLE',
      requirement: 'OPTIONAL',
      readOnly: false,
    };
    setFields((prev) => [...prev, field]);
  };

  const addCustomField = () => {
    const field: DesignerField = {
      key: uid(),
      isCustom: true,
      label: '',
      dataType: 'TEXT',
      group: 'ticket_detail',
      picklistKey: null,
      systemManaged: false,
      placeholder: '',
      options: [],
      helperText: '',
      helperTextOverride: '',
      visibility: 'VISIBLE',
      requirement: 'OPTIONAL',
      readOnly: false,
    };
    setFields((prev) => [...prev, field]);
    setEditingKey(field.key);
  };

  const removeField = (key: string) => {
    setFields((prev) => prev.filter((f) => f.key !== key));
    if (editingKey === key) setEditingKey(null);
  };

  const toMerged = (f: DesignerField): MergedTemplateField => ({
    fieldKey: f.fieldKey ?? f.key,
    isCustom: f.isCustom,
    visibility: f.visibility,
    requirement: f.requirement,
    readOnly: false,
    sortOrder: 0,
    label: f.label || '(untitled)',
    group: f.group,
    dataType: f.dataType,
    picklistKey: f.picklistKey,
    options: f.options,
    placeholder: f.placeholder,
    systemManaged: f.systemManaged,
    helperText: f.helperTextOverride || f.helperText || '',
  });

  const buildFieldsPayload = () =>
    fields.map((f, i) => ({
      ...(f.fieldKey ? { fieldKey: f.fieldKey } : {}),
      isCustom: f.isCustom,
      ...(f.isCustom
        ? {
            label: f.label.trim(),
            dataType: f.dataType,
            group: f.group,
            placeholder: f.placeholder || undefined,
            options: OPTION_BACKED_TYPES.includes(f.dataType) ? f.options : undefined,
          }
        : {}),
      visibility: f.visibility,
      requirement: f.requirement,
      readOnly: f.readOnly,
      sortOrder: i,
      helperTextOverride: f.helperTextOverride || undefined,
    }));

  const validate = (): string | null => {
    if (!name.trim()) return 'Give the template a name';
    for (const f of fields) {
      if (f.isCustom && !f.label.trim()) return 'Every custom field needs a label';
      if (f.isCustom && OPTION_BACKED_TYPES.includes(f.dataType) && f.options.length === 0)
        return `"${f.label || 'A dropdown field'}" needs at least one option`;
    }
    return null;
  };

  const save = useMutation({
    mutationFn: async () => {
      const meta = {
        name: name.trim(),
        category: category || undefined,
        description: description || undefined,
        descriptionGuidance: descriptionGuidance || undefined,
        icon,
        color,
        isActive,
      };
      if (isNew) {
        return (await api.post('/api/templates', { ...meta, fields: buildFieldsPayload() })).data;
      }
      await api.put(`/api/templates/${id}`, meta);
      await api.put(`/api/templates/${id}/fields`, { fields: buildFieldsPayload() });
      return { id };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['templates'] });
      toast.success(isNew ? 'Template created' : 'Template saved');
      navigate('/admin/templates');
    },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error saving template'),
  });

  const handleSave = () => {
    const err = validate();
    if (err) {
      toast.error(err);
      return;
    }
    save.mutate();
  };

  const visibleFields = fields.filter((f) => f.visibility === 'VISIBLE');

  return (
    <div className="mx-auto max-w-6xl">
      <Button variant="ghost" size="sm" asChild className="mb-2 -ml-2">
        <Link to="/admin/templates"><ArrowLeft className="size-4" /> Templates</Link>
      </Button>
      <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{isNew ? 'New template' : 'Edit template'}</h1>
          <p className="text-sm text-muted-foreground">
            Name it, pick a type, and design the fields a requester fills in. The preview updates live.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => navigate('/admin/templates')}>Cancel</Button>
          <Button onClick={handleSave} disabled={save.isPending}>
            {save.isPending ? 'Saving...' : 'Save template'}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-x-10 gap-y-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,340px)] lg:items-start">
        {/* Edit column: details + fields */}
        <div className="min-w-0 space-y-8">
          {/* Template details */}
          <section>
            <h2 className="mb-4 text-base font-semibold text-foreground">Template details</h2>
            <div className="grid grid-cols-1 gap-x-4 gap-y-4 sm:grid-cols-2">
              <div className="space-y-1.5 sm:col-span-2">
                <label className="text-sm font-medium">Name <span className="text-destructive">*</span></label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. IT Incident" />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Type</label>
                <Select value={category || undefined} onValueChange={setCategory}>
                  <SelectTrigger className="w-full"><SelectValue placeholder="Select a type..." /></SelectTrigger>
                  <SelectContent>
                    {TEMPLATE_CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Short description</label>
                <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Shown on the templates list" />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <label className="text-sm font-medium">Description guidance</label>
                <Textarea rows={2} value={descriptionGuidance} onChange={(e) => setDescriptionGuidance(e.target.value)} placeholder="Pre-fills the Description field on new tickets." />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Icon</label>
                <div className="flex flex-wrap gap-1.5">
                  {TEMPLATE_ICONS.map(({ value, Icon }) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setIcon(value)}
                      className={cn(
                        'flex size-9 items-center justify-center rounded-lg border text-muted-foreground transition-colors hover:bg-accent',
                        icon === value && 'border-primary bg-primary/10 text-primary',
                      )}
                    >
                      <Icon className="size-4" />
                    </button>
                  ))}
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Colour</label>
                <div className="flex flex-wrap items-center gap-2 pt-1.5">
                  {TEMPLATE_COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setColor(c)}
                      style={{ backgroundColor: c }}
                      className={cn('size-6 rounded-full ring-offset-2 ring-offset-background transition', color === c && 'ring-2 ring-foreground')}
                    />
                  ))}
                </div>
              </div>
              <div className="flex items-center justify-between border-t pt-4 sm:col-span-2">
                <span className="text-sm font-medium">Active</span>
                <Switch checked={isActive} onCheckedChange={setIsActive} />
              </div>
            </div>
          </section>

          {/* Fields */}
          <section>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-base font-semibold text-foreground">Fields</h2>
              <span className="text-xs text-muted-foreground">{fields.length} field{fields.length === 1 ? '' : 's'} · order top to bottom</span>
            </div>

            {fields.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                No fields yet. Add a system field or design a custom one below.
              </p>
            ) : (
              <div className="border-t">
                {fields.map((f, i) => (
                  <FieldRow
                    key={f.key}
                    field={f}
                    index={i}
                    total={fields.length}
                    editing={editingKey === f.key}
                    onToggleEdit={() => setEditingKey(editingKey === f.key ? null : f.key)}
                    onMove={move}
                    onRemove={removeField}
                    onPatch={patch}
                  />
                ))}
              </div>
            )}

            <div className="mt-5 flex flex-wrap gap-2">
              <div className="min-w-44 flex-1">
                <Select value="" onValueChange={(v) => v && addCatalogField(v)}>
                  <SelectTrigger className="w-full">
                    <span className="flex items-center gap-1.5 text-sm"><Plus className="size-4" /> Add system field</span>
                  </SelectTrigger>
                  <SelectContent>
                    {availableCatalog.length === 0 && <div className="px-2 py-1.5 text-sm text-muted-foreground">All added</div>}
                    {availableCatalog.map((c) => (
                      <SelectItem key={c.key} value={c.key}>{c.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button variant="default" className="flex-1" onClick={addCustomField}>
                <Plus className="size-4" /> Add custom field
              </Button>
            </div>
          </section>
        </div>

        {/* Live preview */}
        <div className="min-w-0 lg:sticky lg:top-6 lg:border-l lg:pl-10">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-base font-semibold text-foreground">Live preview</h2>
            <span className="text-xs text-muted-foreground">What requesters see</span>
          </div>
          <div className="mb-4 flex items-center gap-2 rounded-lg bg-muted/50 px-3 py-2 text-sm">
            {(() => { const Icon = iconFor(icon); return <Icon className="size-4 shrink-0" style={{ color }} />; })()}
            <span className="truncate font-medium">New ticket · {name || 'Untitled template'}</span>
          </div>
          {visibleFields.length === 0 ? (
            <p className="text-sm text-muted-foreground">Add fields to see the form.</p>
          ) : (
            GROUP_ORDER.map((group) => {
              const groupFields = visibleFields.filter((f) => f.group === group);
              if (groupFields.length === 0) return null;
              return (
                <div key={group} className="mb-5">
                  <div className="mb-2.5 text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">{GROUP_LABEL[group]}</div>
                  <div className="space-y-3.5">
                    {groupFields.map((f) => (
                      <DynamicTicketField
                        key={f.key}
                        field={toMerged(f)}
                        value={previewValues[f.key]}
                        onChange={(v) => setPreviewValues((prev) => ({ ...prev, [f.key]: v }))}
                        options={f.picklistKey ? picklistData[f.picklistKey] : undefined}
                      />
                    ))}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

function FieldRow({
  field, index, total, editing, onToggleEdit, onMove, onRemove, onPatch,
}: {
  field: DesignerField;
  index: number;
  total: number;
  editing: boolean;
  onToggleEdit: () => void;
  onMove: (key: string, dir: -1 | 1) => void;
  onRemove: (key: string) => void;
  onPatch: (key: string, p: Partial<DesignerField>) => void;
}) {
  const optionBacked = OPTION_BACKED_TYPES.includes(field.dataType);

  const setOption = (idx: number, label: string) =>
    onPatch(field.key, {
      options: field.options.map((o, i) => (i === idx ? { value: slug(label), label } : o)),
    });
  const addOption = () =>
    onPatch(field.key, { options: [...field.options, { value: '', label: '' }] });
  const removeOption = (idx: number) =>
    onPatch(field.key, { options: field.options.filter((_, i) => i !== idx) });

  return (
    <div className={cn('border-b border-border', editing && 'bg-muted/20')}>
      <div className="flex items-center gap-2 py-2.5">
        <div className="flex flex-col text-muted-foreground/70">
          <button type="button" disabled={index === 0} onClick={() => onMove(field.key, -1)} className="hover:text-foreground disabled:opacity-25"><ArrowUp className="size-3.5" /></button>
          <button type="button" disabled={index === total - 1} onClick={() => onMove(field.key, 1)} className="hover:text-foreground disabled:opacity-25"><ArrowDown className="size-3.5" /></button>
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-foreground">{field.label || <span className="text-muted-foreground">Untitled field</span>}</div>
        </div>
        <Badge variant={field.isCustom ? 'secondary' : 'default'} className="shrink-0">
          {field.isCustom ? typeLabel(field.dataType) : 'System'}
        </Badge>
        {!field.systemManaged && (
          <label className="hidden shrink-0 items-center gap-1.5 text-xs text-muted-foreground sm:flex">
            <Switch
              checked={field.requirement === 'MANDATORY'}
              onCheckedChange={(c) => onPatch(field.key, { requirement: c ? 'MANDATORY' : 'OPTIONAL' })}
            />
            Required
          </label>
        )}
        <Button size="icon" variant="ghost" className="size-8 shrink-0" onClick={onToggleEdit} title="Edit"><Pencil className="size-4" /></Button>
        <Button size="icon" variant="ghost" className="size-8 shrink-0 text-destructive hover:text-destructive" onClick={() => onRemove(field.key)} title="Remove"><Trash2 className="size-4" /></Button>
      </div>

      {editing && (
        <div className="space-y-3 pb-4 pl-7 pr-1">
          {field.isCustom ? (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium">Label <span className="text-destructive">*</span></label>
                  <Input value={field.label} onChange={(e) => onPatch(field.key, { label: e.target.value })} placeholder="e.g. Impact" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium">Type</label>
                  <Select value={field.dataType} onValueChange={(v) => onPatch(field.key, { dataType: v as FieldDataType })}>
                    <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {CUSTOM_FIELD_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium">Section</label>
                  <Select value={field.group} onValueChange={(v) => onPatch(field.key, { group: v as Group })}>
                    <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {FIELD_GROUPS.map((g) => <SelectItem key={g.value} value={g.value}>{g.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium">Placeholder</label>
                  <Input value={field.placeholder ?? ''} onChange={(e) => onPatch(field.key, { placeholder: e.target.value })} />
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium">Help text</label>
                <Input value={field.helperTextOverride ?? ''} onChange={(e) => onPatch(field.key, { helperTextOverride: e.target.value })} placeholder="Shown under the field" />
              </div>

              {optionBacked && (
                <div className="space-y-1.5">
                  <label className="text-xs font-medium">Options</label>
                  {field.options.map((o, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <Input className="h-8" value={o.label} onChange={(e) => setOption(idx, e.target.value)} placeholder={`Option ${idx + 1}`} />
                      <button type="button" onClick={() => removeOption(idx)} className="text-muted-foreground hover:text-foreground"><X className="size-4" /></button>
                    </div>
                  ))}
                  <button type="button" onClick={addOption} className="flex items-center gap-1 text-xs font-medium text-primary"><Plus className="size-3.5" /> Add option</button>
                </div>
              )}

              <div className="flex items-center gap-6 border-t pt-3">
                <label className="flex items-center gap-2 text-sm"><Switch checked={field.requirement === 'MANDATORY'} onCheckedChange={(c) => onPatch(field.key, { requirement: c ? 'MANDATORY' : 'OPTIONAL' })} /> Required</label>
                <label className="flex items-center gap-2 text-sm"><Checkbox checked={field.readOnly} onCheckedChange={(c) => onPatch(field.key, { readOnly: !!c })} /> Read-only</label>
              </div>
            </>
          ) : (
            <>
              <p className="text-xs text-muted-foreground">System field — its label and type are fixed. {field.systemManaged && 'Managed automatically; you control visibility only.'}</p>
              <div className="space-y-1.5">
                <label className="text-xs font-medium">Help text override</label>
                <Input value={field.helperTextOverride ?? ''} onChange={(e) => onPatch(field.key, { helperTextOverride: e.target.value })} placeholder={field.helperText} />
              </div>
              {!field.systemManaged && (
                <div className="flex items-center gap-6 border-t pt-3">
                  <label className="flex items-center gap-2 text-sm"><Switch checked={field.requirement === 'MANDATORY'} onCheckedChange={(c) => onPatch(field.key, { requirement: c ? 'MANDATORY' : 'OPTIONAL' })} /> Required</label>
                  <label className="flex items-center gap-2 text-sm"><Checkbox checked={field.readOnly} onCheckedChange={(c) => onPatch(field.key, { readOnly: !!c })} /> Read-only</label>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
