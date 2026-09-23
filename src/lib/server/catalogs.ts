import "server-only";
import { and, asc, eq, ilike, or } from "drizzle-orm";
import { db } from "@/db";
import { brands, catalogItems, clients, departments, users, workflowTemplates } from "@/db/schema";
import { CATALOG_TYPES, type CatalogType, type Option } from "@/lib/catalog-defaults";

export async function getCatalog(type: CatalogType): Promise<Option[]> {
  const rows = await db
    .select({ value: catalogItems.value, label: catalogItems.label })
    .from(catalogItems)
    .where(and(eq(catalogItems.type, type), eq(catalogItems.isActive, true)))
    .orderBy(asc(catalogItems.sort), asc(catalogItems.label));
  return rows;
}

export type Catalogs = Record<CatalogType, Option[]>;

export async function getAllCatalogs(): Promise<Catalogs> {
  const rows = await db
    .select({ type: catalogItems.type, value: catalogItems.value, label: catalogItems.label })
    .from(catalogItems)
    .where(eq(catalogItems.isActive, true))
    .orderBy(asc(catalogItems.sort), asc(catalogItems.label));
  const out = Object.fromEntries(Object.keys(CATALOG_TYPES).map((k) => [k, [] as Option[]])) as Catalogs;
  for (const r of rows) out[r.type as CatalogType]?.push({ value: r.value, label: r.label });
  return out;
}

/** Mapa value → label de todos los catálogos, para mostrar valores guardados. */
export async function getCatalogLabels() {
  const rows = await db.select({ type: catalogItems.type, value: catalogItems.value, label: catalogItems.label }).from(catalogItems);
  const map: Record<string, Record<string, string>> = {};
  for (const r of rows) (map[r.type] ??= {})[r.value] = r.label;
  return map;
}

export async function getBrands(activeOnly = true) {
  return db
    .select({ id: brands.id, name: brands.name, isActive: brands.isActive })
    .from(brands)
    .where(activeOnly ? eq(brands.isActive, true) : undefined)
    .orderBy(asc(brands.name));
}

export async function getDepartments(activeOnly = true) {
  return db
    .select()
    .from(departments)
    .where(activeOnly ? eq(departments.isActive, true) : undefined)
    .orderBy(asc(departments.sort), asc(departments.name));
}

export async function getActiveUsers() {
  return db
    .select({ id: users.id, name: users.name, email: users.email })
    .from(users)
    .where(eq(users.status, "active"))
    .orderBy(asc(users.name));
}

export async function searchClients(q: string, limit = 20) {
  const term = `%${q.trim()}%`;
  return db
    .select({ id: clients.id, name: clients.name, country: clients.country })
    .from(clients)
    .where(q.trim() ? or(ilike(clients.name, term), ilike(clients.externalRef, term)) : undefined)
    .orderBy(asc(clients.name))
    .limit(limit);
}

export async function getTemplates() {
  return db.select().from(workflowTemplates).where(eq(workflowTemplates.isActive, true)).orderBy(asc(workflowTemplates.id));
}
