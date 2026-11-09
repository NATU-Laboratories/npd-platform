import "server-only";
import { AlignmentType, BorderStyle, Document, HeadingLevel, Packer, Paragraph, ShadingType, Table, TableCell, TableRow, TextRun, WidthType } from "docx";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { labSamples } from "@/db/schema";
import { describeActivity } from "@/lib/activity-describe";
import { briefSections, type Lookups } from "@/lib/brief/display";
import { replaceFile, storageDriver } from "@/lib/graph/storage";
import { CATEGORY_LABEL, FILE_TAGS, PHASES, PRIORITY_LABEL, statusLabel, TYPE_LABEL } from "@/lib/labels";
import { applicable, formatValue, SHEET_SECTIONS, type ScalarField } from "@/lib/sheet/sections";
import { getActiveUsers, getAllCatalogs, getBrands, getDepartments } from "./catalogs";
import { loadProjectDetail } from "./project-detail";
import { refTitle } from "./references";
import { loadSheet } from "./sheet";

/**
 * Documentos del proyecto en su carpeta de SharePoint, regenerados con cada movimiento:
 * - «<código> - Ficha del proyecto.docx»: brief, estado por departamento y ficha técnica.
 * - «<código> - Historial.txt»: todos los movimientos del proyecto, del más antiguo al más reciente.
 * La información confidencial (fórmulas, coste objetivo de fórmula) no se incluye.
 */

const TZ = "Europe/Madrid";
const when = (d: Date) => d.toLocaleString("es-ES", { timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
const day = (d: Date | string | null | undefined) => (d ? new Date(typeof d === "string" ? `${d.slice(0, 10)}T12:00:00` : d).toLocaleDateString("es-ES", { timeZone: TZ }) : "—");

const BRAND = "56613F";
const cellBorder = { style: BorderStyle.SINGLE, size: 4, color: "D9DED0" };
const borders = { top: cellBorder, bottom: cellBorder, left: cellBorder, right: cellBorder };

const text = (t: string, opts: { bold?: boolean; color?: string; size?: number } = {}) =>
  t.split("\n").map((line, i) => new TextRun({ text: line, bold: opts.bold, color: opts.color, size: opts.size, break: i ? 1 : undefined }));

function cell(t: string, opts: { head?: boolean; width?: number } = {}) {
  return new TableCell({
    borders,
    width: opts.width ? { size: opts.width, type: WidthType.PERCENTAGE } : undefined,
    shading: opts.head ? { type: ShadingType.CLEAR, fill: "EEF0E6", color: "auto" } : undefined,
    margins: { top: 60, bottom: 60, left: 100, right: 100 },
    children: [new Paragraph({ children: text(t || "—", { bold: opts.head, color: opts.head ? "33402A" : undefined, size: 19 }) })],
  });
}

/** Tabla de dos o más columnas: etiqueta | valor(es). */
function table(rows: string[][], header?: string[]) {
  const cols = Math.max(...rows.map((r) => r.length), header?.length ?? 0);
  const first = cols > 2 ? 28 : 34;
  const rest = (100 - first) / Math.max(cols - 1, 1);
  const mk = (r: string[], head = false) =>
    new TableRow({ children: Array.from({ length: cols }, (_, i) => cell(r[i] ?? "", { head: head || i === 0, width: i === 0 ? first : rest })) });
  return new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [...(header ? [mk(header, true)] : []), ...rows.map((r) => mk(r))] });
}

const h1 = (t: string) => new Paragraph({ heading: HeadingLevel.HEADING_1, spacing: { before: 360, after: 120 }, children: [new TextRun({ text: t, color: BRAND })] });
const h2 = (t: string) => new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 240, after: 80 }, children: [new TextRun({ text: t })] });
const para = (t: string, opts: { color?: string; size?: number } = {}) => new Paragraph({ spacing: { after: 80 }, children: text(t, opts) });

async function context(projectId: string) {
  const d = await loadProjectDetail(projectId);
  if (!d || d.p.status === "draft" || !d.p.sharepointFolderId) return null;
  const [catalogs, brands, users, depts, sheet, samples] = await Promise.all([
    getAllCatalogs(),
    getBrands(false),
    getActiveUsers(),
    getDepartments(false),
    loadSheet(d.p),
    db.select().from(labSamples).where(eq(labSamples.projectId, projectId)).orderBy(asc(labSamples.round), asc(labSamples.id)),
  ]);
  const lookups: Lookups = {
    catalog: Object.fromEntries(Object.entries(catalogs).map(([k, v]) => [k, Object.fromEntries(v.map((o) => [o.value, o.label]))])),
    brands: Object.fromEntries(brands.map((x) => [x.id, x.name])),
    users: Object.fromEntries(users.map((x) => [x.id, x.name])),
    clients: d.p.clientId && d.clientName ? { [d.p.clientId]: d.clientName } : {},
  };
  return { d, lookups, depts, sheet, samples, rejection: lookups.catalog.rejection_reason ?? {} };
}

