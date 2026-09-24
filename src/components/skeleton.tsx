import { cn } from "@/lib/utils";

export function Bone({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-md bg-slate-200/70", className)} />;
}

/** Esqueleto genérico mientras carga una página del área privada. */
export function PageSkeleton({ variant = "dashboard" }: { variant?: "dashboard" | "project" }) {
  return (
    <div className="flex flex-col gap-6" aria-busy aria-label="Cargando…">
      <div className="flex flex-col gap-2">
        <Bone className="h-6 w-64" />
        <Bone className="h-4 w-96 max-w-full" />
      </div>
      {variant === "dashboard" ? (
        <>
          <div className="grid gap-3 lg:grid-cols-12">
            <Bone className="h-40 lg:col-span-6" />
            <Bone className="h-40 lg:col-span-2" />
            <Bone className="h-40 lg:col-span-4" />
          </div>
          <div className="grid gap-4 lg:grid-cols-3">
            <Bone className="h-72 lg:col-span-2" />
            <Bone className="h-72" />
          </div>
          <Bone className="h-96" />
        </>
      ) : (
        <>
          <div className="flex gap-2">
            <Bone className="h-9 w-48" />
            <Bone className="h-9 w-28" />
            <Bone className="h-9 w-28" />
          </div>
          <Bone className="h-36" />
          <div className="grid gap-4 lg:grid-cols-3">
            <Bone className="h-[28rem] lg:col-span-2" />
            <Bone className="h-[28rem]" />
          </div>
        </>
      )}
    </div>
  );
}
