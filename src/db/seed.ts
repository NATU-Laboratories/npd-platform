/**
 * Datos iniciales (idempotente). Uso:
 *   pnpm db:seed          → roles, departamentos, marcas, catálogos, ajustes, plantillas
 *   pnpm db:seed --demo   → además usuarios y clientes de ejemplo para desarrollo
 */
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import {
  BRAND_DEFAULTS,
  CATALOG_DEFAULTS,
  DEPARTMENT_DEFAULTS,
  parseCatalogValue,
  SETTINGS_DEFAULTS,
  type CatalogType,
} from "../lib/catalog-defaults";
import * as s from "./schema";

type TaskDef = { key: string; phase: number; dept: string; title: string; deps?: string[]; returns?: string; days?: number; optional?: boolean };

const concept: TaskDef[] = [
  { key: "c1", phase: 1, dept: "idi", title: "Viabilidad técnica", days: 5 },
  { key: "c2", phase: 1, dept: "regulatory", title: "Viabilidad regulatoria", days: 5 },
  { key: "c3", phase: 1, dept: "operaciones", title: "Escandallo inicial", days: 5 },
  { key: "c4", phase: 1, dept: "produccion", title: "Factibilidad de maquinaria", days: 3, optional: true },
  { key: "c5", phase: 1, dept: "marketing", title: "Estudio de competencia y posicionamiento", days: 7 },
  { key: "c6", phase: 1, dept: "idi", title: "Primeras muestras", deps: ["c1"], days: 10 },
];
const development: TaskDef[] = [
  { key: "d1", phase: 2, dept: "idi", title: "Fórmula y pruebas", days: 15 },
  { key: "d2", phase: 2, dept: "marketing", title: "Elección de envase", days: 7 },
  { key: "d3", phase: 2, dept: "idi", title: "Estabilidad y compatibilidad envase-fórmula", deps: ["d1", "d2"], days: 30 },
  { key: "d4", phase: 2, dept: "regulatory", title: "Claims y requisitos por país", days: 7 },
  { key: "d5", phase: 2, dept: "calidad", title: "Tests externos", deps: ["d1"], days: 20, optional: true },
];
const design: TaskDef[] = [
  { key: "a1", phase: 3, dept: "marketing", title: "Textos brutos (etiqueta/estuche)", days: 3 },
  { key: "a2", phase: 3, dept: "regulatory", title: "Revisión de textos (Regulatory + Calidad)", deps: ["a1"], returns: "a1", days: 3 },
  { key: "a3", phase: 3, dept: "comunicacion", title: "Adaptación de tono", deps: ["a2"], days: 2 },
  { key: "a4", phase: 3, dept: "diseno", title: "Artes finales", deps: ["a3"], days: 7 },
  { key: "a5", phase: 3, dept: "calidad", title: "Revisión AAFF (Calidad + Regulatory)", deps: ["a4"], returns: "a4", days: 3 },
  { key: "a6", phase: 3, dept: "comunicacion", title: "Traducciones", deps: ["a5"], days: 5 },
  { key: "a7", phase: 3, dept: "comercial", title: "Aprobación AAFF por el cliente", deps: ["a6"], days: 5 },
];
const production: TaskDef[] = [
  { key: "p1", phase: 4, dept: "compras", title: "Compra de materiales y envases", days: 20 },
  { key: "p2", phase: 4, dept: "operaciones", title: "Escandallo final", days: 3 },
  { key: "p3", phase: 4, dept: "calidad", title: "Documentación técnica", days: 5 },
  { key: "p4", phase: 4, dept: "operaciones", title: "Documentación logística", days: 3 },
  { key: "p5", phase: 4, dept: "produccion", title: "Planificación con Producción", deps: ["p1"], days: 3 },
];
const cosmeticReg: TaskDef[] = [
  { key: "r1", phase: 2, dept: "regulatory", title: "Evaluación de seguridad (CPSR)", deps: ["d1"], days: 15 },
  { key: "r2", phase: 4, dept: "regulatory", title: "Expediente de producto (PIF)", days: 10 },
  { key: "r3", phase: 4, dept: "regulatory", title: "Notificación previa a comercialización (CPNP)", deps: ["r2"], days: 3 },
];

const TEMPLATES: { name: string; appliesTo: { types?: string[]; subtypes?: string[]; categories?: string[] }; tasks: TaskDef[] }[] = [
  {
    name: "PL – Desarrollo completo",
    appliesTo: { types: ["PL"], subtypes: ["desarrollo_completo", "replica", "extension_gama"], categories: ["perfume", "ambient"] },
    tasks: [...concept, ...development, ...design, ...production],
  },
  {
    name: "PL – Fórmula de catálogo NATU con marca del cliente",
    appliesTo: { types: ["PL"], subtypes: ["formula_catalogo"] },
    tasks: [
      concept[2]!,
      { ...concept[1]!, title: "Revisión regulatoria del mercado destino" },
      { key: "d2", phase: 2, dept: "marketing", title: "Elección de envase", days: 5 },
      { key: "d3", phase: 2, dept: "idi", title: "Compatibilidad envase-fórmula", deps: ["d2"], days: 15 },
      ...design,
      ...production,
    ],
  },
  {
    name: "PL – Solo cambio de packaging/diseño",
    appliesTo: { types: ["PL"], subtypes: ["cambio_packaging"] },
    tasks: [concept[2]!, ...design, production[0]!, production[1]!, production[4]!],
  },
  {
    name: "Marca propia – Nuevo producto",
    appliesTo: { types: ["MP"], categories: ["perfume", "ambient"] },
    tasks: [...concept, ...development, ...design.filter((t) => t.key !== "a7"), ...production],
  },
  {
    name: "Cosmética (PL o MP) – regulatorio reforzado",
    appliesTo: { types: ["PL", "MP"], categories: ["cosmetic"] },
    tasks: [...concept, ...development, ...cosmeticReg, ...design, ...production],
  },
];