type Ctx = NonNullable<Awaited<ReturnType<typeof context>>>;

function buildDocx({ d, lookups, sheet, samples }: Ctx) {
  const p = d.p;
  const children: (Paragraph | Table)[] = [];
  children.push(
    new Paragraph({ spacing: { after: 40 }, children: [new TextRun({ text: "NATU LABORATORIES · PROYECTOS NPD", color: BRAND, bold: true, size: 18 })] }),
    new Paragraph({ heading: HeadingLevel.TITLE, spacing: { after: 80 }, children: [new TextRun({ text: `${p.code ?? ""} · ${p.name}` })] }),
    para(`Ficha del proyecto generada automáticamente por la plataforma NPD el ${when(new Date())}. Se actualiza con cada cambio: no la edites aquí (los cambios se perderían); edítala en la plataforma.`, {
      color: "6B7280",
      size: 18,
    }),
  );

  // Datos generales
  children.push(h1("Datos generales"));
  children.push(
    table([
      ["Código", p.code ?? "—"],
      ["Situación", `${statusLabel(p.status, p.phase)} · fase ${p.phase} · ${PHASES[p.phase]?.name ?? ""}`],
      ["Tipo", p.type ? TYPE_LABEL[p.type] : "—"],
      ["Categoría", p.category ? CATEGORY_LABEL[p.category] : "—"],
      ["Cliente / marca", d.clientName ?? d.brandName ?? "—"],
      ["Solicitante", d.requesterName],
      ["Gestor de cuenta", d.accountManagerName ?? "—"],
      ["Prioridad", p.priority ? PRIORITY_LABEL[p.priority] : "—"],
      ["Fecha de solicitud", day(p.requestedAt)],
      ["Entrega requerida", day(p.neededBy)],
      ["Departamentos implicados", d.departments.map((x) => x.name).join(", ") || "—"],
      ...(sheet.refs.length >= 2 ? [["Referencias", sheet.refs.map(refTitle).join("\n")]] : []),
    ]),
  );

  // Brief
  children.push(h1("Brief de la solicitud"));
  for (const sec of briefSections(p.brief, lookups)) {
    const rows = sec.rows.filter(([, v]) => v);
    if (!rows.length) continue;
    children.push(h2(sec.title), table(rows.map(([k, v]) => [k, String(v)])));
  }

  // Estado por departamento
  children.push(h1("Estado por departamento"));
  children.push(
    table(
      sheet.cards.map((c) => {
        const state = (s: { completed: boolean; started: boolean; current: { name: string } | null; completedAt: Date | null }) =>
          s.completed ? `Completado${s.completedAt ? ` (${day(s.completedAt)})` : ""}` : s.started ? (s.current?.name ?? "—") : "Sin empezar";
        return [c.dept.name, c.perRef ? c.refs.map((r) => `${refTitle(r.ref)}: ${state(r)}`).join("\n") : state(c)];
      }),
      ["Departamento", "Estado"],
    ),
  );

  // Ficha técnica (lo que aportan los departamentos), solo apartados con datos
  children.push(h1("Ficha técnica"));
  let any = false;
  for (const s of SHEET_SECTIONS) {
    const list = sheet.entries.filter((e) => e.section.key === s.key);
    const perRef = list.filter((e) => e.refId > 0);
    const cols = perRef.length
      ? sheet.refs.map((r) => ({ title: refTitle(r), entry: perRef.find((e) => e.refId === r.id) })).filter((c) => c.entry)
      : list.filter((e) => e.refId === 0).map((entry) => ({ title: "", entry }));
    if (!cols.length) continue;
    const rows: string[][] = [];
    for (const g of s.groups) {
      const fields = applicable(g.fields, sheet.ctx).filter((f): f is ScalarField => f.type !== "files");
      for (const f of fields) {
        const values = cols.map((c) => formatValue(f, c.entry!.data[f.key]) ?? "");
        if (values.every((v) => !v)) continue;
        rows.push([`${g.title && g.title !== f.label ? `${g.title} · ` : ""}${f.label}`, ...values]);
      }
    }
    const fileTags = s.groups.flatMap((g) => g.fields).filter((f) => f.type === "files").map((f) => (f as { tag: string }).tag);
    const sectionFiles = d.files.filter(({ f }) => fileTags.includes(f.tag ?? ""));
    if (sectionFiles.length) rows.push(["Archivos", ...cols.map((_, i) => (i === 0 ? sectionFiles.map(({ f }) => f.name).join("\n") : ""))]);
    if (!rows.length) continue;
    any = true;
    const dept = cols[0]!.entry!.dept;
    children.push(h2(`${s.title} · ${dept.name}`));
    children.push(table(rows, cols.length > 1 ? ["Campo", ...cols.map((c) => c.title)] : undefined));
  }
  if (!any) children.push(para("Los departamentos todavía no han añadido datos.", { color: "6B7280" }));

  // Muestras de Laboratorio (sin fórmula: es confidencial)
  if (samples.length) {
    const status: Record<string, string> = { evaluation: "En evaluación", approved: "Aprobada", not_approved: "No aprobada" };
    children.push(h1("Muestras de Laboratorio"));
    children.push(
      table(
        samples.map((x) => [x.code, `Ronda ${x.round}`, status[x.status] ?? x.status]),
        ["Cód. referencia", "Ronda", "Estado"],
      ),
    );
  }

  // Archivos del proyecto
  if (d.files.length) {
    children.push(h1("Archivos"));
    children.push(
      table(
        d.files.map(({ f, by }) => [f.name, `${FILE_TAGS[f.tag as keyof typeof FILE_TAGS] ?? f.tag ?? "—"} · fase ${f.phase} · ${by} · ${day(f.createdAt)}`]),
        ["Archivo", "Detalle"],
      ),
    );
  }

  children.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 400 }, children: [new TextRun({ text: "Historial completo en el archivo «Historial» de esta carpeta.", color: "6B7280", size: 16 })] }));

  return new Document({
    creator: "Plataforma NPD · NATU Laboratories",
    title: `Ficha del proyecto ${p.code ?? ""}`,
    styles: { default: { document: { run: { font: "Calibri", size: 21 } } } },
    sections: [{ properties: { page: { margin: { top: 1000, bottom: 1000, left: 1000, right: 1000 } } }, children }],
  });
}

