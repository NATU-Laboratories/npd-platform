"use client";
import * as D from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import * as React from "react";
import { cn } from "@/lib/utils";

export const Dialog = D.Root;
export const DialogTrigger = D.Trigger;
export const DialogClose = D.Close;

export function DialogContent({
  title,
  description,
  className,
  children,
  wide,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <D.Portal>
      <D.Overlay className="fixed inset-0 z-40 bg-slate-900/40 backdrop-blur-[1px]" />
      <D.Content
        className={cn(
          "fixed inset-x-0 bottom-0 z-50 max-h-[92dvh] overflow-y-auto rounded-t-2xl bg-white shadow-xl focus:outline-none sm:inset-auto sm:left-1/2 sm:top-1/2 sm:w-full sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-xl",
          wide ? "sm:max-w-3xl" : "sm:max-w-lg",
          className,
        )}
      >
        <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-slate-100 bg-white px-5 py-4">
          <div>
            <D.Title className="text-base font-semibold text-slate-900">{title}</D.Title>
            {description ? (
              <D.Description className="mt-0.5 text-sm text-slate-500">{description}</D.Description>
            ) : (
              <D.Description className="sr-only">{typeof title === "string" ? title : "Diálogo"}</D.Description>
            )}
          </div>
          <D.Close className="rounded-md p-1 text-slate-500 hover:bg-slate-100" aria-label="Cerrar">
            <X className="size-5" />
          </D.Close>
        </div>
        <div className="px-5 py-4">{children}</div>
      </D.Content>
    </D.Portal>
  );
}
