import * as React from "react";
import { cn } from "@/lib/utils";

const control =
  "w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm placeholder:text-slate-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20 disabled:bg-slate-50 disabled:text-slate-500 aria-invalid:border-rose-400";

export function Input({ className, ...props }: React.ComponentProps<"input">) {
  return <input className={cn(control, "h-9 py-0", className)} {...props} />;
}

export function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return <textarea className={cn(control, "min-h-20", className)} {...props} />;
}

export function Select({ className, children, ...props }: React.ComponentProps<"select">) {
  return (
    <select className={cn(control, "h-9 py-0 pr-8", className)} {...props}>
      {children}
    </select>
  );
}

export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn("text-sm font-medium text-slate-700", className)} {...props} />;
}

export function Field({
  label,
  htmlFor,
  required,
  recommended,
  error,
  hint,
  highlight,
  className,
  children,
}: {
  label: React.ReactNode;
  htmlFor?: string;
  required?: boolean;
  recommended?: boolean;
  error?: string;
  hint?: React.ReactNode;
  highlight?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("flex flex-col gap-1.5", highlight && "field-highlight p-2", className)}>
      <Label htmlFor={htmlFor} className="flex items-center gap-1.5">
        {label}
        {required && <span className="text-rose-600" aria-label="obligatorio">*</span>}
        {recommended && <span className="rounded bg-sky-50 px-1.5 text-[10px] font-medium uppercase tracking-wide text-sky-700">recomendado</span>}
      </Label>
      {children}
      {hint && !error && <p className="text-xs text-slate-500">{hint}</p>}
      {error && <p className="text-xs text-rose-600">{error}</p>}
    </div>
  );
}

export function Checkbox({ label, className, ...props }: React.InputHTMLAttributes<HTMLInputElement> & { label: React.ReactNode }) {
  return (
    <label className={cn("inline-flex cursor-pointer items-center gap-2 text-sm text-slate-700", className)}>
      <input type="checkbox" className="size-4 rounded border-slate-300 accent-brand-600" {...props} />
      {label}
    </label>
  );
}
