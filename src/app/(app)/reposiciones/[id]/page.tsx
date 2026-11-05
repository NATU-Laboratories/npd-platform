import { asc, eq } from "drizzle-orm";
import { ArrowLeft, Check } from "lucide-react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { db } from "@/db";
import { suppliers } from "@/db/schema";
import { RepActions } from "@/components/replenishment/rep-actions";
import { RepCommentBox, RepFiles } from "@/components/replenishment/rep-files";
import { RepItems } from "@/components/replenishment/rep-items";
import { Card } from "@/components/ui/card";
import { REP_ACTION_LABEL, REP_STATUS_COLOR, REP_STATUS_LABEL, REPLENISHMENT_TEMPLATES, STATUS_STEPS } from "@/lib/replenishment/config";
import { isAdmin, requireUser } from "@/lib/server/authz";
import { canAccessReplenishments, canActAs, loadReplenishment } from "@/lib/server/replenishments";
import { cn, formatDate } from "@/lib/utils";

export const metadata = { title: "Reposición" };

const WHO: Record<string, string> = { diseno: "Diseño", calidad: "Calidad", compras: "Compras" };

export default async function ReplenishmentPage({ params }: PageProps<"/reposiciones/[id]">) {
  const u = await requireUser();
  if (!canAccessReplenishments(u)) redirect("/");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const d = await loadReplenishment(u, id);
  if (!d) notFound();
  const r = d.rep;
  const supplierList = await db.select({ id: suppliers.id, name: suppliers.name, emails: suppliers.emails }).from(suppliers).where(eq(suppliers.isActive, true)).orderBy(asc(suppliers.name));
  const open = !["closed", "cancelled"].includes(r.status);
  const isCompras = canActAs(u, r, "compras");
  const isDesign = canActAs(u, r, "diseno");
  // Paso actual en el stepper (las correcciones son una vuelta de la revisión de diseño)
  const steps = STATUS_STEPS.filter((s) => s.key !== "design_changes" || r.status === "design_changes" || r.round > 1);
  const currentIdx = steps.findIndex((s) => s.key === r.status);
  const current = STATUS_STEPS.find((s) => s.key === r.status);

  return (
    <div className="flex flex-col gap-4">
      <Link href="/reposiciones" className="inline-flex items-center gap-1 self-start text-sm text-slate-500 hover:text-slate-800">
        <ArrowLeft className="size-4" /> Reposiciones
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-brand-500">
            {r.code} · Reposición · {REPLENISHMENT_TEMPLATES[r.template as keyof typeof REPLENISHMENT_TEMPLATES]?.label ?? r.template}
          </p>
          <h1 className="text-xl font-semibold text-slate-900">{r.title}</h1>
          <p className="mt-0.5 text-sm text-slate-500">
            Abierta por {d.requesterName} el {formatDate(r.createdAt)}
            {r.round > 1 && ` · ronda de diseño ${r.round}`}
          </p>
        </div>
        <span className={cn("rounded-full px-3 py-1 text-sm ring-1", REP_STATUS_COLOR[r.status])}>{REP_STATUS_LABEL[r.status]}</span>
      </div>

      {r.status !== "cancelled" && (
        <Card className="p-4">
          <ol className="flex flex-wrap items-center gap-y-2">
            {steps.map((s, i) => {
              const done = r.status === "closed" || i < currentIdx;
              const now = i === currentIdx && r.status !== "closed";
              return (
                <li key={s.key} className="flex items-center" aria-current={now ? "step" : undefined}>
                  <span
                    className={cn(
                      "flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs",
                      done && "bg-brand-500 text-white",
                      now && "bg-natu-dark font-semibold text-white",
                      !done && !now && "bg-slate-100 text-slate-500",
                    )}
                  >
                    {done && <Check className="size-3.5" />}
                    {s.label}
                    {s.dept && <span className="opacity-70">· {WHO[s.dept]}</span>}
                  </span>
                  {i < steps.length - 1 && <span className="mx-1 h-px w-4 bg-slate-300" aria-hidden />}
                </li>
              );
            })}
          </ol>
          {open && (
            <div className="mt-4 border-t border-slate-100 pt-4">
              {d.actions.filter((a) => a !== "cancel").length ? (
                <p className="mb-2 text-sm font-medium text-slate-800">Te toca: {current?.label}</p>
              ) : (
                <p className="mb-2 text-sm text-slate-500">
                  Ahora le toca a <strong>{current?.dept ? WHO[current.dept] : "—"}</strong> ({current?.label.toLowerCase()}).
                </p>
              )}
              <RepActions id={r.id} actions={d.actions} />
            </div>
          )}
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_22rem]">
        <div className="flex min-w-0 flex-col gap-4">
          <Card className="p-4">
            <h2 className="mb-2 text-sm font-semibold text-slate-900">Elementos a reponer y proveedores</h2>
            <RepItems
              id={r.id}
              canEdit={isCompras && open}
              suppliers={supplierList}
              items={d.itemRows.map((i) => {
                const s = d.supplierRows.find((x) => x.id === i.supplierId);
                return {
                  id: i.id,
                  element: i.element,
                  description: i.description,
                  quantity: i.quantity,
                  supplierId: i.supplierId,
                  supplierName: s?.name ?? null,
                  supplierEmails: s?.emails ?? [],
                  quoteStatus: i.quoteStatus,
                  quotePrice: i.quotePrice,
                  quoteNotes: i.quoteNotes,
                  quoteRequestedAt: i.quoteRequestedAt?.toISOString() ?? null,
                  quoteReceivedAt: i.quoteReceivedAt?.toISOString() ?? null,
                };
              })}
            />
          </Card>

          <Card className="p-4">
            <h2 className="mb-2 text-sm font-semibold text-slate-900">Arte final y archivos</h2>
            <RepFiles
              id={r.id}
              round={r.round}
              canUpload={open}
              canDeleteAll={isAdmin(u)}
              defaultTag={isDesign && ["design_review", "design_changes"].includes(r.status) ? "arte_final" : isCompras ? "cotizacion" : "otro"}
              files={d.files.map(({ f, by }) => ({ id: f.id, name: f.name, size: f.size, tag: f.tag, round: f.round, by, createdAt: f.createdAt.toISOString(), mine: f.uploadedBy === u.id, url: f.url }))}
            />
          </Card>

          <Card className="p-4">
            <h2 className="mb-3 text-sm font-semibold text-slate-900">Comentarios e historial</h2>
            <RepCommentBox id={r.id} />
            <ul className="mt-4 flex flex-col gap-3">
              {d.activity.map(({ a, who }) => {
                const diff = (a.diff ?? {}) as Record<string, unknown>;
                const isComment = a.action === "replenishment.comment";
                return (
                  <li key={a.id} className="text-sm">
                    <p className="text-slate-700">
                      <strong className="font-medium text-slate-900">{who ?? "Sistema"}</strong> {REP_ACTION_LABEL[a.action] ?? a.action}
                      <span className="ml-1 text-xs text-slate-400">{formatDate(a.createdAt, true)}</span>
                    </p>
                    {isComment && <p className="mt-0.5 whitespace-pre-line rounded-md bg-slate-50 px-3 py-2 text-slate-800">{String(diff.body ?? "")}</p>}
                    {Array.isArray(diff.corrections) ? (
                      <ol className="mt-1 flex flex-col gap-2 rounded-md bg-amber-50 px-3 py-2">
                        {(diff.corrections as { text: string; fileIds: number[] }[]).map((c, n) => (
                          <li key={n} className="text-slate-800">
                            <p className="whitespace-pre-line">
                              <strong className="font-semibold">{n + 1}.</strong> {c.text}
                            </p>
                            {c.fileIds.length > 0 && (
                              <div className="mt-1.5 flex flex-wrap gap-2">
                                {c.fileIds.map((fid) => (
                                  <a key={fid} href={`/api/rep-files/${fid}`} target="_blank" rel="noreferrer" className="block size-20 overflow-hidden rounded-md bg-white ring-1 ring-amber-200 hover:ring-amber-400" title="Abrir la captura">
                                    {/* eslint-disable-next-line @next/next/no-img-element -- archivo servido por la ruta protegida */}
                                    <img src={`/api/rep-files/${fid}`} alt={`Captura de la corrección ${n + 1}`} className="size-full object-cover" loading="lazy" />
                                  </a>
                                ))}
                              </div>
                            )}
                          </li>
                        ))}
                      </ol>
                    ) : (
                      !isComment && typeof diff.comment === "string" && diff.comment && <p className="mt-0.5 whitespace-pre-line rounded-md bg-amber-50 px-3 py-2 text-slate-800">{diff.comment}</p>
                    )}
                    {a.action === "replenishment.quote_requested" && Array.isArray(diff.suppliers) && <p className="text-xs text-slate-500">A: {(diff.suppliers as string[]).join(", ")}</p>}
                  </li>
                );
              })}
            </ul>
          </Card>
        </div>

        <Card className="h-fit p-4">
          <h2 className="mb-2 text-sm font-semibold text-slate-900">Datos de la reposición</h2>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-sm">
            {(
              [
                ["Producto", r.productName],
                ["Referencia / EAN", r.productRef],
                ["Cliente / marca", r.clientOrBrand],
                ["Fecha necesaria", r.neededBy ? formatDate(r.neededBy) : null],
                ["Solicitante", d.requesterName],
              ] as [string, string | null][]
            ).map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-slate-500">{k}</dt>
                <dd className="text-slate-800">{v || "—"}</dd>
              </div>
            ))}
            <dt className="text-slate-500">Proyecto NPD</dt>
            <dd>
              {d.npd ? (
                <Link href={`/proyectos/${d.npd.id}`} className="text-brand-600 underline underline-offset-2">
                  {d.npd.code} · {d.npd.name}
                </Link>
              ) : (
                "—"
              )}
            </dd>
          </dl>
          {r.notes && (
            <div className="mt-3">
              <p className="text-xs font-medium text-slate-500">Notas</p>
              <p className="whitespace-pre-line text-sm text-slate-800">{r.notes}</p>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
