import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { db } from "@/db";
import { clients, files, infoRequests, projects, users } from "@/db/schema";
import { Wizard } from "@/components/wizard/wizard";
import { canEditBrief, requireUser } from "@/lib/server/authz";
import { getActiveUsers, getAllCatalogs, getBrands } from "@/lib/server/catalogs";
import { getSettings } from "@/lib/server/settings";

export const metadata = { title: "Solicitud" };

export default async function WizardPage({ params }: PageProps<"/solicitudes/[id]">) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const u = await requireUser();
  const [p] = await db.select().from(projects).where(eq(projects.id, id));
  if (!p) notFound();
  if (!canEditBrief(u, p)) redirect(p.status === "draft" ? "/" : `/proyectos/${id}`);

  const clientIds = [p.brief.clientId, p.brief.linkedClientId].filter((x): x is number => !!x);
  const [catalogs, brands, activeUsers, settings, clientRows, fileRows, requester, openIr] = await Promise.all([
    getAllCatalogs(),
    getBrands(),
    getActiveUsers(),
    getSettings(),
    clientIds.length ? db.select({ id: clients.id, name: clients.name, country: clients.country }).from(clients).where(inArray(clients.id, clientIds)) : [],
    db.select().from(files).where(eq(files.projectId, id)).orderBy(files.createdAt),
    db.select({ id: users.id, name: users.name }).from(users).where(eq(users.id, p.requesterId)),
    db
      .select({ ir: infoRequests, by: users.name })
      .from(infoRequests)
      .innerJoin(users, eq(users.id, infoRequests.requestedBy))
      .where(and(eq(infoRequests.projectId, id), isNull(infoRequests.answeredAt)))
      .orderBy(desc(infoRequests.requestedAt))
      .limit(1),
  ]);
  const ir = openIr[0];

  return (
    <Wizard
      project={{ id: p.id, status: p.status, code: p.code, createdAt: p.createdAt.toISOString() }}
      requester={requester[0]!}
      initialBrief={p.brief}
      catalogs={catalogs}
      brands={brands}
      users={activeUsers}
      clients={clientRows}
      files={fileRows.filter((f) => f.phase === 0).map((f) => ({ id: f.id, name: f.name, size: f.size, mime: f.mime, tag: f.tag }))}
      settings={{ completeness_threshold: settings.completeness_threshold, max_file_mb: settings.max_file_mb }}
      infoRequest={
        p.status === "info_requested" && ir
          ? { message: ir.ir.message, fieldsMissing: ir.ir.fieldsMissing, requestedBy: ir.by, requestedAt: ir.ir.requestedAt.toISOString() }
          : null
      }
      canAnswer={p.status === "info_requested" && (p.requesterId === u.id || p.accountManagerId === u.id)}
    />
  );
}
