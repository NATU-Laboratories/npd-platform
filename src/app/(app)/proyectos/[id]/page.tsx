import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, ExternalLink, FileText, FolderOpen, Pencil } from "lucide-react";
import { ActivityTimeline, type ActivityItem } from "@/components/project/activity-timeline";
import { CommentComposer } from "@/components/project/comment-composer";
import { GateDialog } from "@/components/project/gate-dialog";
import { ProjectAction } from "@/components/project/project-actions";
import { AdvanceDialog, BudgetDialog, PrepaymentReceivedDialog, QuoteDialog } from "@/components/project/phase-dialogs";
import { NeededBySignal } from "@/components/needed-by";
import { SheetPanel, SheetSummary } from "@/components/sheet/sheet-panel";
import { Uploader } from "@/components/uploader";
import { Badge, DeptChip, StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { briefSections, formatFormat, type Lookups } from "@/lib/brief/display";
import { applicableFields, FIELD_BY_KEY, isFieldFilled } from "@/lib/brief/fields";
import { needsOlfactory } from "@/lib/brief/schema";
import {
  ACTION_LABEL,
  CATEGORY_LABEL,
  FILE_TAGS,
  LAST_PHASE,
  PHASE_FOLDERS,
  PHASES,
  PREPAYMENT_TYPES,
  STAGES,
  PRIORITY_COLOR,
  PRIORITY_LABEL,
  TYPE_LABEL,
} from "@/lib/labels";
import { GENDER_LABEL } from "@/lib/brief/display";
import { canDecideGate, canEditBrief, canManageProject, canSendQuote, canViewProject, requireUser } from "@/lib/server/authz";
import { getActiveUsers, getAllCatalogs, getBrands, getDepartments } from "@/lib/server/catalogs";
import { loadProjectDetail, templatesWithDepartments, templateScore } from "@/lib/server/project-detail";
import { getSettings } from "@/lib/server/settings";
import { canEditSection, loadSheet, pendingUpTo } from "@/lib/server/sheet";
import { canTransition } from "@/lib/server/state-machine";
import { cn, formatBytes, formatDate, formatEuro, formatNumber } from "@/lib/utils";

export const metadata = { title: "Proyecto" };

function fmt(v: unknown): string {
  if (v == null || v === "") return "";
  if (Array.isArray(v)) return v.map(fmt).join(", ");
  if (typeof v === "object")
    return Object.values(v as object)
      .filter(Boolean)
      .map(fmt)
      .join(" / ");
  if (typeof v === "boolean") return v ? "Sí" : "No";
  return String(v);
}

function fieldLabel(path: string) {
  const direct = FIELD_BY_KEY[path];
  if (direct) return direct.label;
  const parts = path.split(".");
  for (let i = parts.length - 1; i > 0; i--) {
    const f = FIELD_BY_KEY[parts.slice(0, i).join(".")];
    if (f) return `${f.label} (${parts.slice(i).join(".")})`;
  }
  return path;
}

export default async function ProjectPage({ params }: PageProps<"/proyectos/[id]">) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const u = await requireUser();
  if (!(await canViewProject(u, id))) notFound();
  const d = await loadProjectDetail(id);
  if (!d || d.p.status === "draft") notFound();
  const p = d.p;
  const b = p.brief;

  const [settings, catalogs, brands, users, departments, templates, sheet] = await Promise.all([
    getSettings(),
    getAllCatalogs(),
    getBrands(false),
    getActiveUsers(),
    getDepartments(),
    templatesWithDepartments(),
    loadSheet(p),
  ]);
  const showSheet = p.phase >= 1 || p.status === "in_production";
  const sheetPending = pendingUpTo(sheet.entries, p.phase).map((e) => `${e.title} (${e.dept.name})`);
  const lookups: Lookups = {
    catalog: Object.fromEntries(Object.entries(catalogs).map(([k, v]) => [k, Object.fromEntries(v.map((o) => [o.value, o.label]))])),
    brands: Object.fromEntries(brands.map((x) => [x.id, x.name])),
    users: Object.fromEntries(users.map((x) => [x.id, x.name])),
    clients: p.clientId && d.clientName ? { [p.clientId]: d.clientName } : {},
  };
  const c = lookups.catalog;

  const canDecide = canDecideGate(u, p, "G1") && canTransition(p.status, "approve", p.phase);
  const canQuote = canSendQuote(u, p) && canTransition(p.status, "send_quote", p.phase);
  const canBudget = canDecideGate(u, p, "G2") && canTransition(p.status, "budget_decision", p.phase);
  const canAdvance = canManageProject(u, p) && canTransition(p.status, "advance", p.phase);
  const needsPrepayment = PREPAYMENT_TYPES.includes(p.type ?? "");
  const pp = p.prepayment;
  const canEdit = canEditBrief(u, p);
  const canManage = canManageProject(u, p);
  const openIr = d.infoRequests.find((r) => !r.ir.answeredAt);
  const isRequester = p.requesterId === u.id || p.accountManagerId === u.id;
  const rejectedGate = d.gates.find((g) => g.g.status === "rejected");

  // Fecha de entrada en cada fase (a partir del historial)
  const entered: Record<number, Date> = {};
  if (p.requestedAt) entered[0] = p.requestedAt;
  for (const { a } of [...d.activity].reverse()) {
    const diff = (a.diff ?? {}) as Record<string, unknown>;
    const to =
      a.action === "gate.approved" && diff.gate === "G1"
        ? 1
        : a.action === "quote.sent"
          ? 2
          : a.action === "gate.approved" && diff.gate === "G2"
            ? 3
            : a.action === "gate.recycled"
              ? 1
              : a.action === "phase.advanced"
                ? Number(diff.to)
                : null;
    if (to != null && Number.isFinite(to)) entered[to] = a.createdAt;
  }

  const activity: ActivityItem[] = d.activity.map(({ a, actor }) => {
    const diff = (a.diff ?? {}) as Record<string, unknown>;
    const base = {
      id: a.id,
      actor: actor ?? "Sistema",
      at: a.createdAt.toISOString(),
    };
    switch (a.action) {
      case "comment.created":
        return {
          ...base,
          group: "comentarios",
          text: "comentó",
          detail: String(diff.body ?? ""),
        };
      case "gate.approved": {
        if (diff.gate === "G2") {
          const ppd = diff.prepayment as { status?: string; responsible?: string; note?: string } | null | undefined;
          const ppText =
            ppd?.status === "received"
              ? "Anticipo del 30 % recibido."
              : ppd?.status === "waived"
                ? `Inicio SIN anticipo bajo la responsabilidad de ${ppd.responsible}.`
                : null;
          return {
            ...base,
            group: "decisiones",
            text: "registró la aprobación del presupuesto por el cliente (G2)",
            detail: [ppText, ppd?.note, diff.comment as string].filter(Boolean).join("\n") || null,
          };
        }
        const names = (diff.departmentIds as number[] | undefined)?.map((x) => departments.find((dd) => dd.id === x)?.name).filter(Boolean);
        return {
          ...base,
          group: "decisiones",
          text: `aprobó la solicitud (G1) · departamentos: ${names?.join(", ") ?? "—"}`,
          detail: (diff.comment as string) || null,
        };
      }
      case "gate.recycled":
        return {
          ...base,
          group: "decisiones",
          text: "registró que el cliente pide cambios · vuelve a Cotización",
          detail: (diff.reason as string) || null,
        };
      case "quote.sent":
        return {
          ...base,
          group: "decisiones",
          text: `envió la cotización al cliente${diff.amount != null ? ` (${Number(diff.amount).toLocaleString("es-ES", { style: "currency", currency: "EUR" })})` : ""}`,
          detail: (diff.comment as string) || null,
        };
      case "phase.advanced":
        return {
          ...base,
          group: "decisiones",
          text: `avanzó a la fase «${PHASES[Number(diff.to)]?.name ?? diff.to}»`,
          detail: (diff.comment as string) || null,
        };
      case "project.in_production":
        return {
          ...base,
          group: "decisiones",
          text: "pasó el proyecto a producción",
          detail: (diff.comment as string) || null,
        };
      case "prepayment.received":
        return {
          ...base,
          group: "decisiones",
          text: "registró el anticipo del 30 %",
          detail: (diff.note as string) || null,
        };
      case "gate.rejected": {
        const reason = c.rejection_reason?.[String(diff.reasonCode)] ?? String(diff.reasonCode ?? "");
        return {
          ...base,
          group: "decisiones",
          text: `rechazó el proyecto en ${diff.gate ?? "G1"}`,
          detail: [reason, diff.reasonText].filter(Boolean).join(" — "),
        };
      }
      case "gate.paused":
      case "project.cancelled":
      case "project.resumed":
        return {
          ...base,
          group: "decisiones",
          text: ACTION_LABEL[a.action]!,
          detail: (diff.reason as string) || (diff.comment as string) || null,
        };
      case "gate.info_requested": {
        const fields = (diff.fields as string[] | undefined)?.map(fieldLabel) ?? [];
        return {
          ...base,
          group: "info",
          text: "pidió más información",
          detail: `${diff.message ?? ""}${fields.length ? `\nCampos: ${fields.join(", ")}` : ""}`,
        };
      }
      case "info.answered":
        return {
          ...base,
          group: "info",
          text: "respondió a la petición de información",
          detail: String(diff.answer ?? ""),
        };
      case "project.edited":
        return {
          ...base,
          group: "ediciones",
          text: "editó el brief",
          changes: Object.entries(diff as Record<string, { from: unknown; to: unknown }>).map(([k, v]) => ({
            field: fieldLabel(k),
            from: fmt(v?.from),
            to: fmt(v?.to),
          })),
        };
      case "sheet.updated": {
        const fields = (diff.fields as string[] | undefined) ?? [];
        return {
          ...base,
          group: "ficha",
          text: `actualizó «${diff.title ?? diff.section}» en la ficha técnica`,
          detail:
            [fields.length ? `Campos: ${fields.join(", ")}` : null, diff.reopened ? "Vuelve a pendiente: falta información obligatoria." : null]
              .filter(Boolean)
              .join("\n") || null,
        };
      }
      case "sheet.done":
        return {
          ...base,
          group: "ficha",
          text: `marcó como terminado «${diff.title ?? diff.section}»`,
        };
      case "sheet.na":
        return {
          ...base,
          group: "ficha",
          text: `marcó «${diff.title ?? diff.section}» como no aplicable`,
          detail: (diff.note as string) || null,
        };
      case "sheet.reopened":
        return {
          ...base,
          group: "ficha",
          text: `reabrió «${diff.title ?? diff.section}»`,
        };
      case "file.uploaded":
      case "file.deleted":
        return {
          ...base,
          group: "archivos",
          text: `${ACTION_LABEL[a.action]}: ${diff.name ?? ""}`,
        };
      case "project.submitted":
        return {
          ...base,
          group: "decisiones",
          text: `envió la solicitud (${diff.code ?? ""})`,
        };
      default:
        return {
          ...base,
          group: "otros",
          text: ACTION_LABEL[a.action] ?? a.action,
        };
    }
  });

  const images = d.files.filter((f) => f.f.mime?.startsWith("image/"));
  const inspirations = b.olfactory?.inspirations?.filter((i) => i.product || i.brand || i.url) ?? [];
  const sortedTemplates = templates.map((t) => ({ ...t, score: templateScore(t, p) })).sort((a, z) => z.score - a.score);

  return (
    <div className="flex flex-col gap-6">
      {/* 1. Cabecera */}
      <section className="flex flex-col gap-4">
        <div className="text-xs text-slate-500">
          <Link href="/" className="hover:underline">
            Panel
          </Link>{" "}
          / {p.code}
        </div>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-sm text-slate-500">{p.code}</span>
              <StatusBadge status={p.status} phase={p.phase} />
              {p.priority && <span className={cn("text-xs", PRIORITY_COLOR[p.priority])}>Prioridad {PRIORITY_LABEL[p.priority].toLowerCase()}</span>}
            </div>
            <h1 className="mt-1 text-2xl font-semibold text-slate-900">{p.name}</h1>
            <p className="mt-1 text-sm text-slate-600">
              {p.type ? TYPE_LABEL[p.type] : ""}
              {p.type === "MP" && d.brandName ? ` · ${d.brandName}` : ""} · {p.category ? CATEGORY_LABEL[p.category] : ""}
              {d.clientName ? ` · ${d.clientName}` : ""} · Solicitado por {d.requesterName} el {formatDate(p.requestedAt)}
            </p>
            <p className="mt-1 text-sm">
              Fecha necesaria: <NeededBySignal date={p.neededBy} riskDays={settings.risk_days} status={p.status} />
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {canDecide && (
              <GateDialog
                projectId={p.id}
                gateLabel="G1 · Aprobación de la solicitud"
                summary={{
                  completeness: p.completenessPct,
                  requester: d.requesterName,
                  requestedAt: formatDate(p.requestedAt),
                }}
                templates={sortedTemplates.map((t) => ({
                  id: t.id,
                  name: t.name,
                  departmentIds: t.departmentIds,
                  score: t.score,
                }))}
                departments={departments.map((x) => ({
                  id: x.id,
                  name: x.name,
                  color: x.color,
                }))}
                fields={applicableFields(b)
                  .filter((f) => f.level !== "optional" || f.key === "notes")
                  .map((f) => ({
                    key: f.key,
                    label: f.label,
                    level: f.level,
                    missing: !isFieldFilled(f, b),
                  }))}
                rejectionReasons={catalogs.rejection_reason}
              />
            )}
            {canQuote && <QuoteDialog projectId={p.id} />}
            {canBudget && (
              <BudgetDialog
                projectId={p.id}
                requiresPrepayment={needsPrepayment}
                currentUserName={u.name}
                quoteInfo={p.quotedAt ? `Cotización enviada el ${formatDate(p.quotedAt)}${p.quoteAmount ? ` por ${formatEuro(p.quoteAmount)}` : ""}.` : null}
                rejectionReasons={catalogs.rejection_reason}
              />
            )}
            {canAdvance && (
              <AdvanceDialog
                projectId={p.id}
                nextLabel={PHASES[p.phase + 1]?.name ?? ""}
                toProduction={p.phase === LAST_PHASE}
                pendingSections={sheetPending}
              />
            )}
            {p.status === "info_requested" && isRequester && (
              <Button asChild variant="warning">
                <Link href={`/solicitudes/${p.id}`}>Responder petición de info</Link>
              </Button>
            )}
            {canEdit && !(p.status === "info_requested" && isRequester) && (
              <Button asChild variant="secondary">
                <Link href={`/solicitudes/${p.id}`}>
                  <Pencil /> Editar brief
                </Link>
              </Button>
            )}
            {canManage && p.status === "in_progress" && <ProjectAction projectId={p.id} kind="pause" />}
            {canManage && p.status === "paused" && <ProjectAction projectId={p.id} kind="resume" />}
            {canManage && canTransition(p.status, "cancel") && <ProjectAction projectId={p.id} kind="cancel" />}
          </div>
        </div>

        {openIr && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
            <p className="flex items-center gap-2 font-semibold">
              <AlertTriangle className="size-4" /> {openIr.by} pidió más información el {formatDate(openIr.ir.requestedAt, true)}
            </p>
            <p className="mt-1 whitespace-pre-line">{openIr.ir.message}</p>
            {openIr.ir.fieldsMissing.length > 0 && <p className="mt-1">Campos: {openIr.ir.fieldsMissing.map(fieldLabel).join(", ")}</p>}
          </div>
        )}
        {p.status === "rejected" && rejectedGate && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900">
            <p className="font-semibold">
              {rejectedGate.g.gate === "G2" ? "El cliente rechazó el presupuesto" : "Solicitud rechazada"} · registrado por {rejectedGate.by} el{" "}
              {formatDate(rejectedGate.g.decidedAt, true)}
            </p>
            <p className="mt-1">
              Motivo: {c.rejection_reason?.[rejectedGate.g.reasonCode ?? ""] ?? rejectedGate.g.reasonCode}
              {rejectedGate.g.comment ? ` — ${rejectedGate.g.comment}` : ""}
            </p>
          </div>
        )}
        {needsPrepayment && pp && (
          <div
            className={cn(
              "flex flex-wrap items-center gap-3 rounded-lg border p-3 text-sm",
              pp.status === "received" ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-amber-300 bg-amber-50 text-amber-900",
            )}
          >
            <span className="font-semibold">Anticipo del 30 %:</span>
            {pp.status === "received" ? (
              <span>recibido{pp.receivedAt ? ` (${formatDate(pp.receivedAt)})` : ""}.</span>
            ) : (
              <span>
                <strong>pendiente</strong>. Se inició sin anticipo bajo la responsabilidad de <strong>{pp.responsible}</strong> (registrado por {pp.recordedBy}{" "}
                el {formatDate(pp.recordedAt)}).
              </span>
            )}
            {pp.note && <span className="text-xs opacity-80">· {pp.note}</span>}
            {pp.status === "waived" && (canManage || canDecideGate(u, p, "G2")) && (
              <span className="ml-auto">
                <PrepaymentReceivedDialog projectId={p.id} />
              </span>
            )}
          </div>
        )}
      </section>

      {/* 2. Línea de fases */}
      <Card>
        <CardBody>
          <div className="grid grid-cols-6 gap-1" aria-hidden>
            {STAGES.map((st) => {
              const active = p.phase >= st.from && p.phase <= st.to && !["rejected", "cancelled", "in_production"].includes(p.status);
              const done = p.phase > st.to || (p.phase >= st.from && p.status === "in_production" && st.to === LAST_PHASE);
              return (
                <p
                  key={st.key}
                  className={cn(
                    "col-span-3 mb-1 border-b pb-1 text-xs font-semibold uppercase tracking-wide",
                    active ? "border-brand-300 text-brand-800" : done ? "border-slate-300 text-slate-600" : "border-slate-200 text-slate-400",
                  )}
                >
                  {st.name}
                </p>
              );
            })}
          </div>
          <ol className="grid grid-cols-6 gap-1" aria-label="Fases del proyecto">
            {PHASES.map((ph) => {
              const g = ph.gate ? d.gates.find((x) => x.g.gate === ph.gate) : undefined;
              const done = ph.n < p.phase || (ph.n === p.phase && p.status === "in_production");
              const current = ph.n === p.phase && !["rejected", "cancelled", "in_production"].includes(p.status);
              const inDate = entered[ph.n];
              return (
                <li key={ph.n} className="flex min-w-0 flex-col gap-1" aria-current={current ? "step" : undefined}>
                  <div className={cn("h-2 rounded-full", done ? "bg-brand-600" : current ? "bg-brand-300" : "bg-slate-200")} />
                  <p
                    className={cn(
                      "text-[11px] font-medium leading-tight sm:text-xs lg:text-sm",
                      current ? "text-brand-800" : done ? "text-slate-700" : "text-slate-400",
                    )}
                  >
                    <span className="hidden lg:inline">{ph.n} · </span>
                    <span className="lg:hidden">{ph.short}</span>
                    <span className="hidden lg:inline">{ph.name}</span>
                  </p>
                  <p className="hidden text-[11px] text-slate-500 md:block">{inDate && (done || current) ? `Desde ${formatDate(inDate)}` : " "}</p>
                  {ph.gate && (
                    <p className="hidden text-[11px] md:block">
                      <Badge
                        className={cn(
                          "whitespace-normal ring-slate-200",
                          g?.g.status === "approved"
                            ? "bg-[#eef0e6] text-[#56613f]"
                            : g?.g.status === "rejected"
                              ? "bg-rose-50 text-rose-800"
                              : current
                                ? "bg-amber-50 text-amber-800"
                                : "bg-white text-slate-500",
                        )}
                      >
                        {ph.gate} · {ph.gateName}
                      </Badge>
                    </p>
                  )}
                </li>
              );
            })}
          </ol>
          {d.departments.length > 0 && (
            <div className="mt-4 flex flex-wrap items-center gap-1.5 border-t border-slate-100 pt-3">
              <span className="mr-1 text-xs text-slate-500">Departamentos implicados:</span>
              {d.departments.map((x) => (
                <DeptChip key={x.id} name={x.name} color={x.color} />
              ))}
              {d.templateName && <span className="ml-2 text-xs text-slate-400">Plantilla: {d.templateName}</span>}
            </div>
          )}
        </CardBody>
      </Card>

      {/* 3. De un vistazo: resumen del proyecto | estado por departamento */}
      <div className="grid items-start gap-6 lg:grid-cols-2">
        {/* 5. Brief visual */}
        <Card className="h-full">
          <CardHeader title="Resumen del proyecto" description={`Brief de la solicitud · completo al ${p.completenessPct}%`} />
          <CardBody className="flex flex-col gap-5">
            {needsOlfactory(b) ? (
              <div className="flex flex-col gap-3 rounded-lg bg-slate-50 p-4">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Perfil olfativo solicitado</h3>
                <div className="flex flex-wrap gap-1.5">
                  {b.olfactory?.families?.map((f) => (
                    <span key={f} className="rounded-full bg-white px-2.5 py-0.5 text-xs text-slate-800 ring-1 ring-slate-300">
                      {f}
                    </span>
                  ))}
                </div>
                {!!b.olfactory?.genders?.length && (
                  <p className="text-xs text-slate-600">Género: {b.olfactory.genders.map((g) => GENDER_LABEL[g]).join(" · ")}</p>
                )}
                {b.olfactory?.intensity && (
                  <p className="text-xs text-slate-600">
                    Intensidad{" "}
                    <span aria-label={`${b.olfactory.intensity} de 5`}>
                      {"●".repeat(b.olfactory.intensity)}
                      <span className="text-slate-300">{"●".repeat(5 - b.olfactory.intensity)}</span>
                    </span>
                    {b.olfactory.duration ? ` · ${b.olfactory.duration}` : ""}
                  </p>
                )}
                {b.olfactory?.blacklist && <p className="whitespace-pre-line text-xs text-slate-600">Blacklist: {b.olfactory.blacklist}</p>}
                {showSheet && (
                  <a href="#ficha-formula" className="text-xs font-medium text-slate-700 underline underline-offset-2 hover:text-slate-900">
                    Pirámides desarrolladas y aprobadas → ficha técnica
                  </a>
                )}
              </div>
            ) : (
              <div className="rounded-lg bg-slate-50 p-4 text-sm text-slate-500">Sin bloque olfativo.</div>
            )}
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-3">
              <Datum label="Formato" value={[formatFormat(b, lookups), b.capacityMl ? `${b.capacityMl} ml` : null].filter(Boolean).join(" · ") || null} />
              <Datum label="Referencias" value={b.references ? formatNumber(b.references) : null} />
              <Datum
                label={p.type === "MP" ? "Unidades (1er año)" : "Unidades 1er pedido"}
                value={p.type === "MP" ? (p.unitsAnnual ? formatNumber(p.unitsAnnual) : null) : p.unitsFirstOrder ? formatNumber(p.unitsFirstOrder) : null}
              />
              <Datum label="Previsión anual" value={p.type === "PL" && p.unitsAnnual ? formatNumber(p.unitsAnnual) : null} />
              <Datum label="Precio objetivo" value={b.targetPrice != null ? formatEuro(b.targetPrice) : null} />
              <Datum label="PVP" value={b.rrp != null ? formatEuro(b.rrp) : null} />
              <Datum label="Canal" value={b.channels?.map((x) => c.channel?.[x] ?? x).join(", ") || null} className="col-span-2" />
              <div className="col-span-2 sm:col-span-3">
                <dt className="text-xs text-slate-500">Mercados</dt>
                <dd className="mt-1 flex flex-wrap gap-1">
                  {b.markets?.length
                    ? b.markets.map((m) => (
                        <span key={m} className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-700" title={c.market?.[m] ?? m}>
                          <span className="font-mono">{m}</span> {c.market?.[m] ?? ""}
                        </span>
                      ))
                    : "—"}
                </dd>
              </div>
            </dl>

            {(inspirations.length > 0 || images.length > 0) && (
              <div>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Inspiración y referencias</h3>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {inspirations.map((i, idx) => (
                    <div key={`i${idx}`} className="rounded-lg border border-slate-200 bg-gradient-to-br from-violet-50 to-white p-3 text-sm">
                      <p className="font-medium text-slate-900">{i.product || "—"}</p>
                      <p className="text-xs text-slate-500">{i.brand}</p>
                      {i.likes && <p className="mt-1 text-xs text-slate-700">“{i.likes}”</p>}
                      {i.url && (
                        <a
                          href={i.url}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-brand-700 hover:underline"
                        >
                          <ExternalLink className="size-3" /> {/fragrantica/i.test(i.url) ? "Fragrantica" : "Ver referencia"}
                        </a>
                      )}
                    </div>
                  ))}
                  {images.map(({ f }) => (
                    <a
                      key={f.id}
                      href={`/api/files/${f.id}`}
                      target="_blank"
                      rel="noreferrer"
                      className="group overflow-hidden rounded-lg border border-slate-200 bg-slate-50"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={`/api/files/${f.id}`}
                        alt={f.name}
                        className="aspect-square w-full object-cover transition-transform group-hover:scale-105"
                        loading="lazy"
                      />
                      <p className="truncate px-2 py-1 text-[11px] text-slate-500">{FILE_TAGS[f.tag as keyof typeof FILE_TAGS] ?? f.name}</p>
                    </a>
                  ))}
                </div>
              </div>
            )}
          </CardBody>
          <details className="border-t border-slate-100">
            <summary className="cursor-pointer px-5 py-3 text-sm font-medium text-brand-700 hover:bg-slate-50">Ver brief completo</summary>
            <div className="flex flex-col gap-4 px-5 pb-5">
              {briefSections(b, lookups).map((s) => (
                <div key={s.title}>
                  <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">{s.title}</h3>
                  <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
                    {s.rows.map(([label, v]) => (
                      <Datum key={label} label={label} value={v} />
                    ))}
                  </dl>
                </div>
              ))}
            </div>
          </details>
        </Card>
        {showSheet ? (
          <SheetSummary entries={sheet.entries} />
        ) : (
          <Card className="h-full">
            <CardHeader title="Estado por departamento" />
            <CardBody>
              <p className="text-sm text-slate-500">La ficha técnica de los departamentos se abre cuando se aprueba la solicitud (G1).</p>
            </CardBody>
          </Card>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="flex flex-col gap-6 lg:col-span-2">
          {/* 4. Ficha técnica: detalle por departamento */}
          {showSheet && (
            <SheetPanel
              projectId={p.id}
              entries={sheet.entries}
              ctx={sheet.ctx}
              files={d.files.map(({ f }) => ({
                id: f.id,
                name: f.name,
                size: f.size,
                mime: f.mime,
                tag: f.tag,
              }))}
              editable={Object.fromEntries(sheet.entries.map((e) => [e.section.key, canEditSection(u, e.dept.key, p)]))}
              maxMb={settings.max_file_mb}
              noteSuggestions={(catalogs.note ?? []).map((n) => n.label)}
            />
          )}

          {/* 7. Comentarios */}
          <Card id="comentarios">
            <CardHeader title="Comentarios" description="Menciona con @ a personas o departamentos para avisarles por email" />
            <CardBody className="flex flex-col gap-4">
              {d.comments.map(({ c: cm, author }) => (
                <div key={cm.id} className="flex gap-3">
                  <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-brand-100 text-xs font-semibold text-brand-800">
                    {author
                      .split(" ")
                      .slice(0, 2)
                      .map((x) => x[0])
                      .join("")}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm">
                      <span className="font-medium">{author}</span> <span className="text-xs text-slate-400">{formatDate(cm.createdAt, true)}</span>
                    </p>
                    <p className="mt-0.5 whitespace-pre-line break-words text-sm text-slate-700">{highlightMentions(cm.body)}</p>
                  </div>
                </div>
              ))}
              {!d.comments.length && <p className="text-sm text-slate-400">Sin comentarios todavía.</p>}
              <CommentComposer
                projectId={p.id}
                users={users.map((x) => ({ id: x.id, name: x.name }))}
                departments={departments.map((x) => ({
                  id: x.id,
                  name: x.name,
                }))}
              />
            </CardBody>
          </Card>
        </div>

        <div className="flex flex-col gap-6">
          {/* 8. Archivos */}
          <Card>
            <CardHeader
              title="Archivos"
              actions={
                p.sharepointFolderUrl ? (
                  <a
                    href={p.sharepointFolderUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-xs font-medium text-brand-700 hover:underline"
                  >
                    <ExternalLink className="size-3.5" /> Abrir en SharePoint
                  </a>
                ) : (
                  <span className="text-xs text-amber-700">Carpeta SharePoint pendiente</span>
                )
              }
            />
            <CardBody className="flex flex-col gap-4">
              {PHASE_FOLDERS.map((folder, i) => {
                const list = d.files.filter((f) => f.f.phase === i);
                if (!list.length) return null;
                return (
                  <div key={folder}>
                    <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-slate-500">
                      <FolderOpen className="size-3.5" /> {folder}
                    </p>
                    <ul className="flex flex-col gap-1">
                      {list.map(({ f, by }) => (
                        <li key={f.id} className="flex items-center gap-2 text-sm">
                          <FileText className="size-4 shrink-0 text-slate-400" />
                          <a
                            href={`/api/files/${f.id}`}
                            target="_blank"
                            rel="noreferrer"
                            className="min-w-0 flex-1 truncate hover:underline"
                            title={`${f.name} · ${by} · ${formatDate(f.createdAt)}`}
                          >
                            {f.name}
                          </a>
                          <span className="shrink-0 text-xs text-slate-400">{formatBytes(f.size)}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
              {!d.files.length && <p className="text-sm text-slate-400">Sin archivos.</p>}
              {!["rejected", "cancelled"].includes(p.status) && (
                <div className="border-t border-slate-100 pt-3">
                  <p className="mb-2 text-xs text-slate-500">Subir a «{PHASE_FOLDERS[Math.min(p.phase, PHASE_FOLDERS.length - 1)]}»</p>
                  <Uploader projectId={p.id} phase={p.phase} maxMb={settings.max_file_mb} showTags={false} canDelete={false} compact refreshOnUpload />
                </div>
              )}
            </CardBody>
          </Card>

          {/* 6. Actividad */}
          <Card>
            <CardHeader title="Actividad" />
            <CardBody>
              <ActivityTimeline items={activity} />
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Datum({ label, value, className }: { label: string; value: string | null; className?: string }) {
  return (
    <div className={cn("min-w-0", className)}>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className={cn("break-words", value ? "text-slate-900" : "text-slate-300")}>{value ?? "—"}</dd>
    </div>
  );
}

function highlightMentions(text: string) {
  const parts = text.split(/(@[\p{L}][\p{L}\p{N}/+.-]*(?: [\p{Lu}][\p{L}\p{N}/+.-]*)*)/u);
  return parts.map((part, i) =>
    part.startsWith("@") ? (
      <span key={i} className="rounded bg-brand-50 px-0.5 font-medium text-brand-800">
        {part}
      </span>
    ) : (
      part
    ),
  );
}
