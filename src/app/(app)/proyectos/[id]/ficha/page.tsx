import { ExternalLink, FileText } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PrintButton } from "@/components/print-button";
import { LabSamples } from "@/components/sheet/lab-box";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { briefSections, type Lookups } from "@/lib/brief/display";
import { FILE_TAGS, PHASES, statusLabel } from "@/lib/labels";
import { canViewProject, requireUser } from "@/lib/server/authz";
import { getActiveUsers, getAllCatalogs, getBrands } from "@/lib/server/catalogs";
import { loadProjectDetail } from "@/lib/server/project-detail";
import { canSeeLabFormula, listSamples } from "@/lib/server/lab";
import { loadSheet, type SheetEntry } from "@/lib/server/sheet";
import { applicable, formatValue, SHEET_SECTIONS, type ScalarField, type SheetCtx } from "@/lib/sheet/sections";
import { cn, formatDate } from "@/lib/utils";

export const metadata = { title: "Ficha completa del proyecto" };

const refTitle = (r: { label: string; name: string }) => (r.name && r.name !== `Referencia ${r.label}` ? `${r.label} · ${r.name}` : `Referencia ${r.label}`);

/** Valor legible; los enlaces se muestran como enlace. */
function Value({ f, v }: { f: ScalarField; v: unknown }) {
  const text = formatValue(f, v);
  if (!text) return <span className="text-slate-300">—</span>;
  if (f.type === "url")
    return (
      <a href={text} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-medium text-brand-600 underline underline-offset-2">
        <ExternalLink className="size-3.5" aria-hidden /> {/sharepoint\.com/i.test(text) ? "Abrir en SharePoint" : /onedrive|1drv\.ms/i.test(text) ? "Abrir en OneDrive" : "Abrir enlace"}
      </a>
    );
  return <span className="whitespace-pre-line break-words">{text}</span>;
}

/** Campos de un apartado con algún dato en alguna de las columnas (común o referencias). */
function fieldsWithData(entries: SheetEntry[], ctx: SheetCtx) {
  const section = entries[0]!.section;
  return section.groups.map((g) => ({
    title: g.title ?? "",
    fields: applicable(g.fields, ctx).filter((f): f is ScalarField => f.type !== "files" && entries.some((e) => formatValue(f as ScalarField, e.data[f.key]) != null)),
  }));
}

/**
 * Ficha completa: todo lo que han ido aportando los departamentos en una sola página
 * (brief, envase, naming y códigos, requisitos legales, etiqueta, compras, producción…).
 */
