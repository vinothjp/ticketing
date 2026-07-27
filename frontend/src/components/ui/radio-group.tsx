import * as React from 'react';
import { cn } from '@/lib/utils';

interface RadioGroupContextValue {
  value?: string;
  onValueChange?: (value: string) => void;
  disabled?: boolean;
}

const RadioGroupContext = React.createContext<RadioGroupContextValue | null>(null);

function RadioGroup({
  value,
  onValueChange,
  disabled,
  className,
  children,
}: {
  value?: string;
  onValueChange?: (value: string) => void;
  disabled?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <RadioGroupContext.Provider value={{ value, onValueChange, disabled }}>
      <div role="radiogroup" className={cn('grid gap-2', className)}>
        {children}
      </div>
    </RadioGroupContext.Provider>
  );
}

function RadioGroupItem({ value, id }: { value: string; id?: string }) {
  const ctx = React.useContext(RadioGroupContext);
  const checked = ctx?.value === value;
  return (
    <button
      type="button"
      role="radio"
      id={id}
      aria-checked={checked}
      disabled={ctx?.disabled}
      onClick={() => ctx?.onValueChange?.(value)}
      className={cn(
        'flex size-4 shrink-0 items-center justify-center rounded-full border border-input shadow-xs outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50',
        checked && 'border-primary',
      )}
    >
      {checked && <span className="size-2 rounded-full bg-primary" />}
    </button>
  );
}

export { RadioGroup, RadioGroupItem };
