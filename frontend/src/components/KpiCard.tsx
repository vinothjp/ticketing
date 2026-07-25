import { useNavigate } from 'react-router-dom';
import type { LucideIcon } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';

export interface Kpi {
  label: string;
  icon: LucideIcon;
  color: string;
  value: number | string;
  route: string;
}

export default function KpiCard({ kpi }: { kpi: Kpi }) {
  const navigate = useNavigate();
  return (
    <Card
      onClick={() => navigate(kpi.route)}
      className="cursor-pointer transition-all hover:-translate-y-0.5 hover:shadow-md"
    >
      <CardContent className="flex items-center gap-4 py-5">
        <div
          className="flex size-11 shrink-0 items-center justify-center rounded-xl"
          style={{ background: `${kpi.color}1a`, color: kpi.color }}
        >
          <kpi.icon className="size-5" />
        </div>
        <div>
          <div className="text-2xl font-bold text-foreground">{kpi.value}</div>
          <div className="text-sm text-muted-foreground">{kpi.label}</div>
        </div>
      </CardContent>
    </Card>
  );
}