function buildHistory({ d, depts, rejection }: Ctx) {
  const p = d.p;
  const lines = [
    `HISTORIAL DEL PROYECTO ${p.code ?? ""} · ${p.name}`,
    `Generado por la plataforma NPD el ${when(new Date())}. Se actualiza con cada movimiento.`,
    "".padEnd(80, "="),
    "",
  ];
  const deptList = depts.map((x) => ({ id: x.id, name: x.name }));
  for (const { a, actor } of [...d.activity].reverse()) {
    const t = describeActivity(a, { departments: deptList, rejectionReasons: rejection });
    lines.push(`${when(a.createdAt)} · ${actor ?? "Sistema"} ${t.text}`);
    if (t.detail?.trim()) for (const l of t.detail.trim().split("\n")) lines.push(`    ${l}`);
    for (const c of t.changes ?? []) lines.push(`    ${c.field}: ${c.from || "—"} → ${c.to || "—"}`);
  }
  if (!d.activity.length) lines.push("Todavía no hay movimientos.");
  // Bloc de notas de Windows: saltos de línea CRLF y BOM para que se vean bien las tildes
  return Buffer.from("﻿" + lines.join("\r\n") + "\r\n", "utf8");
}

/** Regenera la ficha (Word) y el historial en la carpeta del proyecto. */
export async function writeProjectDocs(projectId: string) {
  const ctx = await context(projectId);
  if (!ctx) return;
  // Proyecto aún en el almacenamiento provisional (pendiente de pasar a SharePoint): nada que escribir
  if (storageDriver() === "sharepoint" && /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(ctx.d.p.sharepointFolderId!)) return;
  const code = ctx.d.p.code ?? "Proyecto";
  const folder = ctx.d.p.sharepointFolderId!;
  const docx = await Packer.toBuffer(buildDocx(ctx));
  await replaceFile(folder, `${code} - Ficha del proyecto.docx`, docx, "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  await replaceFile(folder, `${code} - Historial.txt`, buildHistory(ctx), "text/plain; charset=utf-8");
}
