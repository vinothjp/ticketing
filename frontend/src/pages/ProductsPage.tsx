import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Plus, Search, Boxes } from 'lucide-react';
import api from '../lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import ProductIcon from '@/components/ProductIcon';

interface Product { id: string; name: string; code: string; description?: string | null; imageUrl?: string | null }

export default function ProductsPage() {
  const navigate = useNavigate();
  const [q, setQ] = useState('');

  const { data: products = [], isLoading } = useQuery<Product[]>({
    queryKey: ['products'],
    queryFn: async () => (await api.get('/api/products')).data,
  });

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return products;
    return products.filter((p) => p.name.toLowerCase().includes(term) || p.code.toLowerCase().includes(term));
  }, [products, q]);

  return (
    <div>
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Products</h1>
          <p className="text-sm text-muted-foreground">The products you support. Click one to edit its modules and agents.</p>
        </div>
        <Button onClick={() => navigate('/admin/products/new')}><Plus className="size-4" /> Add product</Button>
      </div>

      <div className="relative mb-5 max-w-sm">
        <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search products…" className="pl-8" />
      </div>

      {isLoading ? (
        <p className="text-muted-foreground">Loading…</p>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed py-12 text-center">
          <Boxes className="size-6 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">{products.length === 0 ? 'No products yet.' : 'No products match your search.'}</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {filtered.map((p) => (
            <button
              key={p.id}
              onClick={() => navigate(`/admin/products/${p.id}/edit`)}
              className="flex flex-col items-center gap-3 rounded-xl border bg-card p-6 text-center transition-colors hover:border-primary/50 hover:bg-muted/40"
            >
              <ProductIcon imageUrl={p.imageUrl} />
              <div className="min-w-0">
                <div className="truncate font-semibold text-foreground">{p.name}</div>
                <div className="text-xs text-muted-foreground">{p.code}</div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
