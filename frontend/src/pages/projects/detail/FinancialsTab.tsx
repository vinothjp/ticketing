import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Receipt, FileText } from 'lucide-react';
import api from '../../../lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from '@/components/ui/tooltip';
import RegisterSection, { type FieldCfg, type ColCfg } from './RegisterSection';
import { type ProjectDetail } from '../projectMeta';
import { attachmentTypesFor } from '../../../lib/uploads';
import { useOptionValues } from '@/lib/optionLists';

interface Financials {
  revenue: number; collected: number; outstanding: number;
  resourceCost: number; expenseCost: number; vendorCost: number; totalCost: number;
  grossProfit: number; grossMargin: number; budget: number; budgetRemaining: number;
  budgetBaseline: number; approvedChanges: number; pendingChanges: number; revisedBudget: number;
  expensesByCategory: Record<string, number>;
  activityCosting: { activity: string; hours: number; cost: number; revenue: number; margin: number }[];
}

const money = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 0 });

// Seeds (and backs) the `expenseCategory` option list, which is what the form
// actually reads — see the Option List screen.
const EXPENSE_CATS = ['Consultant Cost', 'Travel', 'Accommodation', 'Food', 'Hardware', 'Software', 'Cloud', 'Third Party', 'Training', 'Other Expenses'];
const expenseCols: ColCfg[] = [
  { key: 'category', label: 'Category' }, { key: 'description', label: 'Description' },
  { key: 'amount', label: 'Amount', kind: 'money', align: 'right' }, { key: 'date', label: 'Date', kind: 'date' },
];
// Invoice status is read-only and derived: Paid once the full amount is paid, else Pending.
const invoiceStatus = (row: Record<string, any>) => (Number(row.amount) > 0 && Number(row.amountPaid) >= Number(row.amount) ? 'Paid' : 'Pending');
// Seeds (and backs) the `projectInvoiceType` option list.
const INVOICE_TYPES = ['Fixed Price', 'Time & Material', 'AMC', 'Internal'];
const invoiceCols: ColCfg[] = [
  { key: 'invoiceNumber', label: 'Invoice #' }, { key: 'invoiceDate', label: 'Date', kind: 'date' }, { key: 'type', label: 'Type' },
  { key: 'amount', label: 'Amount', kind: 'money', align: 'right' }, { key: 'amountPaid', label: 'Paid', kind: 'money', align: 'right' },
  { key: 'outstanding', label: 'Outstanding', kind: 'money', align: 'right', compute: (row) => (Number(row.amount) || 0) - (Number(row.amountPaid) || 0) },
  { key: 'status', label: 'Status', kind: 'badge', compute: invoiceStatus },
];

function Kpi({ label, value, tone, hint }: { label: string; value: string; tone?: 'good' | 'bad' | 'muted'; hint?: string }) {
  const color = tone === 'good' ? 'text-success' : tone === 'bad' ? 'text-destructive' : 'text-foreground';
  return (
    <Card>
      <CardContent className="py-4">
        <div className={`text-xl font-bold ${color}`}>{value}</div>
        {hint ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="w-fit cursor-help text-xs text-muted-foreground underline decoration-dotted decoration-muted-foreground/40 underline-offset-2">{label}</span>
            </TooltipTrigger>
            <TooltipContent>{hint}</TooltipContent>
          </Tooltip>
        ) : (
          <div className="text-xs text-muted-foreground">{label}</div>
        )}
      </CardContent>
    </Card>
  );
}