async function main() {
  const demo = process.argv.includes("--demo");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = drizzle(pool, { schema: s });

  await db.insert(s.roles).values(s.ROLE_KEYS.map((key) => ({ key }))).onConflictDoNothing();

  for (const [i, d] of DEPARTMENT_DEFAULTS.entries()) {
    await db
      .insert(s.departments)
      .values({ key: d.key, name: d.name, color: d.color, sort: i })
      .onConflictDoNothing({ target: s.departments.key });
  }
  await db.insert(s.brands).values(BRAND_DEFAULTS.map((name) => ({ name }))).onConflictDoNothing();

  for (const [type, values] of Object.entries(CATALOG_DEFAULTS) as [CatalogType, string[]][]) {
    await db
      .insert(s.catalogItems)
      .values(values.map((raw, sort) => ({ type, sort, ...parseCatalogValue(raw) })))
      .onConflictDoNothing();
  }
  for (const [key, value] of Object.entries(SETTINGS_DEFAULTS)) {
    await db.insert(s.settings).values({ key, value }).onConflictDoNothing();
  }

  const depts = Object.fromEntries((await db.select().from(s.departments)).map((d) => [d.key, d.id]));
  const existingTemplates = new Set((await db.select({ name: s.workflowTemplates.name }).from(s.workflowTemplates)).map((t) => t.name));
  for (const t of TEMPLATES) {
    if (existingTemplates.has(t.name)) continue;
    const [tpl] = await db.insert(s.workflowTemplates).values({ name: t.name, appliesTo: t.appliesTo }).returning();
    const ids: Record<string, number> = {};
    for (const [sort, task] of t.tasks.entries()) {
      const [row] = await db
        .insert(s.templateTasks)
        .values({
          templateId: tpl!.id,
          phase: task.phase,
          departmentId: depts[task.dept]!,
          title: task.title,
          isRequired: !task.optional,
          estDays: task.days ?? 5,
          sort,
        })
        .returning({ id: s.templateTasks.id });
      ids[task.key] = row!.id;
    }
    for (const task of t.tasks) {
      for (const dep of task.deps ?? []) {
        if (ids[dep]) await db.insert(s.templateTaskDeps).values({ taskId: ids[task.key]!, dependsOnTaskId: ids[dep] });
      }
      if (task.returns && ids[task.returns]) {
        await db.update(s.templateTasks).set({ canReturnToTaskId: ids[task.returns] }).where(eq(s.templateTasks.id, ids[task.key]!));
      }
    }
  }

  if (demo) await seedDemo(db, depts);
  console.log(`Seed completado${demo ? " (con datos demo)" : ""}.`);
  await pool.end();
}

async function seedDemo(db: ReturnType<typeof drizzle<typeof s>>, depts: Record<string, number>) {
  const roleIds = Object.fromEntries((await db.select().from(s.roles)).map((r) => [r.key, r.id]));
  const people: { email: string; name: string; roles: s.RoleKey[]; depts: string[]; decider?: ("PL" | "MP")[] }[] = [
    { email: "admin@natu.test", name: "Irene Admin", roles: ["admin"], depts: [] },
    { email: "comercial@natu.test", name: "Carlos Comercial", roles: ["requester"], depts: ["comercial"] },
    { email: "marketing@natu.test", name: "Marta Marketing", roles: ["requester", "decider", "dept_member"], depts: ["marketing"], decider: ["PL", "MP"] },
    { email: "idi@natu.test", name: "Luis Laboratorio", roles: ["dept_member"], depts: ["idi"] },
    { email: "calidad@natu.test", name: "Carmen Calidad", roles: ["dept_member"], depts: ["calidad"] },
    { email: "direccion@natu.test", name: "Diego Dirección", roles: ["global_reader", "requester"], depts: ["direccion"] },
  ];
  for (const p of people) {
    const [found] = await db.select({ id: s.users.id }).from(s.users).where(sql`lower(${s.users.email}) = ${p.email}`);
    const [u] = found
      ? [found]
      : await db.insert(s.users).values({ email: p.email, name: p.name, status: "active", isActive: true }).returning({ id: s.users.id });
    for (const r of p.roles) await db.insert(s.userRoles).values({ userId: u!.id, roleId: roleIds[r]! }).onConflictDoNothing();
    for (const d of p.depts) await db.insert(s.departmentMembers).values({ userId: u!.id, departmentId: depts[d]! }).onConflictDoNothing();
    for (const t of p.decider ?? []) await db.insert(s.gateDeciders).values({ gate: "G1", projectType: t, userId: u!.id }).onConflictDoNothing();
  }
  for (const key of Object.keys(depts)) {
    await db
      .update(s.departments)
      .set({ notifyEmails: [`${key}@natu.test`] })
      .where(eq(s.departments.key, key));
  }
  const existing = await db.select({ id: s.clients.id }).from(s.clients).limit(1);
  if (!existing.length) {
    await db.insert(s.clients).values([
      { name: "Supermercados Levante", country: "ES", contact: "compras@levante.test" },
      { name: "Drogerie Nord GmbH", country: "DE", contact: "einkauf@nord.test" },
      { name: "Farmacias Atlántico", country: "PT", contact: "geral@atlantico.test" },
      { name: "Maison Parfums SARL", country: "FR", contact: "achats@maison.test" },
    ]);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
