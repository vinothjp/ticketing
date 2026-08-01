import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { ArrowLeft, X, Plus, Paperclip, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';
import api from '../../lib/api';
import { assetUrl } from '@/lib/assetUrl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { FILE_TYPE_OPTIONS } from '../templates/templateMeta';
import type { KbArticle, KbAttachment } from '../KnowledgeBasePage';

interface PicklistOpt { value: string; label: string; parentValue?: string | null; isActive?: boolean }
interface UserOption { id: string; username: string; }
const MAX_MB = 5;
const ACCEPT = FILE_TYPE_OPTIONS.map((o) => o.value).join(',');
const SUPPORTED = FILE_TYPE_OPTIONS.map((o) => o.label).join(', ');
const DRAFT_KEY = 'kb-draft-new';

const empty = {
  title: '', articleType: 'KNOWLEDGE', category: '', subCategory: '', module: '',
  subject: '', versionNumber: '', body: '', problemDescription: '', resolution: '',
  cause: '', prevention: '', status: 'DRAFT', audience: 'INTERNAL',
  knowledgeOwnerId: '', publishedDate: '', expiryDate: '',
};

const picklist = (key: string) => ({
  queryKey: ['picklist-options', key],
  queryFn: async () => (await api.get('/api/picklist-options', { params: { listKey: key } })).data as PicklistOpt[],
});

// Defined at module scope so they keep a stable identity across renders —
// otherwise inputs remount on every keystroke (focus loss + page jump).
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="space-y-1.5"><label className="text-sm font-medium">{label}</label>{children}</div>;
}
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t pt-4">
      <h2 className="mb-3 text-base font-semibold text-foreground">{title}</h2>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

