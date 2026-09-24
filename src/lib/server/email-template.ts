import "server-only";
import { appUrl, escapeHtml, formatDate } from "@/lib/utils";

export type ProjectSummary = {
  id: string;
  code: string | null;
  name: string;
  typeLabel: string;
  categoryLabel: string;
  clientOrBrand: string | null;
  requesterName: string;
  neededBy: string | null;
  priorityLabel: string | null;
  statusLabel: string;
};

const BRAND = "#3e3f3e";

/** Plantilla HTML de email con marca NATU (§6). Tablas + estilos en línea para Outlook. */
export function renderEmail(opts: {
  title: string;
  intro: string;
  project?: ProjectSummary;
  message?: { label: string; body: string } | null;
  extraRows?: [string, string][];
  ctaPath?: string;
  ctaLabel?: string;
}) {
  const rows: [string, string][] = [];
  if (opts.project) {
    const p = opts.project;
    rows.push(
      ["Código", p.code ?? "—"],
      ["Proyecto", p.name],
      ["Tipo", p.typeLabel],
      ["Categoría", p.categoryLabel],
      ...(p.clientOrBrand ? ([["Cliente / marca", p.clientOrBrand]] as [string, string][]) : []),
      ["Solicitante", p.requesterName],
      ["Fecha de entrega requerida", formatDate(p.neededBy)],
      ...(p.priorityLabel ? ([["Prioridad", p.priorityLabel]] as [string, string][]) : []),
      ["Estado", p.statusLabel],
    );
  }
  rows.push(...(opts.extraRows ?? []));
  const url = appUrl(opts.ctaPath ?? (opts.project ? `/proyectos/${opts.project.id}` : "/"));

  const table = rows.length
    ? `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;margin:16px 0;font-size:14px">
${rows
  .map(
    ([k, v]) =>
      `<tr><td style="padding:6px 12px 6px 0;color:#64748b;white-space:nowrap;vertical-align:top;border-bottom:1px solid #eef2f2">${escapeHtml(k)}</td><td style="padding:6px 0;color:#0f172a;border-bottom:1px solid #eef2f2;white-space:pre-line">${escapeHtml(v)}</td></tr>`,
  )
  .join("\n")}
</table>`
    : "";

  const message = opts.message
    ? `<div style="margin:16px 0;padding:12px 16px;background:#f6faf9;border-left:3px solid ${BRAND};font-size:14px;color:#0f172a">
<div style="font-size:12px;color:#64748b;margin-bottom:4px">${escapeHtml(opts.message.label)}</div>
${escapeHtml(opts.message.body).replace(/\n/g, "<br>")}</div>`
    : "";

  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(opts.title)}</title></head>
<body style="margin:0;padding:0;background:#f1f5f4;font-family:Segoe UI,Helvetica,Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f4;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:8px;overflow:hidden">
<tr><td style="background:${BRAND};padding:18px 24px;color:#ffffff">
<div style="font-size:18px;font-weight:700;letter-spacing:.08em">NATU</div>
<div style="font-size:12px;opacity:.85">Laboratories · Nuevos desarrollos</div></td></tr>
<tr><td style="padding:24px">
<h1 style="margin:0 0 8px;font-size:20px;color:#0f172a">${escapeHtml(opts.title)}</h1>
<p style="margin:0;font-size:14px;line-height:1.5;color:#334155">${escapeHtml(opts.intro)}</p>
${message}${table}
<table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:8px"><tr><td style="border-radius:6px;background:${BRAND}">
<a href="${escapeHtml(url)}" style="display:inline-block;padding:10px 20px;color:#ffffff;text-decoration:none;font-weight:600;font-size:14px">${escapeHtml(opts.ctaLabel ?? "Ver en la plataforma")}</a>
</td></tr></table>
</td></tr>
<tr><td style="padding:16px 24px;background:#f8fafc;color:#94a3b8;font-size:11px">Mensaje automático de la plataforma NPD de Laboratorios NatuAromatic S.L. No respondas a este correo.</td></tr>
</table></td></tr></table></body></html>`;
}