export default async function FullSheetPage({ params }: PageProps<"/proyectos/[id]/ficha">) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const u = await requireUser();
  if (!(await canViewProject(u, id))) notFound();
  const d = await loadProjectDetail(id);
  if (!d || d.p.status === "draft") notFound();
  const p = d.p;
  const [catalogs, brands, users, sheet, samples] = await Promise.all([getAllCatalogs(), getBrands(false), getActiveUsers(), loadSheet(p), listSamples(u, id)]);
  const lookups: Lookups = {
    catalog: Object.fromEntries(Object.entries(catalogs).map(([k, v]) => [k, Object.fromEntries(v.map((o) => [o.value, o.label]))])),
    brands: Object.fromEntries(brands.map((x) => [x.id, x.name])),
    users: Object.fromEntries(users.map((x) => [x.id, x.name])),
    clients: p.clientId && d.clientName ? { [p.clientId]: d.clientName } : {},
  };
  const multi = sheet.refs.length >= 2;
  const filesByTag = new Map<string, typeof d.files>();
  for (const f of d.files) filesByTag.set(f.f.tag ?? "otro", [...(filesByTag.get(f.f.tag ?? "otro") ?? []), f]);

  // Apartados en el orden del proceso, solo los que tienen algún dato
  const sections = SHEET_SECTIONS.map((s) => {
    const list = sheet.entries.filter((e) => e.section.key === s.key);
    const common = list.find((e) => e.refId === 0);
    const perRef = list.filter((e) => e.refId > 0);
    const cols: { title: string; entry: SheetEntry }[] = perRef.length
      ? sheet.refs.map((r) => ({ title: refTitle(r), entry: perRef.find((e) => e.refId === r.id) })).filter((c): c is { title: string; entry: SheetEntry } => !!c.entry)
      : common
        ? [{ title: "", entry: common }]
        : [];
    if (!cols.length) return null;
    const groups = fieldsWithData(
      cols.map((c) => c.entry),
      sheet.ctx,
    ).filter((g) => g.fields.length);
    const fileTags = s.groups.flatMap((g) => g.fields).filter((f) => f.type === "files").map((f) => (f as { tag: string }).tag);
    const files = fileTags.flatMap((t) => filesByTag.get(t) ?? []);
    if (!groups.length && !files.length) return null;
    const card = sheet.cards.find((c) => c.dept.key === cols[0]!.entry.dept.key);
    return { s, cols, groups, files, dept: cols[0]!.entry.dept, done: card?.completed ?? false, updatedAt: cols.map((c) => c.entry.updatedAt).filter(Boolean).sort().at(-1) ?? null };
  }).filter((x): x is NonNullable<typeof x> => !!x);

  return (
    <div className="flex flex-col gap-5 print:gap-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href={`/proyectos/${p.id}`} className="mb-2 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-900 print:hidden">
            ← Volver al proyecto
          </Link>
          <p className="font-mono text-sm text-slate-500">{p.code}</p>
          <h1 className="text-2xl font-semibold text-slate-900">Ficha completa · {p.name}</h1>
          <p className="mt-0.5 text-sm text-slate-500">
            {statusLabel(p.status, p.phase)} · fase {p.phase} · {PHASES[p.phase]?.name} · todo lo que han aportado los departamentos, en una sola página.
          </p>
        </div>
        <PrintButton />
      </div>

      {sections.length > 0 && (
        <nav aria-label="Índice" className="flex flex-wrap gap-1.5 print:hidden">
          <a href="#brief" className="rounded-full bg-white px-3 py-1 text-xs text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50">
            Brief
          </a>
          {sections.map(({ s, dept }) => (
            <a key={s.key} href={`#s-${s.key}`} className="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1 text-xs text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50">
              <span className="size-2 rounded-full" style={{ background: dept.color }} aria-hidden />
              {s.title}
            </a>
          ))}
        </nav>
      )}

      <Card id="brief" className="scroll-mt-20 break-inside-avoid">
        <CardHeader title="Brief de la solicitud" description={`Solicitado por ${d.requesterName} el ${formatDate(p.requestedAt)}`} />
        <CardBody className="grid gap-5 lg:grid-cols-2">
          {briefSections(p.brief, lookups).map((sec) => (
            <div key={sec.title}>
              <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">{sec.title}</h3>
              <dl className="grid grid-cols-[minmax(8rem,auto)_1fr] gap-x-4 gap-y-1 text-sm">
                {sec.rows.map(([k, v]) => (
                  <div key={k} className="contents">
                    <dt className="text-slate-500">{k}</dt>
                    <dd className={cn("whitespace-pre-line break-words", v ? "text-slate-900" : "text-slate-300")}>{v || "—"}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}
        </CardBody>
      </Card>

      {samples.length > 0 && (
        <div id="muestras" className="scroll-mt-20 break-inside-avoid">
          <LabSamples samples={samples} canSeeFormula={canSeeLabFormula(u)} {...(multi ? { refNames: Object.fromEntries(sheet.refs.map((r) => [r.id, refTitle(r)])) } : {})} />
        </div>
      )}

      {!sections.length && <p className="text-sm text-slate-500">Los departamentos todavía no han añadido datos a la ficha técnica.</p>}

      {sections.map(({ s, cols, groups, files, dept, done, updatedAt }) => (
        <Card key={s.key} id={`s-${s.key}`} className="scroll-mt-20 break-inside-avoid">
          <CardHeader
            title={
              <span className="flex items-center gap-2">
                <span className="size-2.5 rounded-full" style={{ background: dept.color }} aria-hidden />
                {s.title}
              </span>
            }
            description={`${dept.name}${done ? " · completado" : ""}${updatedAt ? ` · actualizado el ${formatDate(updatedAt)}` : ""}`}
          />
          <CardBody className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              {multi && cols.length > 1 && (
                <thead>
                  <tr className="text-xs text-slate-500">
                    <th className="w-1/4 py-1.5 pr-4 font-medium" />
                    {cols.map((c) => (
                      <th key={c.title} className="py-1.5 pr-4 font-semibold text-slate-800">
                        {c.title}
                      </th>
                    ))}
                  </tr>
                </thead>
              )}
              {groups.map((g) => (
                <tbody key={g.title} className="border-t border-slate-100 first:border-t-0">
                  {g.title && (
                    <tr>
                      <th colSpan={cols.length + 1} className="pb-1 pt-3 text-xs font-semibold uppercase tracking-wide text-slate-400">
                        {g.title}
                      </th>
                    </tr>
                  )}
                  {g.fields.map((f) => (
                    <tr key={f.key} className="align-top">
                      <th scope="row" className="w-1/4 py-1 pr-4 font-normal text-slate-500">
                        {f.label}
                      </th>
                      {cols.map((c) => (
                        <td key={c.title} className="py-1 pr-4 text-slate-900">
                          <Value f={f} v={c.entry.data[f.key]} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              ))}
            </table>
            {files.length > 0 && (
              <div className="mt-3 border-t border-slate-100 pt-3">
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">Archivos</p>
                <ul className="flex flex-wrap gap-2">
                  {files.map(({ f }) => (
                    <li key={f.id}>
                      <a href={`/api/files/${f.id}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-md bg-slate-50 px-2 py-1 text-xs text-slate-700 ring-1 ring-slate-200 hover:bg-white">
                        <FileText className="size-3.5" aria-hidden /> {f.name}
                        <span className="text-slate-400">· {FILE_TAGS[f.tag as keyof typeof FILE_TAGS] ?? f.tag}</span>
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </CardBody>
        </Card>
      ))}
    </div>
  );
}
