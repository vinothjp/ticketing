import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Receipt, FileText } from 'lucide-react';
import api from '../../../lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import RegisterSection, { type FieldCfg, type ColCfg } from './RegisterSection';
import { type ProjectDetail } from '../projectMeta';
import { attachmentTypesFor } from '../../../lib/uploads';

interface Financials {
  revenue: number; collected: number; outstanding: number;
  resourceCost: number; expenseCost: number; vendorCost: number; totalCost: number;
  grossProfit: number; grossMargin: number; budget: number; budgetRemaining: number;
  expensesByCategory: Record<string, number>;
  activityCosting: { activity: string; hours: number; cost: number; revenue: number; margin: number }[];
}

const money = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 0 });

const EXPENSE_CATS = ['Consultant Cost', 'Travel', 'Accommodation', 'Food', 'Hardware', 'Software', 'Cloud', 'Third Party', 'Training', 'Other Expenses'];
const expenseFields: FieldCfg[] = [
  { key: 'category', label: 'Category', type: 'select', options: EXPENSE_CATS },
  { key: 'description', label: 'Description', type: 'text' },
  { key: 'amount', label: 'Amount', type: 'number' },
  { key: 'date', label: 'Date', type: 'date' },
];
const expenseCols: ColCfg[] = [
  { key: 'category', label: 'Category' }, { key: 'description', label: 'Description' },
  { key: 'amount', label: 'Amount', kind: 'money', align: 'right' }, { key: 'date', label: 'Date', kind: 'date' },
];
const invoiceFields: FieldCfg[] = [
  { key: 'invoiceNumber', label: 'Invoice #', type: 'text' },
  { key: 'invoiceDate', label: 'Date', type: 'date' },
  { key: 'amount', label: 'Amount', type: 'number' },
  { key: 'amountPaid', label: 'Amount paid', type: 'number' },
  { key: 'type', label: 'Type', type: 'select', options: ['Fixed Price', 'Time & Material', 'AMC', 'Internal'] },
  { key: 'status', label: 'Status', type: 'select', options: ['DRAFT', 'SENT', 'PAID'] },
];
const invoiceCols: ColCfg[] = [
  { key: 'invoiceNumber', label: 'Invoice #' }, { key: 'type', label: 'Type' },
  { key: 'amount', label: 'Amount', kind: 'money', align: 'right' }, { key: 'amountPaid', label: 'Paid', kind: 'money', align: 'right' },
  { key: 'invoiceDate', label: 'Date', kind: 'date' }, { key: 'status', label: 'Status', kind: 'badge' },
];

function Kpi({ label, value, tone }: { label: string; value: string; tone?: 'good' | 'bad' | 'muted' }) {
  const color = tone === 'good' ? 'text-success' : tone === 'bad' ? 'text-destructive' : 'text-foreground';
  return (
    <Card>
      <CardContent className="py-4">
        <div className={`text-xl font-bold ${color}`}>{value}</div>
        <div className="text-xs text-muted-foreground">{label}</div>
      </CardContent>
    </Card>
  );
}

export default function FinancialsTab({ project }: { project: ProjectDetail }) {
  const [view, setView] = useState<'expenses' | 'invoices'>('expenses');
  const { data: f } = useQuery<Financials>({
    queryKey: ['projects', project.id, 'financials'],
    queryFn: async () => (await api.get(`/api/projects/${project.id}/financials`)).data,
  });

  return (
    <div className="space-y-6">
      {f && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Kpi label="Revenue" value={money(f.revenue)} />
            <Kpi label="Total cost" value={money(f.totalCost)} />
            <Kpi label="Gross profit" value={money(f.grossProfit)} tone={f.grossProfit >= 0 ? 'good' : 'bad'} />
            <Kpi label="Gross margin" value={`${f.grossMargin}%`} tone={f.grossMargin >= 0 ? 'good' : 'bad'} />
            <Kpi label="Budget" value={money(f.budget)} tone="muted" />
            <Kpi label="Budget remaining" value={money(f.budgetRemaining)} tone={f.budgetRemaining >= 0 ? 'good' : 'bad'} />
            <Kpi label="Collected" value={money(f.collected)} />
            <Kpi label="Outstanding" value={money(f.outstanding)} tone={f.outstanding > 0 ? 'bad' : 'muted'} />
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Cost breakdown</CardTitle></CardHeader>
              <CardContent className="space-y-1.5 pb-4 text-sm">
                <div className="flex justify-between"><span className="text-muted-foreground">Resource cost (timesheets)</span><span className="tabular-nums">{money(f.resourceCost)}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Expenses</span><span className="tabular-nums">{money(f.expenseCost)}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Vendor cost</span><span className="tabular-nums">{money(f.vendorCost)}</span></div>
                <div className="flex justify-between border-t pt-1.5 font-medium"><span>Total cost</span><span className="tabular-nums">{money(f.totalCost)}</span></div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Expenses by category</CardTitle></CardHeader>
              <CardContent className="space-y-1.5 pb-4 text-sm">
                {Object.keys(f.expensesByCategory).length === 0 && <p className="text-muted-foreground">No expenses.</p>}
                {Object.entries(f.expensesByCategory).map(([c, v]) => (
                  <div key={c} className="flex justify-between"><span className="text-muted-foreground">{c}</span><span className="tabular-nums">{money(v)}</span></div>
                ))}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Activity costing</CardTitle></CardHeader>
            <CardContent className="overflow-x-auto pb-4">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Activity</TableHead>
                    <TableHead className="text-right">Hours</TableHead>
                    <TableHead className="text-right">Cost</TableHead>
                    <TableHead className="text-right">Revenue</TableHead>
                    <TableHead className="text-right">Margin %</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {f.activityCosting.length === 0 && <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">No time logged yet.</TableCell></TableRow>}
                  {f.activityCosting.map((a) => (
                    <TableRow key={a.activity}>
                      <TableCell className="font-medium">{a.activity}</TableCell>
                      <TableCell className="text-right tabular-nums">{a.hours}</TableCell>
                      <TableCell className="text-right tabular-nums">{money(a.cost)}</TableCell>
                      <TableCell className="text-right tabular-nums">{money(a.revenue)}</TableCell>
                      <TableCell className="text-right tabular-nums">{a.margin}%</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}

      <div>
        <div className="mb-3 flex rounded-md border p-0.5 w-fit">
          <Button size="sm" variant={view === 'expenses' ? 'secondary' : 'ghost'} className="h-7 px-2" onClick={() => setView('expenses')}><Receipt className="size-4" /> Expenses</Button>
          <Button size="sm" variant={view === 'invoices' ? 'secondary' : 'ghost'} className="h-7 px-2" onClick={() => setView('invoices')}><FileText className="size-4" /> Invoices</Button>
        </div>
        {view === 'expenses'
          ? <RegisterSection projectId={project.id} type="expenses" singular="Expense" fields={expenseFields} columns={expenseCols} attachEntityType="expense" acceptTypes={attachmentTypesFor(project.features, 'expense')} exportable />
          : <RegisterSection projectId={project.id} type="invoices" singular="Invoice" fields={invoiceFields} columns={invoiceCols} attachEntityType="invoice" acceptTypes={attachmentTypesFor(project.features, 'invoice')} exportable />}
      </div>
    </div>
  );
}
