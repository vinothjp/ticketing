import type { ReactNode } from 'react';
import { ShieldCheck } from 'lucide-react';

export default function AuthCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-indigo-500 via-violet-600 to-purple-700 p-4">
      <div className="w-full max-w-md rounded-2xl bg-card p-8 shadow-2xl">
        <div className="mb-5 flex justify-center">
          <div className="flex size-14 items-center justify-center rounded-full bg-primary text-primary-foreground">
            <ShieldCheck className="size-7" />
          </div>
        </div>
        <h1 className="text-center text-2xl font-bold text-foreground">{title}</h1>
        <p className="mt-1 mb-6 text-center text-sm text-muted-foreground">{subtitle}</p>
        {children}
      </div>
    </div>
  );
}
