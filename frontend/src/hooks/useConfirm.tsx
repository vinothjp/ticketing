import { useCallback, useState } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

// In-app replacements for the browser's confirm()/prompt() ("localhost says …")
// popups. Each hook returns an async trigger plus a dialog node to render.

type ConfirmOpts = {
  title?: string;
  description?: string;
  confirmText?: string;
  cancelText?: string;
  destructive?: boolean;
};

/**
 * useConfirm — replaces `window.confirm`.
 * `const { confirm, ConfirmDialog } = useConfirm();`
 * `if (await confirm({ title: 'Delete task?', destructive: true })) …`
 * Render `{ConfirmDialog}` once anywhere in the component.
 */
export function useConfirm() {
  const [state, setState] = useState<{ open: boolean; opts: ConfirmOpts; resolve?: (v: boolean) => void }>({
    open: false, opts: {},
  });

  const confirm = useCallback(
    (opts: ConfirmOpts = {}) => new Promise<boolean>((resolve) => setState({ open: true, opts, resolve })),
    [],
  );

  const settle = (value: boolean) => setState((s) => { s.resolve?.(value); return { ...s, open: false }; });

  const ConfirmDialog = (
    <Dialog open={state.open} onOpenChange={(o) => { if (!o) settle(false); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{state.opts.title ?? 'Are you sure?'}</DialogTitle>
          {state.opts.description && <DialogDescription>{state.opts.description}</DialogDescription>}
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => settle(false)}>{state.opts.cancelText ?? 'Cancel'}</Button>
          <Button variant={state.opts.destructive ? 'destructive' : 'default'} onClick={() => settle(true)}>
            {state.opts.confirmText ?? 'Confirm'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  return { confirm, ConfirmDialog };
}

type PromptOpts = {
  title?: string;
  description?: string;
  label?: string;
  placeholder?: string;
  defaultValue?: string;
  confirmText?: string;
  required?: boolean;
};

/**
 * usePrompt — replaces `window.prompt`. Resolves with the entered string, or
 * `null` if cancelled. Render `{PromptDialog}` once in the component.
 */
export function usePrompt() {
  const [state, setState] = useState<{ open: boolean; opts: PromptOpts; value: string; resolve?: (v: string | null) => void }>({
    open: false, opts: {}, value: '',
  });

  const prompt = useCallback(
    (opts: PromptOpts = {}) => new Promise<string | null>((resolve) =>
      setState({ open: true, opts, value: opts.defaultValue ?? '', resolve })),
    [],
  );

  const settle = (value: string | null) => setState((s) => { s.resolve?.(value); return { ...s, open: false }; });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (state.opts.required && !state.value.trim()) return;
    settle(state.value);
  };

  const PromptDialog = (
    <Dialog open={state.open} onOpenChange={(o) => { if (!o) settle(null); }}>
      <DialogContent className="max-w-sm">
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{state.opts.title ?? 'Enter a value'}</DialogTitle>
            {state.opts.description && <DialogDescription>{state.opts.description}</DialogDescription>}
          </DialogHeader>
          {state.opts.label && <label className="text-sm font-medium">{state.opts.label}</label>}
          <Input
            autoFocus
            placeholder={state.opts.placeholder}
            value={state.value}
            onChange={(e) => setState((s) => ({ ...s, value: e.target.value }))}
          />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => settle(null)}>Cancel</Button>
            <Button type="submit">{state.opts.confirmText ?? 'OK'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );

  return { prompt, PromptDialog };
}