export default function FinancialsTab({ project }: { project: ProjectDetail }) {
  const [view, setView] = useState<'expenses' | 'invoices'>('expenses');
  const expenseCats = useOptionValues('expenseCategory', EXPENSE_CATS);
  const invoiceTypes = useOptionValues('projectInvoiceType', INVOICE_TYPES);
  const invoiceFields = useMemo<FieldCfg[]>(() => [
    { key: 'invoiceNumber', label: 'Invoice #', type: 'text' },
    { key: 'invoiceDate', label: 'Date', type: 'date' },
    { key: 'amount', label: 'Invoice amount', type: 'number' },
    { key: 'amountPaid', label: 'Amount to be paid', type: 'number' },
    { key: 'type', label: 'Type', type: 'select', options: invoiceTypes },
  ], [invoiceTypes]);
  const expenseFields = useMemo<FieldCfg[]>(() => [
    { key: 'category', label: 'Category', type: 'select', options: expenseCats },
    { key: 'description', label: 'Description', type: 'text' },
    { key: 'amount', label: 'Amount', type: 'number' },
    { key: 'date', label: 'Date', type: 'date' },
  ], [expenseCats]);
  const { data: f } = useQuery<Financials>({
    queryKey: ['projects', project.id, 'financials'],
    queryFn: async () => (await api.get(`/api/projects/${project.id}/financials`)).data,
  });

  return (
    <div className="space-y-6">
      {f && (
        <>
          <TooltipProvider>
          <div className="space-y-4">
            <div>
              <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Billing</div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Kpi label="Revenue" value={money(f.revenue)} hint="Σ of every invoice's Amount" />
                <Kpi label="Collected" value={money(f.collected)} tone="good" hint="Σ of every invoice's Paid" />
                <Kpi label="Outstanding" value={money(f.outstanding)} tone={f.outstanding > 0 ? 'bad' : 'muted'} hint="Revenue − Collected" />
              </div>
            </div>
            <div>
              <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Profitability</div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Kpi label="Total cost" value={money(f.totalCost)} hint="Resource cost + Expenses" />
                <Kpi label="Gross profit" value={money(f.grossProfit)} tone={f.grossProfit >= 0 ? 'good' : 'bad'} hint="Revenue − Total cost" />
                <Kpi label="Gross margin" value={`${f.grossMargin}%`} tone={f.grossMargin >= 0 ? 'good' : 'bad'} hint="Gross profit ÷ Revenue" />
              </div>
            </div>
            <div>
              <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Value</div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Kpi label="Original value" value={money(f.budgetBaseline)} tone="muted" hint="Project's set budget" />
                <Kpi label="Approved changes" value={(f.approvedChanges > 0 ? '+' : '') + money(f.approvedChanges)} tone={f.approvedChanges > 0 ? 'good' : 'muted'} hint="Σ of approved change requests" />
                <Kpi label="Project value" value={money(f.revisedBudget)} hint="Original value + Approved changes" />
                <Kpi label="Remaining value" value={money(f.budgetRemaining)} tone={f.budgetRemaining >= 0 ? 'good' : 'bad'} hint="Project value − Total cost" />
              </div>
            </div>
          </div>
          </TooltipProvider>

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
          : <div className="space-y-3">
            {f && (
              <div className="flex flex-wrap items-center gap-x-6 gap-y-1.5 rounded-md border bg-muted/30 px-4 py-2.5 text-sm">
                <span className="flex items-baseline gap-1.5"><span className="text-muted-foreground">Project value</span><span className="font-semibold tabular-nums">{money(f.revisedBudget)}</span></span>
                <span className="text-border">|</span>
                <span className="flex items-baseline gap-1.5"><span className="text-muted-foreground">Total billed</span><span className="font-semibold tabular-nums">{money(f.revenue)}</span></span>
                <span className="text-border">|</span>
                <span className="flex items-baseline gap-1.5"><span className="text-muted-foreground">Paid</span><span className="font-semibold tabular-nums text-success">{money(f.collected)}</span></span>
                <span className="text-border">|</span>
                <span className="flex items-baseline gap-1.5"><span className="text-muted-foreground">Unbilled</span><span className={`font-semibold tabular-nums ${f.revisedBudget - f.revenue < 0 ? 'text-destructive' : ''}`}>{money(f.revisedBudget - f.revenue)}</span></span>
              </div>
            )}
            <RegisterSection projectId={project.id} type="invoices" singular="Invoice" fields={invoiceFields} columns={invoiceCols} attachEntityType="invoice" acceptTypes={attachmentTypesFor(project.features, 'invoice')} exportable
              summaryRows={{
                currency: project.currency ?? undefined,
                rows: [
                  { label: 'Invoice amount', value: (fm) => Number(fm.amount) || 0 },
                  { label: 'Amount to be paid', value: (fm) => Number(fm.amountPaid) || 0 },
                  { label: 'Yet to invoice', value: (fm) => (Number(fm.amount) || 0) - (Number(fm.amountPaid) || 0), emphasis: true },
                  { label: 'Status', badge: (fm) => invoiceStatus(fm) },
                ],
              }}
              validate={(fm) => ((Number(fm.amountPaid) || 0) > (Number(fm.amount) || 0) ? "Amount to be paid can't exceed the invoice amount" : null)} />
          </div>}
      </div>
    </div>
  );
}
