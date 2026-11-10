import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, ClipboardList, ExternalLink, FileText, FolderOpen, Pencil } from "lucide-react";
import { ActivityTimeline, type ActivityItem } from "@/components/project/activity-timeline";
import { describeActivity, fieldLabel } from "@/lib/activity-describe";
import { CommentComposer } from "@/components/project/comment-composer";
import { GateDialog } from "@/components/project/gate-dialog";
import { QuoteDocButton } from "@/components/project/quote-doc-button";
import { ProjectAction } from "@/components/project/project-actions";
import { LabelInfoDialog } from "@/components/project/label-info-dialog";
import { AdvanceDialog, BudgetDialog, PrepaymentReceivedDialog, QuoteDialog } from "@/components/project/phase-dialogs";
import { BackLink } from "@/components/back-link";
import { NeededBySignal } from "@/components/needed-by";
import { MyWork, SheetPanel, SheetSummary } from "@/components/sheet/sheet-panel";
import { Uploader } from "@/components/uploader";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { briefSections, formatFormat, type Lookups } from "@/lib/brief/display";
import { applicableFields, isFieldFilled } from "@/lib/brief/fields";
import { canManageReferences, labelInfoMissing } from "@/lib/server/references";
import { ReferencesCard } from "@/components/project/references-card";
import { needsOlfactory } from "@/lib/brief/schema";
import {
  CATEGORY_LABEL,
  FILE_TAGS,
  LAST_PHASE,
  PHASE_FOLDERS,
  phaseFolderIndex,
  phaseFolderName,
  PHASES,
  PREPAYMENT_TYPES,
  STAGES,
  PRIORITY_COLOR,
  PRIORITY_LABEL,
  TYPE_LABEL,
  GATE_LABEL,
  FIRST_RUNNING_PHASE,
} from "@/lib/labels";
import { GENDER_LABEL } from "@/lib/brief/display";
import { canCompleteLabelInfo, canDecideGate, canEditBrief, canManageProject, canSeeFormulaCost, canSendQuote, canViewProject, requireUser } from "@/lib/server/authz";
import { getActiveUsers, getAllCatalogs, getBrands, getDepartments } from "@/lib/server/catalogs";
import { loadProjectDetail, templatesWithDepartments, templateScore } from "@/lib/server/project-detail";
import { getSettings } from "@/lib/server/settings";
import { canSeeLabFormula, listNotes, listSamples } from "@/lib/server/lab";
import { canEditSection, getFormulaTargetCost, loadSheet, pendingUpTo } from "@/lib/server/sheet";
import { canTransition } from "@/lib/server/state-machine";
import { cn, formatBytes, formatDate, formatEuro, formatNumber } from "@/lib/utils";

