import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Plus, Search } from 'lucide-react';
import api from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

export interface KbAttachment { id: string; fileName: string; filePath: string; }
export interface KbUrlRef { label?: string; url: string; }
export interface KbArticle {
  id: string;
  documentNumber?: string | null;
  articleType: string;
  title: string;
  category?: string | null;
  subCategory?: string | null;
  module?: string | null;
  subject?: string | null;
  versionNumber?: string | null;
  body: string;
  problemDescription?: string | null;
  resolution?: string | null;
  cause?: string | null;
  prevention?: string | null;
  keywords: string[];
  urlReferences: KbUrlRef[];
  status: string;
  audience: string;
  knowledgeOwnerId?: string | null;
  knowledgeOwnerName?: string | null;
  publishedDate?: string | null;
  expiryDate?: string | null;
  createdByName?: string | null;
  updatedAt: string;
  attachments: KbAttachment[];
}

export default function KnowledgeBasePage() {
  const { user } = useAuth();
  const isStaff = !!user?.roles.some((r) => r === 'Admin' || r === 'Viewer');
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('all');

  const { data: articles = [], isLoading } = useQuery<KbArticle[]>({
    queryKey: ['kb-articles'],
    queryFn: async () => (await api.get('/api/kb-articles')).data,
  });

  const categories = useMemo(
    () => Array.from(new Set(articles.map((a) => a.category).filter((c): c is string => !!c))),
    [articles],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return articles.filter((a) => {
      const matchesSearch = !q || a.title.toLowerCase().includes(q) || a.body.toLowerCase().includes(q);
      const matchesCategory = category === 'all' || a.category === category;
      return matchesSearch && matchesCategory;
    });
  }, [articles, search, category]);

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Knowledge Base</h1>
          <p className="text-sm text-muted-foreground">
            {isStaff ? 'Help articles for your team and customers.' : 'Find answers to common questions.'}
          </p>
        </div>
        {isStaff && (
          <Button asChild>
            <Link to="/knowledge-base/new"><Plus className="size-4" /> New article</Link>
          </Button>
        )}
      </div>

      <div className="mb-5 flex flex-wrap items-center gap-2">
        <div className="relative w-full max-w-xs">
          <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search articles..." className="pl-8" />
        </div>
        {categories.length > 0 && (
          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All categories</SelectItem>
              {categories.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
      </div>

      {isLoading ? (
        <p className="text-muted-foreground">Loading...</p>
      ) : filtered.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">
          {articles.length === 0 ? 'No articles yet.' : 'No articles match your search.'}
        </p>
      ) : (
        <div className="divide-y border-y">
          {filtered.map((a) => (
            <Link
              key={a.id}
              to={`/knowledge-base/${a.id}`}
              className="block px-1 py-3 transition-colors hover:bg-accent/40"
            >
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="text-sm font-medium text-primary hover:underline">{a.title}</span>
                {a.category && <Badge variant="outline">{a.category}</Badge>}
                {isStaff && a.status !== 'PUBLISHED' && <Badge variant="secondary">Draft</Badge>}
                {isStaff && a.audience === 'CUSTOMER' && <Badge variant="success">Customer</Badge>}
              </div>
              <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{a.body}</p>
              <div className="mt-1 text-xs text-muted-foreground">
                {a.documentNumber ? `${a.documentNumber} · ` : ''}Updated {new Date(a.updatedAt).toLocaleDateString()}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
