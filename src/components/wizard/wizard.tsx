"use client";
import { AlertTriangle, Check, ChevronLeft, ChevronRight, CloudOff, Loader2, Send, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";
import { answerInfoAction, deleteDraftAction, saveBriefAction, submitAction } from "@/app/actions/projects";
import { Button } from "@/components/ui/button";
import { ChipGroup } from "@/components/ui/chips";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { Uploader, type UploadedFile } from "@/components/uploader";
import { briefSections, type Lookups } from "@/lib/brief/display";
import { computeCompleteness, FIELD_BY_KEY, missingFields, submitErrors } from "@/lib/brief/fields";
import { needsOlfactory, parseBriefLenient, type BriefInput } from "@/lib/brief/schema";
import type { Option } from "@/lib/catalog-defaults";
import { CATEGORY_LABEL, PRIORITY_LABEL, TYPE_LABEL } from "@/lib/labels";
import { cn, formatDate } from "@/lib/utils";
import { ClientPicker } from "./client-picker";
import { OlfactoryFields, type OlfactoryState } from "./olfactory-fields";

type ClientLite = { id: number; name: string; country: string | null };

export type WizardProps = {
  project: { id: string; status: string; code: string | null; createdAt: string };
  requester: { id: string; name: string };
  initialBrief: BriefInput;
  catalogs: Record<string, Option[]>;
  brands: { id: number; name: string }[];
  users: { id: string; name: string }[];
  clients: ClientLite[];
  files: UploadedFile[];
  settings: { completeness_threshold: number; max_file_mb: number };
  infoRequest: { message: string; fieldsMissing: string[]; requestedBy: string; requestedAt: string } | null;
  canAnswer: boolean;
};

const STEP_TITLES = ["Datos básicos", "Cliente y mercado", "Producto", "Adjuntos y notas", "Resumen y envío"];

type SaveState = "idle" | "saving" | "saved" | "error";

export function Wizard(props: WizardProps) {
  const { project, catalogs } = props;
  const router = useRouter();
  const isDraft = project.status === "draft";
  const [brief, setBrief] = React.useState<BriefInput>(props.initialBrief);
  const [step, setStep] = React.useState(1);
  const [save, setSave] = React.useState<SaveState>("idle");
  const [dirty, setDirty] = React.useState(false);
  const [showErrors, setShowErrors] = React.useState(false);
  const [serverErrors, setServerErrors] = React.useState<Record<string, string>>({});
  const [submitting, setSubmitting] = React.useState(false);
  const [answer, setAnswer] = React.useState("");
  const [files, setFiles] = React.useState(() => props.files.filter((f) => f.tag !== "blacklist" && f.tag !== "inspiracion"));
  const [blacklistFiles, setBlacklistFiles] = React.useState(() => props.files.filter((f) => f.tag === "blacklist"));
  const [inspirationFiles, setInspirationFiles] = React.useState(() => props.files.filter((f) => f.tag === "inspiracion"));
  const [clients, setClients] = React.useState<Record<number, ClientLite>>(() => Object.fromEntries(props.clients.map((c) => [c.id, c])));
  const topRef = React.useRef<HTMLDivElement>(null);

  const parsed = React.useMemo(() => parseBriefLenient(brief).data, [brief]);
  const completeness = computeCompleteness(parsed);
  const reqErrors = React.useMemo(() => submitErrors(parsed), [parsed]);
  const errorFor = (k: string) => serverErrors[k] ?? (showErrors ? reqErrors[k] : undefined);
  const highlighted = new Set(props.infoRequest?.fieldsMissing ?? []);
  const hl = (k: string) => highlighted.has(k);

  const set = React.useCallback(<K extends keyof BriefInput>(k: K, v: BriefInput[K]) => {
    setBrief((b) => ({ ...b, [k]: v }));
    setDirty(true);
  }, []);

  // Autoguardado en borrador (debounce). En edición de un proyecto enviado se guarda explícitamente.
  const persist = React.useCallback(async () => {
    setSave("saving");
    const res = await saveBriefAction(project.id, brief);
    if (res.ok) {
      setSave("saved");
      setDirty(false);
      return true;
    }
    setSave("error");
    toast.error(res.error);
    return false;
  }, [brief, project.id]);

  React.useEffect(() => {
    if (!isDraft || !dirty) return;
    const t = setTimeout(() => void persist(), 1200);
    return () => clearTimeout(t);
  }, [brief, dirty, isDraft, persist]);

  React.useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (dirty) e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const go = async (n: number) => {
    if (isDraft && dirty) await persist();
    setStep(n);
    topRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const opts = (k: string) => catalogs[k] ?? [];
  const lookups: Lookups = {
    catalog: Object.fromEntries(Object.entries(catalogs).map(([k, v]) => [k, Object.fromEntries(v.map((o) => [o.value, o.label]))])),
    brands: Object.fromEntries(props.brands.map((b) => [b.id, b.name])),
    users: Object.fromEntries(props.users.map((u) => [u.id, u.name])),
    clients: Object.fromEntries(Object.values(clients).map((c) => [c.id, c.name])),
  };

  async function handleSubmit() {
    setShowErrors(true);
    if (Object.keys(reqErrors).length) {
      toast.error("Faltan campos obligatorios");
      return;
    }
    setSubmitting(true);
    try {
      if (!(await persist())) return;
      const res = await submitAction(project.id);
      if (!res.ok) {
        setServerErrors(res.fieldErrors ?? {});
        toast.error(res.error);
        return;
      }
      setDirty(false);
      toast.success(`Solicitud ${res.data?.code} enviada`);
      router.push(`/proyectos/${project.id}`);
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSaveEdit(thenAnswer: boolean) {
    setShowErrors(true);
    setSubmitting(true);
    try {
      if (!(await persist())) return;
      if (thenAnswer) {
        const res = await answerInfoAction(project.id, answer);
        if (!res.ok) {
          setServerErrors(res.fieldErrors ?? {});
          toast.error(res.error);
          return;
        }
        toast.success("Respuesta enviada. La solicitud vuelve a estar pendiente de decisión.");
      } else {
        toast.success("Cambios guardados");
      }
      setDirty(false);
      router.push(`/proyectos/${project.id}`);
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  }

  const stepHasErrors = (n: number) => showErrors && Object.keys(reqErrors).some((k) => (FIELD_BY_KEY[k]?.step ?? 1) === n);
  const recommendedMissing = missingFields(parsed, "recommended");
  const briefType = parsed.type;

  return (
    <div className="fixed inset-0 z-40 flex items-stretch justify-center bg-slate-900/40 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby="wizard-title">
      <div className="flex h-full w-full max-w-4xl flex-col overflow-hidden bg-white shadow-2xl sm:h-[94dvh] sm:rounded-2xl">
        {/* Cabecera con progreso y completitud (siempre visible) */}
        <header className="shrink-0 border-b border-slate-200 bg-white px-4 pt-3 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-xs text-slate-500">
                {isDraft ? "Nueva solicitud · Borrador" : `Editar brief · ${project.code}`} · {props.requester.name} · {formatDate(project.createdAt)}
              </p>
              <h1 id="wizard-title" className="truncate text-base font-semibold text-slate-900 sm:text-lg">
                {parsed.name || "Solicitud sin nombre"}
              </h1>
            </div>
            <SaveIndicator state={save} dirty={dirty} isDraft={isDraft} />
            <Link
              href={isDraft ? "/" : `/proyectos/${project.id}`}
              onClick={async (e) => {
                if (isDraft && dirty) {
                  e.preventDefault();
                  await persist();
                  router.push("/");
                }
              }}
              className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100"
              aria-label="Cerrar asistente"
            >
              <X className="size-5" />
            </Link>
          </div>
          <div className="mt-3 flex items-center gap-3">
            <div className="flex-1">
              <div className="flex justify-between text-[11px] text-slate-500">
                <span>Completitud del brief</span>
                <span className={cn("font-semibold", completeness >= props.settings.completeness_threshold ? "text-emerald-700" : "text-amber-700")}>{completeness}%</span>
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-valuenow={completeness} aria-valuemin={0} aria-valuemax={100} aria-label="Completitud">
                <div
                  className={cn("h-full rounded-full transition-all", completeness >= props.settings.completeness_threshold ? "bg-emerald-500" : "bg-amber-400")}
                  style={{ width: `${completeness}%` }}
                />
              </div>
            </div>
          </div>
          <nav className="-mx-1 mt-3 flex gap-1 overflow-x-auto pb-2" aria-label="Pasos">
            {STEP_TITLES.map((t, i) => {
              const n = i + 1;
              const label = n === 2 && briefType ? TYPE_LABEL[briefType] : t;
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => go(n)}
                  aria-current={step === n ? "step" : undefined}
                  className={cn(
                    "flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium",
                    step === n ? "bg-brand-600 text-white" : n < step ? "bg-brand-50 text-brand-800" : "text-slate-500 hover:bg-slate-100",
                  )}
                >
                  <span className={cn("flex size-4 items-center justify-center rounded-full text-[10px]", step === n ? "bg-white/20" : "bg-slate-200/70")}>
                    {stepHasErrors(n) ? "!" : n}
                  </span>
                  {label}
                </button>
              );
            })}
          </nav>
        </header>

        <div className="flex-1 overflow-y-auto px-4 py-5 sm:px-6">
          <div ref={topRef} />
          {props.infoRequest && (
            <div className="mb-5 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm">
              <p className="flex items-center gap-2 font-semibold text-amber-900">
                <AlertTriangle className="size-4" /> {props.infoRequest.requestedBy} ha pedido más información · {formatDate(props.infoRequest.requestedAt, true)}
              </p>
              <p className="mt-1 whitespace-pre-line text-amber-900">{props.infoRequest.message}</p>
              {props.infoRequest.fieldsMissing.length > 0 && (
                <p className="mt-2 text-amber-800">
                  Campos a revisar (resaltados):{" "}
                  {props.infoRequest.fieldsMissing.map((k) => (
                    <button key={k} type="button" className="mr-1 underline" onClick={() => go(FIELD_BY_KEY[k]?.step ?? 1)}>
                      {FIELD_BY_KEY[k]?.label ?? k}
                    </button>
                  ))}
                </p>
              )}
            </div>
          )}

          {step === 1 && (
            <section className="grid gap-5 sm:grid-cols-2">
              <Field label="Tipo de proyecto" required error={errorFor("type")} highlight={hl("type")} className="sm:col-span-2">
                <ChipGroup
                  multiple={false}
                  options={[
                    { value: "PL", label: `${TYPE_LABEL.PL} (PL)` },
                    { value: "MP", label: `${TYPE_LABEL.MP} (MP)` },
                    { value: "MDD", label: `${TYPE_LABEL.MDD} (MDD)` },
                  ]}
                  value={brief.type ? [brief.type] : []}
                  onChange={(v) => isDraft && set("type", (v[0] as BriefInput["type"]) || undefined)}
                  ariaLabel="Tipo de proyecto"
                />
                {!isDraft && <p className="text-xs text-slate-500">El tipo no se puede cambiar tras el envío.</p>}
              </Field>
              <Field label="Categoría" required error={errorFor("category")} highlight={hl("category")} className="sm:col-span-2">
                <ChipGroup
                  multiple={false}
                  options={Object.entries(CATEGORY_LABEL).map(([value, label]) => ({ value, label }))}
                  value={brief.category ? [brief.category] : []}
                  onChange={(v) => isDraft && set("category", (v[0] as BriefInput["category"]) || undefined)}
                  ariaLabel="Categoría"
                />
              </Field>
              <Field label="Nombre provisional del proyecto" htmlFor="name" required error={errorFor("name")} highlight={hl("name")} className="sm:col-span-2">
                <Input id="name" value={brief.name ?? ""} onChange={(e) => set("name", e.target.value)} placeholder="p. ej. Body mist verano cítrico" maxLength={200} />
              </Field>
              <Field label="Fecha de entrega requerida" htmlFor="neededBy" required error={errorFor("neededBy")} highlight={hl("neededBy")}>
                <Input id="neededBy" type="date" value={brief.neededBy ?? ""} onChange={(e) => set("neededBy", e.target.value)} />
              </Field>
              <Field label="Prioridad sugerida" htmlFor="priority" required error={errorFor("priority")} highlight={hl("priority")}>
                <Select id="priority" value={brief.priority ?? ""} onChange={(e) => set("priority", (e.target.value || undefined) as BriefInput["priority"])}>
                  <option value="">Selecciona…</option>
                  {Object.entries(PRIORITY_LABEL).map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Motivo de la fecha" htmlFor="neededByReason" required error={errorFor("neededByReason")} highlight={hl("neededByReason")}>
                <Select id="neededByReason" value={brief.neededByReason ?? ""} onChange={(e) => set("neededByReason", e.target.value)}>
                  <option value="">Selecciona…</option>
                  {opts("needed_by_reason").map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Detalle del motivo" htmlFor="neededByReasonText" required={brief.neededByReason === "otro"} error={errorFor("neededByReasonText")}>
                <Input id="neededByReasonText" value={brief.neededByReasonText ?? ""} onChange={(e) => set("neededByReasonText", e.target.value)} placeholder="p. ej. Feria Cosmoprof Bolonia" />
              </Field>
            </section>
          )}

          {step === 2 && !briefType && <EmptyStep onBack={() => go(1)} text="Elige primero el tipo de proyecto (paso 1)." />}

          {step === 2 && (briefType === "PL" || briefType === "MDD") && (
            <section className="grid gap-5 sm:grid-cols-2">
              <Field label="Cliente" htmlFor="client" required error={errorFor("clientId")} highlight={hl("clientId")} className="sm:col-span-2">
                <ClientPicker
                  id="client"
                  value={parsed.clientId}
                  selected={parsed.clientId ? (clients[parsed.clientId] ?? null) : null}
                  newClient={brief.newClient as { name: string } | undefined}
                  countries={opts("market")}
                  onSelect={(c) => {
                    if (c) setClients((m) => ({ ...m, [c.id]: c }));
                    setBrief((b) => ({ ...b, clientId: c?.id, newClient: undefined }));
                    setDirty(true);
                  }}
                  onNewClient={(nc) => {
                    setBrief((b) => ({ ...b, newClient: nc, clientId: undefined }));
                    setDirty(true);
                  }}
                />
              </Field>
              <Field label="Comercial responsable de la cuenta" htmlFor="am" required error={errorFor("accountManagerId")} highlight={hl("accountManagerId")}>
                <Select id="am" value={brief.accountManagerId ?? ""} onChange={(e) => set("accountManagerId", e.target.value)}>
                  <option value="">Selecciona…</option>
                  {props.users.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Subtipo" htmlFor="subtype" required error={errorFor("subtype")} highlight={hl("subtype")}>
                <Select id="subtype" value={brief.subtype ?? ""} onChange={(e) => set("subtype", e.target.value)}>
                  <option value="">Selecciona…</option>
                  {opts("pl_subtype").map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <MarketsAndChannels brief={brief} set={set} opts={opts} errorFor={errorFor} hl={hl} />
              <Field label="Nº de referencias" htmlFor="references" required error={errorFor("references")} highlight={hl("references")}>
                <Input id="references" type="number" inputMode="numeric" min={1} value={brief.references ?? ""} onChange={(e) => set("references", e.target.value)} />
              </Field>
              <Field label="Unidades primer pedido" htmlFor="firstOrderUnits" required error={errorFor("firstOrderUnits")} highlight={hl("firstOrderUnits")}>
                <Input id="firstOrderUnits" type="number" inputMode="numeric" min={0} value={brief.firstOrderUnits ?? ""} onChange={(e) => set("firstOrderUnits", e.target.value)} />
              </Field>
              <Field label="Previsión anual de unidades" htmlFor="annualUnits" recommended highlight={hl("annualUnits")}>
                <Input id="annualUnits" type="number" inputMode="numeric" min={0} value={brief.annualUnits ?? ""} onChange={(e) => set("annualUnits", e.target.value)} />
              </Field>
              <Field label="Precio objetivo de compra (€)" htmlFor="targetPrice" recommended highlight={hl("targetPrice")}>
                <Input id="targetPrice" type="number" inputMode="decimal" step="0.01" min={0} value={brief.targetPrice ?? ""} onChange={(e) => set("targetPrice", e.target.value)} />
              </Field>
              <Field label="PVP previsto (€)" htmlFor="rrp" recommended highlight={hl("rrp")}>
                <Input id="rrp" type="number" inputMode="decimal" step="0.01" min={0} value={brief.rrp ?? ""} onChange={(e) => set("rrp", e.target.value)} />
              </Field>
              <div className="hidden sm:block" />
              <Field label="Quién aporta el diseño" required error={errorFor("designBy")} highlight={hl("designBy")}>
                <SupplierChips value={brief.designBy} onChange={(v) => set("designBy", v)} label="Diseño" />
              </Field>
              <Field label="Quién aporta el packaging" required error={errorFor("packagingBy")} highlight={hl("packagingBy")}>
                <SupplierChips value={brief.packagingBy} onChange={(v) => set("packagingBy", v)} label="Packaging" />
              </Field>
              <Field label="Idiomas de etiquetado" recommended highlight={hl("languages")} className="sm:col-span-2">
                <ChipGroup options={opts("language")} value={brief.languages ?? []} onChange={(v) => set("languages", v)} ariaLabel="Idiomas" />
              </Field>
            </section>
          )}

          {step === 2 && briefType === "MP" && (
            <section className="grid gap-5 sm:grid-cols-2">
              <Field label="Marca" required error={errorFor("brandId")} highlight={hl("brandId")} className="sm:col-span-2">
                <ChipGroup
                  multiple={false}
                  options={props.brands.map((b) => ({ value: String(b.id), label: b.name }))}
                  value={brief.brandId ? [String(brief.brandId)] : []}
                  onChange={(v) => set("brandId", v[0] ? Number(v[0]) : undefined)}
                  ariaLabel="Marca"
                />
              </Field>
              <Field label="Línea / colección" htmlFor="line">
                <Input id="line" value={brief.line ?? ""} onChange={(e) => set("line", e.target.value)} />
              </Field>
              <Field label="Origen" htmlFor="origin" required error={errorFor("origin")} highlight={hl("origin")}>
                <Select id="origin" value={brief.origin ?? ""} onChange={(e) => set("origin", e.target.value)}>
                  <option value="">Selecciona…</option>
                  {opts("mp_origin").map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </Select>
              </Field>
              {brief.origin === "otro" && (
                <Field label="Detalle del origen" htmlFor="originText" className="sm:col-span-2">
                  <Input id="originText" value={brief.originText ?? ""} onChange={(e) => set("originText", e.target.value)} />
                </Field>
              )}
              <Field label="Cliente/retailer vinculado" hint="Opcional. Vincula al comercial de la cuenta para las notificaciones." className="sm:col-span-2">
                <ClientPicker
                  value={parsed.linkedClientId}
                  selected={parsed.linkedClientId ? (clients[parsed.linkedClientId] ?? null) : null}
                  allowNew={false}
                  countries={opts("market")}
                  onSelect={(c) => {
                    if (c) setClients((m) => ({ ...m, [c.id]: c }));
                    set("linkedClientId", c?.id);
                  }}
                  onNewClient={() => undefined}
                />
              </Field>
              <MarketsAndChannels brief={brief} set={set} opts={opts} errorFor={errorFor} hl={hl} />
              <Field label="PVP objetivo (€)" htmlFor="rrp" recommended highlight={hl("rrp")}>
                <Input id="rrp" type="number" inputMode="decimal" step="0.01" min={0} value={brief.rrp ?? ""} onChange={(e) => set("rrp", e.target.value)} />
              </Field>
              <Field label="Unidades estimadas (primer año)" htmlFor="annualUnits" recommended highlight={hl("annualUnits")}>
                <Input id="annualUnits" type="number" inputMode="numeric" min={0} value={brief.annualUnits ?? ""} onChange={(e) => set("annualUnits", e.target.value)} />
              </Field>
              <Field label="Justificación / oportunidad" htmlFor="justification" required error={errorFor("justification")} highlight={hl("justification")} className="sm:col-span-2">
                <Textarea id="justification" rows={4} value={brief.justification ?? ""} onChange={(e) => set("justification", e.target.value)} />
              </Field>
            </section>
          )}

          {step === 3 && !parsed.category && <EmptyStep onBack={() => go(1)} text="Elige primero la categoría (paso 1)." />}

          {step === 3 && parsed.category && (
            <section className="flex flex-col gap-5">
              <div className="grid gap-5 sm:grid-cols-2">
                <Field label="Formato" required error={errorFor("format")} highlight={hl("format")} className="sm:col-span-2">
                  <ChipGroup
                    multiple={false}
                    options={opts(`format_${parsed.category}`)}
                    value={brief.format ? [brief.format] : []}
                    onChange={(v) => set("format", v[0])}
                    ariaLabel="Formato"
                  />
                </Field>
                {brief.format === "otro" && (
                  <Field label="¿Qué formato?" htmlFor="formatOther" required error={errorFor("formatOther")}>
                    <Input id="formatOther" value={brief.formatOther ?? ""} onChange={(e) => set("formatOther", e.target.value)} />
                  </Field>
                )}
                <Field label="Capacidad (ml)" htmlFor="capacityMl" recommended highlight={hl("capacityMl")}>
                  <Input id="capacityMl" type="number" inputMode="decimal" min={0} value={brief.capacityMl ?? ""} onChange={(e) => set("capacityMl", e.target.value)} />
                </Field>
                {parsed.category === "ambient" && (
                  <Field label="Duración / rendimiento deseado" htmlFor="performance" recommended highlight={hl("performance")}>
                    <Input id="performance" value={brief.performance ?? ""} onChange={(e) => set("performance", e.target.value)} placeholder="p. ej. 8 semanas" />
                  </Field>
                )}
              </div>

              {parsed.category === "cosmetic" && (
                <div className="grid gap-5 sm:grid-cols-2">
                  <Field label="Función y claims deseados" recommended highlight={hl("functions")} className="sm:col-span-2">
                    <ChipGroup options={opts("cosmetic_function").map((o) => ({ value: o.label, label: o.label }))} value={brief.functions ?? []} onChange={(v) => set("functions", v)} ariaLabel="Funciones" />
                    <Input className="mt-2" value={brief.claimsText ?? ""} onChange={(e) => set("claimsText", e.target.value)} placeholder="Otros claims (texto libre)" aria-label="Otros claims" />
                  </Field>
                  <Field label="Tipo de piel / cabello" htmlFor="skin" recommended highlight={hl("skinHairType")}>
                    <Input id="skin" value={brief.skinHairType ?? ""} onChange={(e) => set("skinHairType", e.target.value)} placeholder="p. ej. piel sensible" />
                  </Field>
                  <Field label="Textura deseada" htmlFor="texture" recommended highlight={hl("texture")}>
                    <Input id="texture" value={brief.texture ?? ""} onChange={(e) => set("texture", e.target.value)} placeholder="p. ej. ligera, no grasa" />
                  </Field>
                  <Field label="Público" recommended highlight={hl("audience")}>
                    <ChipGroup
                      options={[
                        { value: "Adulto", label: "Adulto" },
                        { value: "Infantil", label: "Infantil" },
                        { value: "Bebé", label: "Bebé" },
                      ]}
                      value={brief.audience ?? []}
                      onChange={(v) => set("audience", v)}
                      ariaLabel="Público"
                    />
                  </Field>
                  <Field label="¿Lleva perfume?" required error={errorFor("hasPerfume")} highlight={hl("hasPerfume")}>
                    <ChipGroup
                      multiple={false}
                      options={[
                        { value: "si", label: "Sí" },
                        { value: "no", label: "No" },
                      ]}
                      value={brief.hasPerfume == null ? [] : [brief.hasPerfume ? "si" : "no"]}
                      onChange={(v) => set("hasPerfume", v[0] ? v[0] === "si" : undefined)}
                      ariaLabel="¿Lleva perfume?"
                    />
                  </Field>
                  <Field label="Ingredientes deseados" htmlFor="ingW">
                    <Textarea id="ingW" rows={2} value={brief.ingredientsWanted ?? ""} onChange={(e) => set("ingredientsWanted", e.target.value)} />
                  </Field>
                  <Field label="Ingredientes a evitar" htmlFor="ingA">
                    <Textarea id="ingA" rows={2} value={brief.ingredientsAvoid ?? ""} onChange={(e) => set("ingredientsAvoid", e.target.value)} />
                  </Field>
                </div>
              )}

              {needsOlfactory(parsed) && (
                <>
                  <OlfactoryFields
                    value={(brief.olfactory ?? {}) as OlfactoryState}
                    onChange={(v) => set("olfactory", v as BriefInput["olfactory"])}
                    families={opts("olfactory_family")}
                    highlight={hl}
                    errorFor={errorFor}
                    inspirationUpload={
                      <Uploader
                        projectId={project.id}
                        phase={0}
                        initial={inspirationFiles}
                        maxMb={props.settings.max_file_mb}
                        onChange={setInspirationFiles}
                        defaultTag="inspiracion"
                        showTags={false}
                        compact
                      />
                    }
                    blacklistUpload={
                      <Uploader
                        projectId={project.id}
                        phase={0}
                        initial={blacklistFiles}
                        maxMb={props.settings.max_file_mb}
                        onChange={setBlacklistFiles}
                        defaultTag="blacklist"
                        showTags={false}
                        compact
                      />
                    }
                  />
                </>
              )}
            </section>
          )}

          {step === 4 && (
            <section className="flex flex-col gap-5">
              <Field label="Adjuntos" hint="Moodboards, referencias, brief del cliente, packaging… Se guardarán en la carpeta SharePoint del proyecto (00 Solicitud).">
                <Uploader projectId={project.id} phase={0} initial={files} maxMb={props.settings.max_file_mb} onChange={setFiles} defaultTag="referencia" />
              </Field>
              <Field label="Notas adicionales" htmlFor="notes" highlight={hl("notes")}>
                <Textarea id="notes" rows={5} value={brief.notes ?? ""} onChange={(e) => set("notes", e.target.value)} />
              </Field>
            </section>
          )}

          {step === 5 && (
            <section className="flex flex-col gap-5">
              {Object.keys(reqErrors).length > 0 && (
                <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
                  <p className="font-semibold">Faltan campos obligatorios para enviar:</p>
                  <ul className="mt-1 list-inside list-disc">
                    {Object.entries(reqErrors).map(([k, msg]) => (
                      <li key={k}>
                        <button type="button" className="underline" onClick={() => go(FIELD_BY_KEY[k]?.step ?? (k === "formatOther" ? 3 : 1))}>
                          {msg}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {completeness < props.settings.completeness_threshold && recommendedMissing.length > 0 && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                  <p className="font-semibold">
                    Completitud del {completeness}% (recomendado ≥ {props.settings.completeness_threshold}%). Puedes enviar igualmente, pero ayudarás a
                    decidir antes si completas:
                  </p>
                  <p className="mt-1">
                    {recommendedMissing.map((f, i) => (
                      <React.Fragment key={f.key}>
                        {i > 0 && ", "}
                        <button type="button" className="underline" onClick={() => go(f.step)}>
                          {f.label}
                        </button>
                      </React.Fragment>
                    ))}
                  </p>
                </div>
              )}
              {briefSections(parsed, lookups).map((s) => (
                <div key={s.title} className="rounded-lg border border-slate-200">
                  <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50 px-4 py-2">
                    <h3 className="text-sm font-semibold text-slate-800">{s.title}</h3>
                    <button type="button" className="text-xs text-brand-700 hover:underline" onClick={() => go(s.step)}>
                      Editar
                    </button>
                  </div>
                  <dl className="grid gap-x-6 gap-y-2 px-4 py-3 text-sm sm:grid-cols-2">
                    {s.rows.map(([label, v]) => (
                      <div key={label} className="min-w-0">
                        <dt className="text-xs text-slate-500">{label}</dt>
                        <dd className={cn("break-words", v ? "text-slate-900" : "text-slate-300")}>{v ?? "—"}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              ))}
              <div className="rounded-lg border border-slate-200 px-4 py-3 text-sm">
                <p className="text-xs text-slate-500">Adjuntos</p>
                <p>{files.length || inspirationFiles.length || blacklistFiles.length ? [...files, ...inspirationFiles, ...blacklistFiles].map((f) => f.name).join(", ") : "—"}</p>
              </div>
              {props.canAnswer && (
                <Field label="Respuesta a la petición de información" htmlFor="answer" required error={serverErrors.answer}>
                  <Textarea id="answer" rows={4} value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder="Explica qué has completado o aclarado…" />
                </Field>
              )}
            </section>
          )}
        </div>

        {/* Pie con navegación */}
        <footer className="flex shrink-0 items-center gap-2 border-t border-slate-200 bg-slate-50 px-4 py-3 sm:px-6">
          {isDraft && step === 1 && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-rose-600 hover:bg-rose-50"
              onClick={async () => {
                if (!confirm("¿Eliminar este borrador y sus adjuntos?")) return;
                const r = await deleteDraftAction(project.id);
                if (r.ok) {
                  setDirty(false);
                  router.push("/");
                } else toast.error(r.error);
              }}
            >
              <Trash2 /> <span className="hidden sm:inline">Eliminar borrador</span>
            </Button>
          )}
          {step > 1 && (
            <Button type="button" variant="secondary" onClick={() => go(step - 1)}>
              <ChevronLeft /> Anterior
            </Button>
          )}
          <div className="ml-auto flex gap-2">
            {!isDraft && step < 5 && (
              <Button type="button" variant="secondary" disabled={submitting || !dirty} onClick={() => handleSaveEdit(false)}>
                Guardar cambios
              </Button>
            )}
            {step < 5 ? (
              <Button type="button" onClick={() => go(step + 1)}>
                Siguiente <ChevronRight />
              </Button>
            ) : isDraft ? (
              <Button type="button" onClick={handleSubmit} disabled={submitting}>
                {submitting ? <Loader2 className="animate-spin" /> : <Send />} Enviar solicitud
              </Button>
            ) : props.canAnswer ? (
              <Button type="button" onClick={() => handleSaveEdit(true)} disabled={submitting || !answer.trim()}>
                {submitting ? <Loader2 className="animate-spin" /> : <Send />} Guardar y responder
              </Button>
            ) : (
              <Button type="button" onClick={() => handleSaveEdit(false)} disabled={submitting}>
                {submitting ? <Loader2 className="animate-spin" /> : <Check />} Guardar cambios
              </Button>
            )}
          </div>
        </footer>
      </div>
    </div>
  );
}

function SaveIndicator({ state, dirty, isDraft }: { state: SaveState; dirty: boolean; isDraft: boolean }) {
  if (!isDraft) return dirty ? <span className="hidden text-xs text-amber-700 sm:inline">Cambios sin guardar</span> : null;
  if (state === "saving")
    return (
      <span className="flex items-center gap-1 text-xs text-slate-500">
        <Loader2 className="size-3 animate-spin" /> Guardando…
      </span>
    );
  if (state === "error")
    return (
      <span className="flex items-center gap-1 text-xs text-rose-600">
        <CloudOff className="size-3" /> Error al guardar
      </span>
    );
  if (state === "saved" && !dirty)
    return (
      <span className="flex items-center gap-1 text-xs text-emerald-700">
        <Check className="size-3" /> Borrador guardado
      </span>
    );
  return null;
}

function EmptyStep({ text, onBack }: { text: string; onBack: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 py-16 text-center text-sm text-slate-500">
      <p>{text}</p>
      <Button variant="secondary" onClick={onBack}>
        Ir al paso 1
      </Button>
    </div>
  );
}

function SupplierChips({ value, onChange, label }: { value?: string; onChange: (v: "cliente" | "natu" | "mixto" | undefined) => void; label: string }) {
  return (
    <ChipGroup
      multiple={false}
      options={[
        { value: "cliente", label: "Cliente" },
        { value: "natu", label: "NATU" },
        { value: "mixto", label: "Mixto" },
      ]}
      value={value ? [value] : []}
      onChange={(v) => onChange(v[0] as "cliente" | "natu" | "mixto" | undefined)}
      ariaLabel={label}
    />
  );
}

function MarketsAndChannels({
  brief,
  set,
  opts,
  errorFor,
  hl,
}: {
  brief: BriefInput;
  set: <K extends keyof BriefInput>(k: K, v: BriefInput[K]) => void;
  opts: (k: string) => Option[];
  errorFor: (k: string) => string | undefined;
  hl: (k: string) => boolean;
}) {
  return (
    <>
      <Field label="Mercados de venta" required error={errorFor("markets")} highlight={hl("markets")} className="sm:col-span-2">
        <ChipGroup options={opts("market")} value={brief.markets ?? []} onChange={(v) => set("markets", v)} ariaLabel="Mercados" />
      </Field>
      <Field label="Canal" required error={errorFor("channels")} highlight={hl("channels")} className="sm:col-span-2">
        <ChipGroup options={opts("channel")} value={brief.channels ?? []} onChange={(v) => set("channels", v)} ariaLabel="Canal" />
      </Field>
    </>
  );
}
