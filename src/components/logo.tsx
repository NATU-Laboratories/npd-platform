export function Logo({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-baseline gap-2 ${className}`}>
      <span className="text-lg font-bold tracking-[0.18em]">NATU</span>
      <span className="text-xs font-medium uppercase tracking-wider opacity-80">Proyectos NPD</span>
    </span>
  );
}