export const metadata = { title: "Proyecto" };

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
  const sheetPending = pendingUpTo(sheet.cards, p.phase).map((c) => `${c.dept.name} (en «${c.current?.name ?? "—"}»)`);
  // La fase solo avanza cuando todos sus departamentos han terminado su parte
  // Tras aprobarse la fórmula (Laboratorio completado), el comercial debe completar los datos para la etiqueta
  // Con varias referencias basta con que una tenga la fórmula aprobada para pedir sus datos
  const labCard = sheet.cards.find((x) => x.dept.key === "idi");
  const labDone = p.phase > FIRST_RUNNING_PHASE || !!labCard?.completed || !!labCard?.refs.some((r) => r.completed);
  const missingLabel = p.phase >= FIRST_RUNNING_PHASE && ["in_progress", "paused"].includes(p.status) ? labelInfoMissing(p, sheet.refs) : [];
  const multiRef = sheet.refs.length >= 2;
  const refTitleOf = (r: { label: string; name: string }) => (r.name && r.name !== `Referencia ${r.label}` ? `${r.label} · ${r.name}` : `Referencia ${r.label}`);
  const refPriceOf = (id: number) => sheet.refPrices.find((x) => x.ref.id === id);
  const advanceWaitingOn = [
    ...pendingUpTo(sheet.cards, p.phase).map((c) => c.dept.name),
    ...(missingLabel.length ? ["el comercial (datos para la etiqueta)"] : []),
  ];
  const now = sheet.now;
  // Coste objetivo de fórmula: confidencial (Laboratorio, gestor de proyectos, admin y Operaciones)
  const seeFormulaCost = canSeeFormulaCost(u);
  const formulaCost = seeFormulaCost ? await getFormulaTargetCost(p.id) : null;
  // Laboratorio: muestras (fórmula solo para Laboratorio, Calidad y admin) y bitácora
  const [labSampleRows, labNoteRows] = await Promise.all([listSamples(u, p.id), listNotes(p.id, "idi")]);
  const lab = { samples: labSampleRows, notes: labNoteRows, canSeeFormula: canSeeLabFormula(u) };
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

  const activity: ActivityItem[] = d.activity.map(({ a, actor }) => ({
    id: a.id,
    actor: actor ?? "Sistema",
    at: a.createdAt.toISOString(),
    ...describeActivity(a, { departments: departments.map((x) => ({ id: x.id, name: x.name })), rejectionReasons: c.rejection_reason ?? {} }),
  }));

  const images = d.files.filter((f) => f.f.mime?.startsWith("image/"));
  const inspirations = b.olfactory?.inspirations?.filter((i) => i.product || i.brand || i.url) ?? [];
  const sortedTemplates = templates.map((t) => ({ ...t, score: templateScore(t, p) })).sort((a, z) => z.score - a.score);

  return (
    <div className="flex flex-col gap-6">
      {/* 1. Cabecera */}
      <section className="flex flex-col gap-4">
        <BackLink />
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
              Entrega requerida: <NeededBySignal date={p.neededBy} riskDays={settings.risk_days} status={p.status} />
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 sm:justify-end">
            {showSheet && (
              <Button asChild variant="secondary">
                <Link href={`/proyectos/${p.id}/ficha`}>
                  <ClipboardList aria-hidden /> Ficha completa
                </Link>
              </Button>
            )}
            {canDecide && (
              <GateDialog
                projectId={p.id}
                gateLabel="P1 · Aprobación de la solicitud"
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
            {canQuote && (
              <QuoteDialog
                projectId={p.id}
                initial={sheet.entries.find((e) => e.section.key === "comercial")?.data ?? {}}
                files={d.files.filter(({ f }) => f.tag === "cotizacion").map(({ f }) => ({ id: f.id, name: f.name, size: f.size, mime: f.mime, tag: f.tag }))}
                maxMb={settings.max_file_mb}
                requesterName={lookups.users[p.requesterId] ?? "el solicitante"}
                specsInitial={sheet.entries.find((e) => e.section.key === "packaging" && e.refId === 0)?.data ?? sheet.entries.find((e) => e.section.key === "packaging")?.data ?? {}}
                {...(seeFormulaCost ? { formulaCost } : {})}
                references={sheet.refs.map((r) => ({
                  id: r.id,
                  title: refTitleOf(r),
                  unitPrice: refPriceOf(r.id)?.unitPrice ?? null,
                  specs: p.packagingMode === "per_reference" ? (sheet.entries.find((e) => e.section.key === "packaging" && e.refId === r.id)?.data ?? {}) : {},
                }))}
                modes={{ pricing: p.pricingMode, packaging: p.packagingMode }}
              />
            )}
            {canBudget && (
              <BudgetDialog
                projectId={p.id}
                requiresPrepayment={needsPrepayment}
                currentUserName={u.name}
                quoteInfo={
                  p.quotedAt
                    ? `Cotización enviada al comercial el ${formatDate(p.quotedAt)}${
                        sheet.refPrices.length ? " · precio por referencia" : p.quoteAmount ? ` · ${formatEuro(p.quoteAmount)}/ud` : ""
                      }.`
                    : null
                }
                rejectionReasons={catalogs.rejection_reason}
                priceReferences={sheet.refPrices.map((x) => ({ id: x.ref.id, title: refTitleOf(x.ref), quoted: x.unitPrice }))}
              />
            )}
            {canAdvance && !advanceWaitingOn.length && (
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
        {labDone && missingLabel.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
            <p>
              <span className="font-semibold">Fórmula aprobada por el cliente.</span> Falta que el comercial complete los datos para la etiqueta:{" "}
              {(multiRef ? missingLabel.map((f) => f.label) : missingLabel.map((f) => f.label.replace(/ \(.*\)$/, ""))).join(", ")}.
            </p>
            {canCompleteLabelInfo(u, p) && (
              <LabelInfoDialog
                projectId={p.id}
                initial={{
                  finalName: b.finalName ?? "",
                  facing: b.facing ?? "",
                  languages: b.languages ?? [],
                  markets: b.markets ?? [],
                  refs: multiRef ? sheet.refs.map((r) => ({ id: r.id, title: refTitleOf(r), finalName: r.finalName ?? "", facing: r.facing ?? "" })) : [],
                }}
                languages={catalogs.language}
                markets={catalogs.market}
              />
            )}
          </div>
        )}
        {needsPrepayment && pp && (
          <div
            className={cn(
              "flex flex-wrap items-center gap-3 rounded-lg border p-3 text-sm",
              pp.status === "received" ? "border-natu-sage bg-[#eef0e6] text-[#56613f]" : "border-amber-300 bg-amber-50 text-amber-900",
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

      {/* Lo que depende de la persona en este proyecto */}
      <MyWork
        projectId={p.id}
        cards={sheet.cards}
        entries={sheet.entries}
        ctx={sheet.ctx}
        now={now}
        files={d.files.map(({ f }) => ({ id: f.id, name: f.name, size: f.size, mime: f.mime, tag: f.tag }))}
        maxMb={settings.max_file_mb}
        editable={Object.fromEntries(sheet.cards.map((c) => [c.dept.key, canEditSection(u, c.dept.key, c.phase, p)]))}
        mine={u.departmentKeys.filter(Boolean)}
        lab={lab}
        actions={[
          ...(canDecide ? [{ label: "Revisar la solicitud (P1)", hint: "Apruébala, pide más información o recházala con el botón de arriba." }] : []),
          ...(canQuote ? [{ label: "Enviar la cotización al comercial", hint: "Con el botón «Enviar cotización al comercial» de arriba." }] : []),
          ...(canBudget ? [{ label: "Registrar la respuesta del cliente (P2)", hint: "Indica si el cliente aprueba el presupuesto, pide cambios o lo rechaza." }] : []),
          ...(canCompleteLabelInfo(u, p) && labDone && missingLabel.length
            ? [{ label: "Completar los datos para la etiqueta", hint: "Naming definitivo, facing, idiomas y países: sin ellos no se pasa a Diseño." }]
            : []),
          ...(p.status === "info_requested" && isRequester ? [{ label: "Responder la petición de información", hint: "Te han pedido más datos para poder aprobar la solicitud." }] : []),
          ...(canAdvance && !advanceWaitingOn.length && p.status === "in_progress" && p.phase >= FIRST_RUNNING_PHASE
            ? [{ label: `Avanzar el proyecto a «${p.phase === LAST_PHASE ? "Producción" : (PHASES[p.phase + 1]?.name ?? "")}»`, hint: "Todos los departamentos de esta fase han terminado." }]
            : []),
        ]}
      />

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
                    <span className="sm:hidden">{ph.n}</span>
                    <span className="hidden sm:inline lg:hidden">{ph.short}</span>
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
                        {GATE_LABEL[ph.gate]} · {ph.gateName}
                      </Badge>
                    </p>
                  )}
                </li>
              );
            })}
          </ol>
          <p className="mt-2 text-xs text-slate-600 sm:hidden">
            Fase {p.phase} de {LAST_PHASE} · <span className="font-medium text-brand-800">{PHASES[p.phase]?.name}</span>
          </p>
          {canAdvance && advanceWaitingOn.length > 0 && (
            <p className="mt-3 border-t border-slate-100 pt-3 text-sm text-slate-600">
              Pasará a «{p.phase === LAST_PHASE ? "Producción" : PHASES[p.phase + 1]?.name}» cuando terminen: <span className="font-medium text-slate-800">{advanceWaitingOn.join(", ")}</span>.
            </p>
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
                {!(b.olfactory?.families?.length || b.olfactory?.genders?.length || b.olfactory?.intensity || inspirations.length) && (
                  <p className="text-sm text-slate-500">Todavía no se ha indicado el perfil olfativo.</p>
                )}
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
                    <div key={`i${idx}`} className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
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
          <SheetSummary cards={sheet.cards} now={now} />
        ) : (
          <Card className="h-full">
            <CardHeader title="Estado por departamento" />
            <CardBody>
              <p className="text-sm text-slate-500">La ficha técnica de los departamentos se abre cuando se aprueba la solicitud (P1).</p>
            </CardBody>
          </Card>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-6 lg:col-span-2">
          {/* Referencias (variantes) del proyecto */}
          {p.status !== "draft" && (multiRef || (canManageReferences(u, p) && (b.references ?? 0) >= 2)) && (
            <ReferencesCard
              projectId={p.id}
              refs={sheet.refs.map((r) => ({
                id: r.id,
                label: r.label,
                name: r.name,
                unitPrice: refPriceOf(r.id)?.unitPrice ?? null,
                finalUnitPrice: refPriceOf(r.id)?.finalUnitPrice ?? null,
              }))}
              canManage={canManageReferences(u, p)}
              suggested={b.references ?? 0}
              showPrices={sheet.refPrices.length > 0}
            />
          )}

          {/* 4. Departamentos: estados y detalles */}
          {showSheet && (
            <SheetPanel
              projectId={p.id}
              cards={sheet.cards}
              entries={sheet.entries}
              ctx={sheet.ctx}
              now={now}
              files={d.files.map(({ f }) => ({
                id: f.id,
                name: f.name,
                size: f.size,
                mime: f.mime,
                tag: f.tag,
              }))}
              editable={Object.fromEntries(sheet.cards.map((c) => [c.dept.key, canEditSection(u, c.dept.key, c.phase, p)]))}
              maxMb={settings.max_file_mb}
              {...(seeFormulaCost ? { formulaCost } : {})}
              mine={u.departmentKeys.filter(Boolean)}
              lab={lab}
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

        <div className="flex min-w-0 flex-col gap-6">
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
                const list = d.files.filter((f) => phaseFolderIndex(f.f.phase) === i);
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
              {p.quotedAt && p.sharepointSubfolders && canSendQuote(u, p) && (
                <div>
                  <QuoteDocButton projectId={p.id} />
                  <p className="mt-1 text-xs text-slate-500">Word con toda la información de la última cotización, en «{PHASE_FOLDERS[1]}». Se genera solo al enviar cada cotización.</p>
                </div>
              )}
              {!["rejected", "cancelled"].includes(p.status) && (
                <div className="border-t border-slate-100 pt-3">
                  <p className="mb-2 text-xs text-slate-500">Subir a «{phaseFolderName(p.phase)}»</p>
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
