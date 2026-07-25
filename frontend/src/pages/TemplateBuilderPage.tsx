import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ArrowUp, ArrowDown } from 'lucide-react';
import { toast } from 'sonner';
import api from '../lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';

type Visibility = 'VISIBLE' | 'HIDDEN';
type Requirement = 'MANDATORY' | 'OPTIONAL';
type Group = 'ticket_info' | 'ticket_detail' | 'root_cause';

interface TemplateField {
  fieldKey: string;
  visibility: Visibility;
  requirement: Requirement;
  readOnly: boolean;
  sortOrder: number;
  helperTextOverride?: string | null;
  label: string;
  group: Group;
  dataType: string;
  systemManaged: boolean;
  helperText: string;
}

interface TemplateData {
  id: string;
  requestTypeId: string;
  name: string;
  descriptionGuidance?: string | null;
  fields: TemplateField[];
}

interface RequestType { id: string; name: string; }

const GROUP_LABELS: Record<Group, string> = {
  ticket_info: 'Ticket Info',
  ticket_detail: 'Ticket Detail',
  root_cause: 'Root Cause Analysis',
};
const GROUP_ORDER: Group[] = ['ticket_info', 'ticket_detail', 'root_cause'];

export default function TemplateBuilderPage() {
  const { requestTypeId } = useParams<{ requestTypeId: string }>();
  const qc = useQueryClient();

  const [descriptionGuidance, setDescriptionGuidance] = useState('');
  const [fieldsByGroup, setFieldsByGroup] = useState<Record<Group, TemplateField[]>>({
    ticket_info: [],
    ticket_detail: [],
    root_cause: [],
  });

  const { data: requestType } = useQuery<RequestType>({
    queryKey: ['request-types', requestTypeId],
    queryFn: async () => (await api.get(`/api/request-types/${requestTypeId}`)).data,
    enabled: !!requestTypeId,
  });

  const { data: template, isLoading } = useQuery<TemplateData>({
    queryKey: ['templates', 'by-request-type', requestTypeId],
    queryFn: async () => (await api.get(`/api/templates/by-request-type/${requestTypeId}`)).data,
    enabled: !!requestTypeId,
  });

  useEffect(() => {
    if (!template) return;
    setDescriptionGuidance(template.descriptionGuidance ?? '');
    const grouped: Record<Group, TemplateField[]> = { ticket_info: [], ticket_detail: [], root_cause: [] };
    for (const f of [...template.fields].sort((a, b) => a.sortOrder - b.sortOrder)) {
      grouped[f.group].push(f);
    }
    setFieldsByGroup(grouped);
  }, [template]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      await api.put(`/api/templates/${template!.id}`, { descriptionGuidance });

      const fields = GROUP_ORDER.flatMap((group) =>
        fieldsByGroup[group].map((f, i) => ({
          fieldKey: f.fieldKey,
          visibility: f.visibility,
          requirement: f.requirement,
          readOnly: f.readOnly,
          sortOrder: GROUP_ORDER.indexOf(group) * 1000 + i,
          helperTextOverride: f.helperTextOverride || undefined,
        })),
      );
      await api.put(`/api/templates/${template!.id}/fields`, { fields });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['templates', 'by-request-type', requestTypeId] });
      toast.success('Template saved');
    },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error saving template'),
  });

  const updateField = (group: Group, index: number, patch: Partial<TemplateField>) => {
    setFieldsByGroup((prev) => {
      const next = [...prev[group]];
      next[index] = { ...next[index], ...patch };
      return { ...prev, [group]: next };
    });
  };

  const moveField = (group: Group, index: number, dir: -1 | 1) => {
    setFieldsByGroup((prev) => {
      const list = [...prev[group]];
      const target = index + dir;
      if (target < 0 || target >= list.length) return prev;
      [list[index], list[target]] = [list[target], list[index]];
      return { ...prev, [group]: list };
    });
  };

  if (isLoading || !template) {
    return <p className="text-muted-foreground">Loading...</p>;
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <Button variant="ghost" size="sm" asChild className="mb-2 -ml-2">
            <Link to="/admin/request-types"><ArrowLeft className="size-4" /> Request Types</Link>
          </Button>
          <h1 className="text-2xl font-bold text-foreground">{requestType?.name ?? template.name} Template</h1>
          <p className="text-sm text-muted-foreground">
            Choose which fields appear on the Create Ticket form for this request type, whether they're
            required, read-only, and in what order.
          </p>
        </div>
        <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
          {saveMutation.isPending ? 'Saving...' : 'Save Template'}
        </Button>
      </div>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Description Guidance</CardTitle>
          <CardDescription>
            This text pre-fills the Description field when someone creates a ticket from this template.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Textarea
            value={descriptionGuidance}
            onChange={(e) => setDescriptionGuidance(e.target.value)}
            placeholder="e.g. Describe the issue, what you were doing when it happened, and any error messages you saw."
            rows={3}
          />
        </CardContent>
      </Card>

      {GROUP_ORDER.map((group) => (
        <Card key={group} className="mb-6">
          <CardHeader>
            <CardTitle>{GROUP_LABELS[group]}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {fieldsByGroup[group].map((f, i) => (
              <div key={f.fieldKey} className="rounded-lg border p-3">
                <div className="flex flex-wrap items-center gap-4">
                  <div className="flex min-w-40 flex-1 items-center gap-2">
                    <div className="flex flex-col">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-4 w-6"
                        disabled={i === 0}
                        onClick={() => moveField(group, i, -1)}
                      >
                        <ArrowUp className="size-3.5" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-4 w-6"
                        disabled={i === fieldsByGroup[group].length - 1}
                        onClick={() => moveField(group, i, 1)}
                      >
                        <ArrowDown className="size-3.5" />
                      </Button>
                    </div>
                    <div>
                      <div className="text-sm font-medium text-foreground">{f.label}</div>
                      {f.systemManaged && (
                        <div className="text-xs text-muted-foreground">System field — visibility only</div>
                      )}
                    </div>
                  </div>

                  <label className="flex items-center gap-2 text-sm">
                    <Switch
                      checked={f.visibility === 'VISIBLE'}
                      onCheckedChange={(checked) =>
                        updateField(group, i, { visibility: checked ? 'VISIBLE' : 'HIDDEN' })
                      }
                    />
                    Visible
                  </label>

                  <Select
                    value={f.requirement}
                    onValueChange={(v) => updateField(group, i, { requirement: v as Requirement })}
                    disabled={f.visibility === 'HIDDEN' || f.systemManaged}
                  >
                    <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="MANDATORY">Mandatory</SelectItem>
                      <SelectItem value="OPTIONAL">Optional</SelectItem>
                    </SelectContent>
                  </Select>

                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={f.readOnly}
                      disabled={f.visibility === 'HIDDEN' || f.systemManaged}
                      onCheckedChange={(checked) => updateField(group, i, { readOnly: !!checked })}
                    />
                    Read-only
                  </label>

                  <Input
                    className="min-w-52 flex-1"
                    placeholder={f.helperText}
                    value={f.helperTextOverride ?? ''}
                    disabled={f.visibility === 'HIDDEN'}
                    onChange={(e) => updateField(group, i, { helperTextOverride: e.target.value })}
                  />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
