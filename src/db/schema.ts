import { sql } from "drizzle-orm";
import {
  boolean,
  customType,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { BriefData } from "@/lib/brief/schema";

// ─── Enums ────────────────────────────────────────────────────────────────

export const userStatus = pgEnum("user_status", ["pending", "active", "disabled"]);
export const notifPref = pgEnum("notif_pref", ["immediate", "daily"]);
export const projectType = pgEnum("project_type", ["PL", "MP", "MDD"]);
export const projectCategory = pgEnum("project_category", ["perfume", "ambient", "cosmetic"]);
export const projectStatus = pgEnum("project_status", [
  "draft",
  "submitted",
  "info_requested",
  "in_progress",
  "paused",
  "in_production",
  "rejected",
  "cancelled",
]);
export const priority = pgEnum("priority", ["low", "medium", "high", "urgent"]);
export const gateKey = pgEnum("gate_key", ["G1", "G2", "G3", "G4", "G5"]);
export const gateStatus = pgEnum("gate_status", [
  "pending",
  "approved",
  "info_requested",
  "rejected",
  "paused",
  "recycled",
  "forced",
]);
export const taskStatus = pgEnum("task_status", [
  "pendiente",
  "bloqueada",
  "en_curso",
  "en_revision",
  "devuelta",
  "esperando_cliente",
  "completada",
  "no_aplica",
]);
export const jobStatus = pgEnum("job_status", ["pending", "running", "done", "failed"]);
export const notificationStatus = pgEnum("notification_status", ["pending", "sent", "failed"]);

export const ROLE_KEYS = ["admin", "global_decider", "requester", "decider", "dept_member", "global_reader"] as const;
export type RoleKey = (typeof ROLE_KEYS)[number];

// ─── Users, roles, departments ────────────────────────────────────────────

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    entraOid: text("entra_oid").unique(),
    email: text("email").notNull(),
    name: text("name").notNull(),
    isActive: boolean("is_active").notNull().default(false),
    status: userStatus("status").notNull().default("pending"),
    notifPref: notifPref("notif_pref").notNull().default("immediate"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("users_email_idx").on(sql`lower(${t.email})`)],
);

export const roles = pgTable("roles", {
  id: serial("id").primaryKey(),
  key: text("key").$type<RoleKey>().notNull().unique(),
});

export const userRoles = pgTable(
  "user_roles",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    roleId: integer("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.userId, t.roleId] })],
);

export const departments = pgTable("departments", {
  id: serial("id").primaryKey(),
  key: text("key").unique(),
  name: text("name").notNull(),
  color: text("color").notNull().default("#64748b"),
  notifyEmails: text("notify_emails").array().notNull().default(sql`'{}'::text[]`),
  leadUserId: uuid("lead_user_id").references(() => users.id, { onDelete: "set null" }),
  isActive: boolean("is_active").notNull().default(true),
  sort: integer("sort").notNull().default(0),
});

export const departmentMembers = pgTable(
  "department_members",
  {
    departmentId: integer("department_id")
      .notNull()
      .references(() => departments.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.departmentId, t.userId] })],
);

/** Matriz puerta × tipo de proyecto → usuarios decisores (configurable, §2.1). */
export const gateDeciders = pgTable(
  "gate_deciders",
  {
    gate: gateKey("gate").notNull(),
    projectType: projectType("project_type").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.gate, t.projectType, t.userId] })],
);

// ─── Catálogos ────────────────────────────────────────────────────────────

export const brands = pgTable("brands", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  isActive: boolean("is_active").notNull().default(true),
});