export default function KbArticleEditorPage() {
  const { id } = useParams<{ id: string }>();
  const isEdit = !!id;
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [form, setForm] = useState(empty);
  const [documentNumber, setDocumentNumber] = useState<string | null>(null);
  const [keywords, setKeywords] = useState<string[]>([]);
  const [keywordInput, setKeywordInput] = useState('');
  const [urlRefs, setUrlRefs] = useState<{ label: string; url: string }[]>([]);
  const [newFiles, setNewFiles] = useState<File[]>([]);
  const [existingAtt, setExistingAtt] = useState<KbAttachment[]>([]);
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));

  // Hover-preview open state (JS-controlled so moving mouse into the popup doesn't dismiss it).
  const [hoveredDupe, setHoveredDupe] = useState<string | null>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const openPreview = (dId: string) => { if (hoverTimer.current) clearTimeout(hoverTimer.current); setHoveredDupe(dId); };
  const closePreviewSoon = () => { if (hoverTimer.current) clearTimeout(hoverTimer.current); hoverTimer.current = setTimeout(() => setHoveredDupe(null), 150); };

  const { data: categories = [] } = useQuery(picklist('kbCategory'));
  const { data: subCategories = [] } = useQuery(picklist('kbSubCategory'));
  const { data: modules = [] } = useQuery(picklist('kbModule'));
  const { data: users = [] } = useQuery<UserOption[]>({ queryKey: ['users'], queryFn: async () => (await api.get('/api/users')).data });
  const { data: allKeywords = [] } = useQuery<string[]>({ queryKey: ['kb-keywords'], queryFn: async () => (await api.get('/api/kb-articles/keywords')).data });

  const { data: existing } = useQuery<KbArticle>({
    queryKey: ['kb-article', id],
    queryFn: async () => (await api.get(`/api/kb-articles/${id}`)).data,
    enabled: isEdit,
  });

  useEffect(() => {
    if (!existing) return;
    setForm({
      title: existing.title, articleType: existing.articleType, category: existing.category ?? '',
      subCategory: existing.subCategory ?? '', module: existing.module ?? '', subject: existing.subject ?? '',
      versionNumber: existing.versionNumber ?? '', body: existing.body,
      problemDescription: existing.problemDescription ?? '', resolution: existing.resolution ?? '',
      cause: existing.cause ?? '', prevention: existing.prevention ?? '', status: existing.status,
      audience: existing.audience, knowledgeOwnerId: existing.knowledgeOwnerId ?? '',
      publishedDate: existing.publishedDate?.slice(0, 10) ?? '', expiryDate: existing.expiryDate?.slice(0, 10) ?? '',
    });
    setDocumentNumber(existing.documentNumber ?? null);
    setKeywords(existing.keywords ?? []);
    setUrlRefs((existing.urlReferences ?? []).map((r) => ({ label: r.label ?? '', url: r.url })));
    setExistingAtt(existing.attachments ?? []);
  }, [existing]);

  // Persist a new-article draft so navigating away (e.g. "View full") and back keeps your fields.
  // Latest-value refs so the unmount handler saves the current state, not a stale closure.
  const formRef = useRef(form); formRef.current = form;
  const kwRef = useRef(keywords); kwRef.current = keywords;
  const urlRef = useRef(urlRefs); urlRef.current = urlRefs;
  const skipPersist = useRef(false);

  useEffect(() => {
    if (isEdit) return;
    // Load any saved draft on mount.
    const raw = sessionStorage.getItem(DRAFT_KEY);
    if (raw) {
      try {
        const d = JSON.parse(raw);
        if (d.form) setForm(d.form);
        if (d.keywords) setKeywords(d.keywords);
        if (d.urlRefs) setUrlRefs(d.urlRefs);
      } catch { /* ignore corrupt draft */ }
    }
    // Save on unmount (navigating away) unless we're deliberately discarding it.
    return () => {
      if (skipPersist.current) return;
      sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ form: formRef.current, keywords: kwRef.current, urlRefs: urlRef.current }));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEdit]);

  const isProblem = form.articleType === 'PROBLEM';
  const subOptions = useMemo(
    () => subCategories.filter((s) => s.parentValue === form.category),
    [subCategories, form.category],
  );

  // --- Keyword tag input ---
  const kwSuggestions = useMemo(() => {
    const q = keywordInput.trim().toLowerCase();
    if (!q) return [];
    return allKeywords.filter((k) => k.toLowerCase().includes(q) && !keywords.includes(k)).slice(0, 6);
  }, [keywordInput, allKeywords, keywords]);
  const addKeyword = (raw: string) => {
    const k = raw.trim();
    if (k && !keywords.includes(k)) setKeywords((prev) => [...prev, k]);
    setKeywordInput('');
  };
  const onKeywordKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addKeyword(keywordInput); }
    else if (e.key === 'Backspace' && !keywordInput && keywords.length) setKeywords((p) => p.slice(0, -1));
  };

  // --- Duplicate title detection (debounced) ---
  const [dupes, setDupes] = useState<KbArticle[]>([]);
  const dupTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (dupTimer.current) clearTimeout(dupTimer.current);
    const q = form.title.trim();
    if (q.length < 3) { setDupes([]); return; }
    dupTimer.current = setTimeout(async () => {
      try {
        const res = await api.get('/api/kb-articles', { params: { search: q } });
        setDupes((res.data as KbArticle[]).filter((a) => a.id !== id).slice(0, 4));
      } catch { setDupes([]); }
    }, 400);
    return () => { if (dupTimer.current) clearTimeout(dupTimer.current); };
  }, [form.title, id]);

  // --- URL refs ---
  const addUrl = () => setUrlRefs((p) => [...p, { label: '', url: '' }]);
  const setUrl = (i: number, patch: Partial<{ label: string; url: string }>) =>
    setUrlRefs((p) => p.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const removeUrl = (i: number) => setUrlRefs((p) => p.filter((_, j) => j !== i));

  // --- Attachments ---
  const onPickFiles = (list: FileList | null) => {
    const picked = Array.from(list ?? []);
    const tooBig = picked.filter((f) => f.size > MAX_MB * 1024 * 1024);
    if (tooBig.length) toast.error(`Each file must be ≤ ${MAX_MB} MB`);
    setNewFiles((prev) => [...prev, ...picked.filter((f) => f.size <= MAX_MB * 1024 * 1024)].slice(0, 5));
  };
  const removeExistingAtt = useMutation({
    mutationFn: (attId: string) => api.delete(`/api/kb-articles/${id}/attachments/${attId}`),
    onSuccess: (_r, attId) => setExistingAtt((p) => p.filter((a) => a.id !== attId)),
  });

  const uploadFiles = async (articleId: string) => {
    if (!newFiles.length) return;
    const fd = new FormData();
    newFiles.forEach((f) => fd.append('attachments', f));
    await api.post(`/api/kb-articles/${articleId}/attachments`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        ...form,
        knowledgeOwnerId: form.knowledgeOwnerId || undefined,
        publishedDate: form.publishedDate || undefined,
        expiryDate: form.expiryDate || undefined,
        keywords,
        urlReferences: urlRefs.filter((r) => r.url.trim()).map((r) => ({ label: r.label || undefined, url: r.url })),
      };
      const res = isEdit
        ? await api.patch(`/api/kb-articles/${id}`, payload)
        : await api.post('/api/kb-articles', payload);
      const articleId = isEdit ? id! : res.data.id;
      await uploadFiles(articleId);
      return articleId;
    },
    onSuccess: (articleId) => {
      if (!isEdit) { skipPersist.current = true; sessionStorage.removeItem(DRAFT_KEY); }
      qc.invalidateQueries({ queryKey: ['kb-articles'] });
      qc.invalidateQueries({ queryKey: ['kb-article', articleId] });
      qc.invalidateQueries({ queryKey: ['kb-keywords'] });
      toast.success(isEdit ? 'Article saved' : 'Article created');
      navigate(`/knowledge-base/${articleId}`);
    },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error saving article'),
  });

  return (
    <div className="max-w-3xl space-y-4">
      <div className="mb-1">
        <Button variant="ghost" size="sm" asChild className="mb-2 -ml-2">
          <Link to="/knowledge-base"><ArrowLeft className="size-4" /> Knowledge Base</Link>
        </Button>
        <h1 className="text-2xl font-bold text-foreground">{isEdit ? 'Edit article' : 'New article'}</h1>
      </div>

      <Section title="Basics">
        <Field label="Title">
          <div className="relative">
            <Input value={form.title} onChange={(e) => set({ title: e.target.value })} placeholder="How to reset your password" />
            {dupes.length > 0 && (
              <div className="absolute z-20 mt-1 w-full rounded-lg border bg-popover p-1 shadow-md">
                <div className="px-2 py-1 text-xs text-muted-foreground">Similar articles already exist:</div>
                {dupes.map((d) => (
                  <div
                    key={d.id}
                    className="relative"
                    onMouseEnter={() => openPreview(d.id)}
                    onMouseLeave={closePreviewSoon}
                  >
                    {/* Click the whole row to open the article (same tab). */}
                    <Link to={`/knowledge-base/${d.id}`} className="block truncate rounded px-2 py-1.5 text-sm hover:bg-accent">
                      {d.title}
                      {d.category ? <span className="text-muted-foreground"> · {d.category}</span> : ''}
                    </Link>
                    {/* Hover preview with a View-full link. */}
                    {hoveredDupe === d.id && (
                    <div
                      onMouseEnter={() => openPreview(d.id)}
                      onMouseLeave={closePreviewSoon}
                      className="absolute top-full left-1/2 z-30 mt-1 w-72 -translate-x-1/2 rounded-lg border bg-popover p-3 text-left shadow-lg"
                    >
                      <div className="text-sm font-medium text-foreground">{d.title}</div>
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        {[d.category, d.subCategory, d.module].filter(Boolean).join(' ▸ ') || 'Uncategorised'}
                      </div>
                      {d.body && <p className="mt-1.5 line-clamp-4 text-xs whitespace-pre-wrap text-muted-foreground">{d.body}</p>}
                      {d.keywords?.length > 0 && (
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          {d.keywords.slice(0, 5).map((k) => <span key={k} className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{k}</span>)}
                        </div>
                      )}
                      <Link to={`/knowledge-base/${d.id}`} className="mt-2 inline-flex items-center gap-1 text-xs text-primary hover:underline">
                        View full <ExternalLink className="size-3" />
                      </Link>
                    </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </Field>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {isEdit && <Field label="Document No."><Input value={documentNumber ?? '—'} readOnly disabled /></Field>}
          <Field label="Version"><Input value={form.versionNumber} onChange={(e) => set({ versionNumber: e.target.value })} placeholder="1.0" /></Field>
          <Field label="Module">
            <Select value={form.module || undefined} onValueChange={(v) => set({ module: v })}>
              <SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger>
              <SelectContent>{modules.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
        </div>
        <Field label="Subject"><Input value={form.subject} onChange={(e) => set({ subject: e.target.value })} placeholder="Short summary" /></Field>
      </Section>

      <Section title="Classification">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Field label="Article type">
            <Select value={form.articleType} onValueChange={(v) => set({ articleType: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="KNOWLEDGE">Knowledge</SelectItem>
                <SelectItem value="PROBLEM">Problem / Solution</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Category">
            <Select value={form.category || undefined} onValueChange={(v) => set({ category: v, subCategory: '' })}>
              <SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger>
              <SelectContent>{categories.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <Field label="Sub-category">
            <Select value={form.subCategory || undefined} onValueChange={(v) => set({ subCategory: v })} disabled={!form.category}>
              <SelectTrigger><SelectValue placeholder={form.category ? 'Select…' : 'Pick a category first'} /></SelectTrigger>
              <SelectContent>{subOptions.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
        </div>
      </Section>

      <Section title="Ownership & visibility">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Knowledge owner">
            <Select value={form.knowledgeOwnerId || undefined} onValueChange={(v) => set({ knowledgeOwnerId: v })}>
              <SelectTrigger><SelectValue placeholder="Select a user…" /></SelectTrigger>
              <SelectContent>{users.map((u) => <SelectItem key={u.id} value={u.id}>{u.username}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <Field label="Author"><Input value={existing?.createdByName ?? 'You'} readOnly disabled /></Field>
          <Field label="Published date"><Input type="date" value={form.publishedDate} onChange={(e) => set({ publishedDate: e.target.value })} /></Field>
          <Field label="Expiry date"><Input type="date" value={form.expiryDate} onChange={(e) => set({ expiryDate: e.target.value })} /></Field>
          <Field label="Visibility">
            <Select value={form.audience} onValueChange={(v) => set({ audience: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="INTERNAL">Internal (staff only)</SelectItem>
                <SelectItem value="CUSTOMER">Customer-visible</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Status">
            <Select value={form.status} onValueChange={(v) => set({ status: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="DRAFT">Draft</SelectItem>
                <SelectItem value="PUBLISHED">Published</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        </div>
      </Section>

      <Section title="Content">
        <Textarea rows={6} value={form.body} onChange={(e) => set({ body: e.target.value })} placeholder="Write the article…" />
        {isProblem && (
          <>
            <Field label="Problem description"><Textarea rows={4} value={form.problemDescription} onChange={(e) => set({ problemDescription: e.target.value })} /></Field>
            <Field label="Resolution"><Textarea rows={4} value={form.resolution} onChange={(e) => set({ resolution: e.target.value })} /></Field>
            <Field label="Cause"><Textarea rows={3} value={form.cause} onChange={(e) => set({ cause: e.target.value })} /></Field>
            <Field label="Prevention"><Textarea rows={3} value={form.prevention} onChange={(e) => set({ prevention: e.target.value })} /></Field>
          </>
        )}
      </Section>

      <Section title="Keywords">
        <div className="flex flex-wrap items-center gap-1.5 rounded-lg border p-2">
          {keywords.map((k) => (
            <span key={k} className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">
              {k}<button type="button" onClick={() => setKeywords((p) => p.filter((x) => x !== k))}><X className="size-3" /></button>
            </span>
          ))}
          <div className="relative min-w-[8rem] flex-1">
            <input
              value={keywordInput}
              onChange={(e) => setKeywordInput(e.target.value)}
              onKeyDown={onKeywordKey}
              placeholder="Type and press comma…"
              className="w-full bg-transparent text-sm outline-none"
            />
            {kwSuggestions.length > 0 && (
              <div className="absolute left-0 z-20 mt-1 w-56 rounded-lg border bg-popover p-1 shadow-md">
                {kwSuggestions.map((s) => (
                  <button key={s} type="button" onClick={() => addKeyword(s)} className="block w-full rounded px-2 py-1.5 text-left text-sm hover:bg-accent">{s}</button>
                ))}
              </div>
            )}
          </div>
        </div>
        <p className="text-xs text-muted-foreground">Comma-separated tags for search; suggestions come from existing articles.</p>
      </Section>

      <Section title="Attachments">
        <div className="flex flex-wrap gap-2">
          {existingAtt.map((a) => (
            <span key={a.id} className="inline-flex items-center gap-1 rounded-full border bg-background px-2.5 py-1 text-xs">
              <Paperclip className="size-3" /> {a.fileName}
              <button type="button" onClick={() => removeExistingAtt.mutate(a.id)}><X className="size-3 text-destructive" /></button>
            </span>
          ))}
          {newFiles.map((f, i) => (
            <span key={i} className="inline-flex items-center gap-1 rounded-full border border-dashed bg-background px-2.5 py-1 text-xs">
              <Paperclip className="size-3" /> {f.name}
              <button type="button" onClick={() => setNewFiles((p) => p.filter((_, j) => j !== i))}><X className="size-3" /></button>
            </span>
          ))}
        </div>
        <div className="space-y-1.5">
          <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-input bg-background px-3 py-1.5 text-sm font-medium text-foreground hover:bg-accent">
            <Paperclip className="size-4" /> Choose files
            <input type="file" multiple accept={ACCEPT} className="hidden" onChange={(e) => onPickFiles(e.target.files)} />
          </label>
          <p className="text-xs text-muted-foreground">Up to 5 files, ≤ {MAX_MB} MB each. Supported: {SUPPORTED}</p>
        </div>
      </Section>

      <Section title="URL references">
        {urlRefs.map((r, i) => (
          <div key={i} className="flex items-center gap-2">
            <Input className="w-40" placeholder="Label" value={r.label} onChange={(e) => setUrl(i, { label: e.target.value })} />
            <Input className="flex-1" placeholder="https://…" value={r.url} onChange={(e) => setUrl(i, { url: e.target.value })} />
            <Button type="button" variant="ghost" size="sm" onClick={() => removeUrl(i)}><X className="size-4" /></Button>
          </div>
        ))}
        <Button type="button" variant="outline" size="sm" onClick={addUrl}><Plus className="size-4" /> Add reference</Button>
      </Section>

      <div className="flex gap-2">
        <Button onClick={() => saveMutation.mutate()} disabled={!form.title.trim() || !form.body.trim() || saveMutation.isPending}>
          {saveMutation.isPending ? 'Saving…' : isEdit ? 'Save changes' : 'Create article'}
        </Button>
        <Button variant="outline" onClick={() => { if (!isEdit) { skipPersist.current = true; sessionStorage.removeItem(DRAFT_KEY); } navigate('/knowledge-base'); }}>Cancel</Button>
      </div>
    </div>
  );
}
