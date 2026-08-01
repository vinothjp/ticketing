import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { ArrowLeft, Pencil, Trash2, Paperclip, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';
import api from '../../lib/api';
import { assetUrl } from '@/lib/assetUrl';
import { useAuth } from '../../context/AuthContext';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import type { KbArticle } from '../KnowledgeBasePage';

function Block({ title, text }: { title: string; text?: string | null }) {
  if (!text) return null;
  return (
    <div>
      <h2 className="mb-1 text-sm font-semibold text-foreground">{title}</h2>
      <div className="rounded-lg border bg-card p-4 text-sm leading-relaxed whitespace-pre-wrap text-foreground">{text}</div>
    </div>
  );
}

function Meta({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return <div><dt className="text-xs text-muted-foreground">{label}</dt><dd className="text-sm text-foreground">{value}</dd></div>;
}

export default function KbArticlePage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { user } = useAuth();
  const isStaff = !!user?.roles.some((r) => r === 'Admin' || r === 'Viewer');
  const fmt = (d?: string | null) => (d ? new Date(d).toLocaleDateString() : null);

  const { data: article, isLoading, isError } = useQuery<KbArticle>({
    queryKey: ['kb-article', id],
    queryFn: async () => (await api.get(`/api/kb-articles/${id}`)).data,
    enabled: !!id,
  });

  const deleteMutation = useMutation({
    mutationFn: () => api.delete(`/api/kb-articles/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['kb-articles'] }); toast.success('Article deleted'); navigate('/knowledge-base'); },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error deleting article'),
  });

  if (isLoading) return <p className="text-muted-foreground">Loading...</p>;
  if (isError || !article) {
    return (
      <div>
        <Button variant="ghost" size="sm" onClick={() => navigate(-1)} className="mb-3 -ml-2"><ArrowLeft className="size-4" /> Back</Button>
        <p className="text-muted-foreground">Article not found.</p>
      </div>
    );
  }

  const isProblem = article.articleType === 'PROBLEM';
  const taxonomy = [article.category, article.subCategory, article.module].filter(Boolean).join(' ▸ ');

  return (
    <div className="max-w-3xl space-y-5">
      <div className="flex items-center justify-between">
        <Button variant="ghost" size="sm" onClick={() => navigate(-1)} className="-ml-2"><ArrowLeft className="size-4" /> Back</Button>
        {isStaff && (
          <div className="flex gap-2">
            <Button size="sm" variant="outline" asChild><Link to={`/knowledge-base/${article.id}/edit`}><Pencil className="size-4" /> Edit</Link></Button>
            <Button size="sm" variant="destructive" onClick={() => { if (confirm('Delete this article?')) deleteMutation.mutate(); }}><Trash2 className="size-4" /></Button>
          </div>
        )}
      </div>

      <div>
        <div className="mb-2 flex flex-wrap items-center gap-2">
          {article.documentNumber && <Badge variant="outline">{article.documentNumber}</Badge>}
          <Badge variant="secondary">{isProblem ? 'Problem / Solution' : 'Knowledge'}</Badge>
          {isStaff && article.status !== 'PUBLISHED' && <Badge variant="secondary">Draft</Badge>}
          {isStaff && <Badge variant={article.audience === 'CUSTOMER' ? 'success' : 'secondary'}>{article.audience === 'CUSTOMER' ? 'Customer-visible' : 'Internal'}</Badge>}
        </div>
        <h1 className="text-2xl font-bold text-foreground">{article.title}</h1>
        {article.subject && <p className="mt-1 text-sm text-muted-foreground">{article.subject}</p>}
      </div>

      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 rounded-xl border bg-card p-4 sm:grid-cols-3">
        <Meta label="Category" value={taxonomy || undefined} />
        <Meta label="Version" value={article.versionNumber} />
        <Meta label="Knowledge owner" value={article.knowledgeOwnerName} />
        <Meta label="Author" value={article.createdByName} />
        <Meta label="Published" value={fmt(article.publishedDate)} />
        <Meta label="Expires" value={fmt(article.expiryDate)} />
      </dl>

      <Block title="Content" text={article.body} />
      {isProblem && (
        <>
          <Block title="Problem description" text={article.problemDescription} />
          <Block title="Resolution" text={article.resolution} />
          <Block title="Cause" text={article.cause} />
          <Block title="Prevention" text={article.prevention} />
        </>
      )}

      {article.keywords?.length > 0 && (
        <div>
          <h2 className="mb-1 text-sm font-semibold text-foreground">Keywords</h2>
          <div className="flex flex-wrap gap-1.5">
            {article.keywords.map((k) => <span key={k} className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">{k}</span>)}
          </div>
        </div>
      )}

      {article.attachments?.length > 0 && (
        <div>
          <h2 className="mb-1 text-sm font-semibold text-foreground">Attachments</h2>
          <div className="flex flex-wrap gap-2">
            {article.attachments.map((a) => (
              <a key={a.id} href={assetUrl(a.filePath)!} target="_blank" rel="noreferrer" className="flex items-center gap-1 rounded-full border bg-background px-2.5 py-1 text-xs hover:bg-accent">
                <Paperclip className="size-3" /> {a.fileName}
              </a>
            ))}
          </div>
        </div>
      )}

      {article.urlReferences?.length > 0 && (
        <div>
          <h2 className="mb-1 text-sm font-semibold text-foreground">References</h2>
          <ul className="space-y-1">
            {article.urlReferences.map((r, i) => (
              <li key={i}>
                <a href={r.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm text-primary hover:underline">
                  {r.label || r.url} <ExternalLink className="size-3" />
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