export const clients = pgTable("clients", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  country: text("country"),
  contact: text("contact"),
  accountManagerUserId: uuid("account_manager_user_id").references(() => users.id, {
    onDelete: "set null",
  }),
  externalRef: text("external_ref"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const catalogItems = pgTable(
  "catalog_items",
  {
    id: serial("id").primaryKey(),
    type: text("type").notNull(),
    value: text("value").notNull(),
    label: text("label").notNull(),
    parentId: integer("parent_id"),
    sort: integer("sort").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
  },
  (t) => [uniqueIndex("catalog_items_type_value_idx").on(t.type, t.value)],
);

// ─── Plantillas de flujo ──────────────────────────────────────────────────

export const workflowTemplates = pgTable("workflow_templates", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  /** { types?: ("PL"|"MP")[], subtypes?: string[], categories?: string[] } */
  appliesTo: jsonb("applies_to")
    .$type<{ types?: string[]; subtypes?: string[]; categories?: string[] }>()
    .notNull()
    .default({}),
  isActive: boolean("is_active").notNull().default(true),
});

export const templateTasks = pgTable("template_tasks", {
  id: serial("id").primaryKey(),
  templateId: integer("template_id")
    .notNull()
    .references(() => workflowTemplates.id, { onDelete: "cascade" }),
  phase: integer("phase").notNull(),
  departmentId: integer("department_id")
    .notNull()
    .references(() => departments.id),
  title: text("title").notNull(),
  description: text("description"),
  isRequired: boolean("is_required").notNull().default(true),
  canReturnToTaskId: integer("can_return_to_task_id"),
  estDays: integer("est_days").notNull().default(5),
  sort: integer("sort").notNull().default(0),
});

export const templateTaskDeps = pgTable(
  "template_task_deps",
  {
    taskId: integer("task_id")
      .notNull()
      .references(() => templateTasks.id, { onDelete: "cascade" }),
    dependsOnTaskId: integer("depends_on_task_id")
      .notNull()
      .references(() => templateTasks.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.taskId, t.dependsOnTaskId] })],
);

// ─── Proyectos ────────────────────────────────────────────────────────────

export const projects = pgTable(
  "projects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: text("code").unique(),
    name: text("name").notNull().default(""),
    type: projectType("type"),
    category: projectCategory("category"),
    subtype: text("subtype"),
    brandId: integer("brand_id").references(() => brands.id),
    clientId: integer("client_id").references(() => clients.id),
    requesterId: uuid("requester_id")
      .notNull()
      .references(() => users.id),
    accountManagerId: uuid("account_manager_id").references(() => users.id),
    origin: text("origin"),
    status: projectStatus("status").notNull().default("draft"),
    statusBeforePause: projectStatus("status_before_pause"),
    phase: integer("phase").notNull().default(0),
    priority: priority("priority"),
    neededBy: date("needed_by"),
    neededByReason: text("needed_by_reason"),
    requestedAt: timestamp("requested_at", { withTimezone: true }),
    decidedG1At: timestamp("decided_g1_at", { withTimezone: true }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    unitsFirstOrder: integer("units_first_order"),
    unitsAnnual: integer("units_annual"),
    targetPrice: numeric("target_price", { precision: 12, scale: 2 }),
    completenessPct: integer("completeness_pct").notNull().default(0),
    brief: jsonb("brief").$type<BriefData>().notNull().default({}),
    sharepointFolderId: text("sharepoint_folder_id"),
    sharepointFolderUrl: text("sharepoint_folder_url"),
    /** { "00": itemId, "01": itemId, ... } */
    sharepointSubfolders: jsonb("sharepoint_subfolders").$type<Record<string, string>>(),
    stagingFolderId: text("staging_folder_id"),
    sapOrderRef: text("sap_order_ref"),
    /** Cotización enviada al cliente (fase 1 → 2). */
    quoteAmount: numeric("quote_amount", { precision: 12, scale: 2 }),
    quotedAt: timestamp("quoted_at", { withTimezone: true }),
    /** Proyectos con varias referencias: precio único o por referencia. */
    pricingMode: text("pricing_mode").$type<"single" | "per_reference">().notNull().default("single"),
    /** Envase y packaging común a todas las referencias o distinto por referencia. */
    packagingMode: text("packaging_mode").$type<"common" | "per_reference">().notNull().default("common"),
    /** Solo PL: anticipo del 30 % recibido o inicio sin anticipo bajo responsabilidad. */
    prepayment: jsonb("prepayment").$type<Prepayment>(),
    templateId: integer("template_id").references(() => workflowTemplates.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("projects_status_idx").on(t.status),
    index("projects_requester_idx").on(t.requesterId),
    index("projects_requested_at_idx").on(t.requestedAt),
    index("projects_needed_by_idx").on(t.neededBy),
  ],
);

export const projectCodeCounters = pgTable(
  "project_code_counters",
  {
    year: integer("year").notNull(),
    type: projectType("type").notNull(),
    last: integer("last").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.year, t.type] })],
);

