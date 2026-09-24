/** Pirámide olfativa dibujada: salida (arriba) · corazón · fondo (base). */
export function OlfactoryPyramid({ top = [], heart = [], base = [] }: { top?: string[]; heart?: string[]; base?: string[] }) {
  const tiers = [
    { label: "Salida", notes: top, fill: "#f7e6db", stroke: "#e4bca5", text: "#6b4331" },
    { label: "Corazón", notes: heart, fill: "#f3d4ce", stroke: "#e2a29a", text: "#6e3a31" },
    { label: "Fondo", notes: base, fill: "#e4e1dc", stroke: "#a6a19a", text: "#3e3f3e" },
  ];
  // Triángulo 300×240 dividido en tres franjas de 80px
  const W = 300;
  const H = 240;
  const x = (y: number) => (W / 2) * (y / H); // semiancho a la altura y
  return (
    <figure className="flex flex-col items-center gap-2">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full max-w-xs" role="img" aria-label={`Pirámide olfativa. Salida: ${top.join(", ") || "—"}. Corazón: ${heart.join(", ") || "—"}. Fondo: ${base.join(", ") || "—"}.`}>
        {tiers.map((t, i) => {
          const y0 = i * 80;
          const y1 = y0 + 80;
          const pts = i === 0 ? `${W / 2},0 ${W / 2 + x(y1)},${y1} ${W / 2 - x(y1)},${y1}` : `${W / 2 - x(y0)},${y0} ${W / 2 + x(y0)},${y0} ${W / 2 + x(y1)},${y1} ${W / 2 - x(y1)},${y1}`;
          const lines = t.notes.length ? chunk(t.notes, i === 0 ? 1 : i === 1 ? 2 : 3).slice(0, 3) : [["—"]];
          const cy = i === 0 ? 58 : y0 + 44;
          return (
            <g key={t.label}>
              <polygon points={pts} fill={t.fill} stroke="#fff" strokeWidth={3} />
              {lines.map((l, j) => (
                <text key={j} x={W / 2} y={cy + (j - (lines.length - 1) / 2) * 13} textAnchor="middle" fontSize={i === 0 ? 10 : 11} fill={t.text}>
                  {l.join(" · ")}
                </text>
              ))}
            </g>
          );
        })}
      </svg>
      <figcaption className="flex gap-3 text-xs text-slate-500">
        {tiers.map((t) => (
          <span key={t.label} className="flex items-center gap-1">
            <span className="size-2.5 rounded-sm" style={{ background: t.fill, outline: `1px solid ${t.stroke}` }} /> {t.label}
          </span>
        ))}
      </figcaption>
    </figure>
  );
}

function chunk<T>(xs: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}