export const projectDepartments = pgTable(
  "project_departments",
  {
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    departmentId: integer("department_id")
      .notNull()
      .references(() => departments.id),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.departmentId] })],
);

export const gates = pgTable(
  "gates",
  {
    id: serial("id").primaryKey(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    gate: gateKey("gate").notNull(),
    status: gateStatus("status").notNull().default("pending"),
    decidedBy: uuid("decided_by").references(() => users.id),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    comment: text("comment"),
    reasonCode: text("reason_code"),
    clientEvidenceFileId: integer("client_evidence_file_id"),
    /** Datos adicionales de la decisión (p. ej. anticipo en G2). */
    data: jsonb("data").$type<Record<string, unknown>>(),
    openedAt: timestamp("opened_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("gates_project_gate_idx").on(t.projectId, t.gate)],
);

export const infoRequests = pgTable("info_requests", {
  id: serial("id").primaryKey(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  gateId: integer("gate_id").references(() => gates.id),
  requestedBy: uuid("requested_by")
    .notNull()
    .references(() => users.id),
  requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
  message: text("message").notNull(),
  fieldsMissing: text("fields_missing").array().notNull().default(sql`'{}'::text[]`),
  answeredBy: uuid("answered_by").references(() => users.id),
  answeredAt: timestamp("answered_at", { withTimezone: true }),
  answer: text("answer"),
});

// ─── Tareas (V2) ──────────────────────────────────────────────────────────

export const tasks = pgTable("tasks", {
  id: serial("id").primaryKey(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  phase: integer("phase").notNull(),
  departmentId: integer("department_id")
    .notNull()
    .references(() => departments.id),
  assigneeId: uuid("assignee_id").references(() => users.id),
  title: text("title").notNull(),
  description: text("description"),
  status: taskStatus("status").notNull().default("pendiente"),
  isRequired: boolean("is_required").notNull().default(true),
  iteration: integer("iteration").notNull().default(1),
  dueDate: date("due_date"),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  templateTaskId: integer("template_task_id").references(() => templateTasks.id),
});

export const taskDeps = pgTable(
  "task_deps",
  {
    taskId: integer("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    dependsOnTaskId: integer("depends_on_task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.taskId, t.dependsOnTaskId] })],
);

// ─── Comentarios y archivos ───────────────────────────────────────────────

export type Prepayment = {
  status: "received" | "waived";
  /** Quien asume la responsabilidad de iniciar sin anticipo. */
  responsible?: string;
  recordedBy: string;
  recordedAt: string;
  receivedAt?: string;
  note?: string;
};

export type Mentions = { users: string[]; departments: number[] };

export const comments = pgTable(
  "comments",
  {
    id: serial("id").primaryKey(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    taskId: integer("task_id").references(() => tasks.id, { onDelete: "set null" }),
    authorId: uuid("author_id")
      .notNull()
      .references(() => users.id),
    body: text("body").notNull(),
    mentions: jsonb("mentions").$type<Mentions>().notNull().default({ users: [], departments: [] }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    editedAt: timestamp("edited_at", { withTimezone: true }),
  },
  (t) => [index("comments_project_idx").on(t.projectId)],
);

export const files = pgTable(
  "files",
  {
    id: serial("id").primaryKey(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    taskId: integer("task_id").references(() => tasks.id, { onDelete: "set null" }),
    commentId: integer("comment_id").references(() => comments.id, { onDelete: "set null" }),
    sharepointItemId: text("sharepoint_item_id").notNull(),
    name: text("name").notNull(),
    mime: text("mime"),
    size: integer("size").notNull().default(0),
    tag: text("tag"),
    phase: integer("phase").notNull().default(0),
    uploadedBy: uuid("uploaded_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("files_project_idx").on(t.projectId)],
);

// ─── Auditoría, notificaciones, errores, cola ─────────────────────────────

export const activityLog = pgTable(
  "activity_log",
  {
    id: serial("id").primaryKey(),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }),
    actorId: uuid("actor_id").references(() => users.id),
    action: text("action").notNull(),
    entity: text("entity").notNull(),
    entityId: text("entity_id"),
    diff: jsonb("diff").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("activity_project_idx").on(t.projectId),
    index("activity_created_idx").on(t.createdAt),
  ],
);

export const notificationLog = pgTable(
  "notification_log",
  {
    id: serial("id").primaryKey(),
    event: text("event").notNull(),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
    /** Reposición relacionada (apartado de reposiciones) */
    replenishmentId: uuid("replenishment_id"),
    recipients: text("recipients").array().notNull(),
    /** Respuestas a (p. ej. emails a proveedores: contestan a Compras) */
    replyTo: text("reply_to").array(),
    subject: text("subject").notNull(),
    html: text("html").notNull(),
    /** Adjuntos (archivos ya guardados en el almacenamiento): se leen al enviar */
    attachments: jsonb("attachments").$type<{ storageItemId: string; name: string; mime?: string | null }[]>(),
    status: notificationStatus("status").notNull().default("pending"),
    error: text("error"),
    attempts: integer("attempts").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
  },
  (t) => [index("notification_created_idx").on(t.createdAt)],
);

export const errorLog = pgTable(
  "error_log",
  {
    id: serial("id").primaryKey(),
    source: text("source").notNull(),
    level: text("level").notNull().default("error"),
    message: text("message").notNull(),
    stack: text("stack"),
    context: jsonb("context").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("error_created_idx").on(t.createdAt)],
);

/** Conversaciones del asistente en Microsoft Teams (Teams no envía el historial). */
export const assistantChats = pgTable("assistant_chats", {
  conversationId: text("conversation_id").primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  messages: jsonb("messages").$type<{ role: "user" | "assistant"; content: string }[]>().notNull().default([]),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Cola simple con reintentos (§10 Resiliencia). */
export const jobs = pgTable(
  "jobs",
  {
    id: serial("id").primaryKey(),
    kind: text("kind").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    status: jobStatus("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(8),
    runAt: timestamp("run_at", { withTimezone: true }).notNull().defaultNow(),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("jobs_pending_idx").on(t.status, t.runAt)],
);

export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
});

/** Registro de sesiones para la sección "Uso" del backoffice. */
export const loginEvents = pgTable(
  "login_events",
  {
    id: serial("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("login_events_created_idx").on(t.createdAt)],
);

export type User = typeof users.$inferSelect;
export type Project = typeof projects.$inferSelect;
export type Department = typeof departments.$inferSelect;
export type ProjectStatus = (typeof projectStatus.enumValues)[number];
export type GateKey = (typeof gateKey.enumValues)[number];

// ─── Almacenamiento provisional en BD (pruebas sin SharePoint) ────────────

const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => "bytea" });

/** Sustituto de SharePoint mientras no haya credenciales de Graph (STORAGE_DRIVER=db). */
export const storageItems = pgTable("storage_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  parentId: uuid("parent_id"),
  isFolder: boolean("is_folder").notNull().default(false),
  size: integer("size").notNull().default(0),
  mime: text("mime"),
  data: bytea("data"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const storageUploads = pgTable("storage_uploads", {
  token: uuid("token").primaryKey().defaultRandom(),
  parentId: uuid("parent_id").notNull(),
  name: text("name").notNull(),
  received: integer("received").notNull().default(0),
  data: bytea("data").notNull().default(sql`''::bytea`),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ─── Ficha técnica (apartados por departamento) ───────────────────────────

export const sheetStatus = pgEnum("sheet_status", ["pending", "done", "na"]);

/**
 * Información que cada departamento aporta al proyecto conforme avanza
 * (cotización, fórmula, envase, etiqueta, regulatorio, producción).
 * La definición de cada apartado vive en `src/lib/sheet/sections.ts`.
 */
/**
 * Referencias de un proyecto (variantes: fragancias, colores…). Con dos o más, la
 * fórmula, identificación, regulatorio, etiqueta (y opcionalmente precio y envase)
 * van por referencia y cada departamento avanza por separado en cada una.
 */
export const projectReferences = pgTable(
  "project_references",
  {
    id: serial("id").primaryKey(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    /** Letra corta (A, B, C…). */
    label: text("label").notNull(),
    name: text("name").notNull(),
    /** Datos para la etiqueta que aporta el comercial por referencia. */
    finalName: text("final_name"),
    facing: text("facing"),
    sort: integer("sort").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("project_references_project_idx").on(t.projectId)],
);

/**
 * Datos confidenciales del proyecto, fuera de la ficha y del brief: solo los ven
 * Laboratorio / I+D, el gestor de proyectos (decisor global), admin y Operaciones.
 */
export const projectConfidential = pgTable("project_confidential", {
  projectId: uuid("project_id")
    .primaryKey()
    .references(() => projects.id, { onDelete: "cascade" }),
  /** Coste objetivo de la fórmula (€/ud). Lo necesita Laboratorio para formular. */
  formulaTargetCost: numeric("formula_target_cost", { precision: 12, scale: 4 }),
  updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const projectSheet = pgTable(
  "project_sheet",
  {
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    section: text("section").notNull(),
    /** 0 = común al proyecto; si no, id de project_references (apartados por referencia). */
    referenceId: integer("reference_id").notNull().default(0),
    data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
    status: sheetStatus("status").notNull().default("pending"),
    statusBy: uuid("status_by").references(() => users.id, { onDelete: "set null" }),
    statusAt: timestamp("status_at", { withTimezone: true }),
    statusNote: text("status_note"),
    updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.section, t.referenceId] })],
);
export type SheetRow = typeof projectSheet.$inferSelect;

// ─── Subestados por departamento ──────────────────────────────────────────

/**
 * Lista ordenada de subestados de cada departamento (configurable en el
 * backoffice). Alcanzar el subestado final completa el trabajo del
 * departamento en el proyecto.
 */
export const deptSubstates = pgTable(
  "dept_substates",
  {
    id: serial("id").primaryKey(),
    departmentId: integer("department_id")
      .notNull()
      .references(() => departments.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    sort: integer("sort").notNull().default(0),
    isFinal: boolean("is_final").notNull().default(false),
    /** Subestados anteriores a los que se puede volver desde este (retroceso). */
    canReturnTo: integer("can_return_to").array().notNull().default(sql`'{}'::int[]`),
    /** Campos de la ficha («apartado.campo») obligatorios para entrar en este subestado. */
    requiredFields: text("required_fields").array().notNull().default(sql`'{}'::text[]`),
    /** Campos de la ficha que se piden (opcionales) al pasar a este subestado. */
    promptFields: text("prompt_fields").array().notNull().default(sql`'{}'::text[]`),
  },
  (t) => [index("dept_substates_dept_idx").on(t.departmentId, t.sort)],
);
export type DeptSubstate = typeof deptSubstates.$inferSelect;

/** Subestado actual de cada departamento en cada proyecto. Sin fila = primer subestado, sin empezar. */
export const projectDeptProgress = pgTable(
  "project_dept_progress",
  {
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    departmentId: integer("department_id")
      .notNull()
      .references(() => departments.id, { onDelete: "cascade" }),
    substateId: integer("substate_id")
      .notNull()
      .references(() => deptSubstates.id),
    enteredAt: timestamp("entered_at", { withTimezone: true }).notNull().defaultNow(),
    /** Ronda de trabajo: empieza en 1 y suma 1 cada vez que se retrocede. */
    rounds: integer("rounds").notNull().default(1),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
    /** 0 = estado único del departamento; si no, estado de esa referencia. */
    referenceId: integer("reference_id").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.departmentId, t.referenceId] })],
);

/** Historial de avances y retrocesos de subestado (fechas del stepper y actividad). */
export const projectDeptTransitions = pgTable(
  "project_dept_transitions",
  {
    id: serial("id").primaryKey(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    departmentId: integer("department_id")
      .notNull()
      .references(() => departments.id, { onDelete: "cascade" }),
    fromSubstateId: integer("from_substate_id").references(() => deptSubstates.id, { onDelete: "set null" }),
    toSubstateId: integer("to_substate_id").references(() => deptSubstates.id, { onDelete: "set null" }),
    direction: text("direction").$type<"forward" | "back">().notNull(),
    comment: text("comment"),
    actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    referenceId: integer("reference_id").notNull().default(0),
  },
  (t) => [index("project_dept_transitions_idx").on(t.projectId, t.departmentId, t.createdAt)],
);

// ─── Reposiciones (apartado separado de NPD) ──────────────────────────────

/** Proveedores de materiales (etiquetas, estuches, envases…). */
export const suppliers = pgTable(
  "suppliers",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    emails: text("emails").array().notNull().default(sql`'{}'::text[]`),
    contactName: text("contact_name"),
    phone: text("phone"),
    notes: text("notes"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("suppliers_name_idx").on(sql`lower(${t.name})`)],
);

export const replenishmentStatus = pgEnum("replenishment_status", [
  "design_review", // Revisión de diseño (Diseño)
  "design_changes", // Correcciones de diseño (Diseño)
  "quality_review", // Validación del arte final (Calidad)
  "reformulation", // Reformulación pedida por Calidad (Laboratorio / I+D)
  "art_approved", // Arte final aprobado: Compras envía a imprenta
  "sent_to_print", // Enviado a imprenta / proveedor
  "closed", // Cerrada (material recibido)
  "cancelled",
]);
export type ReplenishmentStatus = (typeof replenishmentStatus.enumValues)[number];

export const replenishments = pgTable(
  "replenishments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: text("code").notNull().unique(),
    template: text("template").notNull().default("repeticion"),
    title: text("title").notNull(),
    status: replenishmentStatus("status").notNull().default("design_review"),
    /** Ronda de diseño (sube con cada petición de correcciones). */
    round: integer("round").notNull().default(1),
    npdProjectId: uuid("npd_project_id").references(() => projects.id, { onDelete: "set null" }),
    productName: text("product_name"),
    productRef: text("product_ref"),
    clientOrBrand: text("client_or_brand"),
    neededBy: date("needed_by"),
    notes: text("notes"),
    requesterId: uuid("requester_id")
      .notNull()
      .references(() => users.id),
    storageFolderId: text("storage_folder_id"),
    /** Reformulación: estado de Laboratorio / I+D (mismos subestados que en NPD). */
    labSubstateId: integer("lab_substate_id").references(() => deptSubstates.id, { onDelete: "set null" }),
    labEnteredAt: timestamp("lab_entered_at", { withTimezone: true }),
    labRounds: integer("lab_rounds").notNull().default(0),
    labCompletedAt: timestamp("lab_completed_at", { withTimezone: true }),
    /** Códigos de las muestras aprobadas en la reformulación. */
    approvedReference: text("approved_reference"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    closedAt: timestamp("closed_at", { withTimezone: true }),
  },
  (t) => [index("replenishments_status_idx").on(t.status)],
);

export const replenishmentCodeCounters = pgTable("replenishment_code_counters", {
  year: integer("year").primaryKey(),
  last: integer("last").notNull().default(0),
});

/** Elementos a reponer, cada uno con su proveedor y su recotización. */
export const replenishmentItems = pgTable(
  "replenishment_items",
  {
    id: serial("id").primaryKey(),
    replenishmentId: uuid("replenishment_id")
      .notNull()
      .references(() => replenishments.id, { onDelete: "cascade" }),
    element: text("element").notNull(),
    description: text("description"),
    quantity: integer("quantity"),
    supplierId: integer("supplier_id").references(() => suppliers.id, { onDelete: "set null" }),
    /** pending (sin pedir) · requested (pedida al proveedor) · received */
    quoteStatus: text("quote_status").notNull().default("pending"),
    quotePrice: numeric("quote_price", { precision: 12, scale: 4 }),
    quoteNotes: text("quote_notes"),
    quoteRequestedAt: timestamp("quote_requested_at", { withTimezone: true }),
    quoteReceivedAt: timestamp("quote_received_at", { withTimezone: true }),
    sort: integer("sort").notNull().default(0),
  },
  (t) => [index("replenishment_items_rep_idx").on(t.replenishmentId)],
);

export const replenishmentFiles = pgTable(
  "replenishment_files",
  {
    id: serial("id").primaryKey(),
    replenishmentId: uuid("replenishment_id")
      .notNull()
      .references(() => replenishments.id, { onDelete: "cascade" }),
    storageItemId: text("storage_item_id").notNull(),
    /** Enlace (OneDrive / SharePoint) en lugar de archivo subido: el arte final va así */
    url: text("url"),
    name: text("name").notNull(),
    mime: text("mime"),
    size: integer("size").notNull().default(0),
    /** arte_final · prueba · referencia · cotizacion · otro */
    tag: text("tag").notNull().default("otro"),
    round: integer("round").notNull().default(1),
    uploadedBy: uuid("uploaded_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("replenishment_files_rep_idx").on(t.replenishmentId)],
);

// ─── Asistente Alexia: acciones con confirmación y avisos ────────────────────

/** Acción preparada por Alexia que la persona debe confirmar antes de ejecutarse. */
export const assistantActions = pgTable(
  "assistant_actions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** notify · comment · request_quote */
    kind: text("kind").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    /** Resumen legible que se muestra para confirmar */
    summary: jsonb("summary").$type<{ title: string; lines: [string, string][] }>().notNull(),
    /** pending · done · cancelled · failed */
    status: text("status").notNull().default("pending"),
    /** web · teams (y en Teams, la conversación donde se preparó) */
    channel: text("channel").notNull().default("web"),
    conversationId: text("conversation_id"),
    result: text("result"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    executedAt: timestamp("executed_at", { withTimezone: true }),
  },
  (t) => [index("assistant_actions_user_idx").on(t.userId, t.status)],
);

/** Avisos personales que Alexia comunica en el chat (web y Teams). */
export const userNotices = pgTable(
  "user_notices",
  {
    id: serial("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    fromUserId: uuid("from_user_id").references(() => users.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    body: text("body").notNull(),
    link: text("link"),
    urgent: boolean("urgent").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    readAt: timestamp("read_at", { withTimezone: true }),
  },
  (t) => [index("user_notices_user_idx").on(t.userId, t.readAt)],
);

/** Referencia a la conversación personal de Teams de cada usuario (para avisarle por iniciativa propia). */
export const teamsConversations = pgTable("teams_conversations", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  conversationId: text("conversation_id").notNull(),
  serviceUrl: text("service_url").notNull(),
  botId: text("bot_id").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ─── Laboratorio: muestras en evaluación y bitácora ───────────────────────

/** Muestras que Laboratorio pasa a evaluación (por referencia del proyecto y ronda). */
export const labSamples = pgTable(
  "lab_samples",
  {
    id: serial("id").primaryKey(),
    /** Proyecto NPD o, en una reformulación, la reposición. */
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }),
    replenishmentId: uuid("replenishment_id").references(() => replenishments.id, { onDelete: "cascade" }),
    /** Referencia del proyecto (0 = proyecto de una sola referencia) */
    referenceId: integer("reference_id").notNull().default(0),
    round: integer("round").notNull().default(1),
    /** Código de referencia de la muestra (visible para todos) */
    code: text("code").notNull(),
    /** Fórmula: confidencial (solo Laboratorio, Calidad y admin) */
    formula: text("formula"),
    /** evaluation · approved · not_approved */
    status: text("status").notNull().default("evaluation"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    decidedBy: uuid("decided_by").references(() => users.id, { onDelete: "set null" }),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
  },
  (t) => [index("lab_samples_project_idx").on(t.projectId)],
);

/** Bitácora de un departamento en un proyecto (p. ej. Laboratorio en «Desarrollo de muestras»). */
export const deptNotes = pgTable(
  "dept_notes",
  {
    id: serial("id").primaryKey(),
    /** Proyecto NPD o, en una reformulación, la reposición. */
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }),
    replenishmentId: uuid("replenishment_id").references(() => replenishments.id, { onDelete: "cascade" }),
    departmentKey: text("department_key").notNull(),
    referenceId: integer("reference_id").notNull().default(0),
    body: text("body").notNull(),
    /** Nota de espera (motivo por el que el trabajo está parado) */
    isWait: boolean("is_wait").notNull().default(false),
    authorId: uuid("author_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("dept_notes_project_idx").on(t.projectId, t.departmentKey)],
);

/** Avisos proactivos de Alexia ya enviados (para no repetirlos): riesgo de proyectos, proveedores sin respuesta… */
export const proactiveAlerts = pgTable(
  "proactive_alerts",
  {
    kind: text("kind").notNull(),
    /** Proyecto, elemento de reposición… */
    entityId: text("entity_id").notNull(),
    /** Fase del aviso (p. ej. «pre_risk:2026-12-01», «quote:<fecha de petición>:1») */
    stage: text("stage").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.kind, t.entityId, t.stage] })],
);
