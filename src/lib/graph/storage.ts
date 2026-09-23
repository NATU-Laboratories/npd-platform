import "server-only";
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { storageItems, storageUploads } from "@/db/schema";
import { graphConfigured, graphFetch, GraphError } from "./client";

/**
 * Almacenamiento de documentos. En producción: biblioteca "Proyectos" del
 * sitio SharePoint "Proyectos NPD" vía Graph (§9.1). En desarrollo, sin
 * credenciales de Graph, un adaptador local en disco con la misma semántica
 * (ids estables, sesiones de subida por trozos).
 */

export type StoredItem = {
  id: string;
  name: string;
  size: number;
  mime?: string | null;
  webUrl?: string | null;
  parentId?: string | null;
  isFolder: boolean;
  createdAt?: string;
  createdBy?: string | null;
};

export interface Storage {
  kind: "sharepoint" | "local";
  rootId(): Promise<string>;
  ensureFolder(parentId: string, name: string): Promise<StoredItem>;
  createUploadSession(parentId: string, fileName: string): Promise<{ uploadUrl: string }>;
  getItem(id: string): Promise<StoredItem>;
  listChildren(folderId: string): Promise<StoredItem[]>;
  moveItem(id: string, newParentId: string): Promise<void>;
  renameItem(id: string, name: string): Promise<void>;
  deleteItem(id: string): Promise<void>;
  downloadUrl(id: string): Promise<string>;
}

/** Nombres válidos en SharePoint: sin " * : < > ? / \ | ni espacios/puntos finales. */
export function sanitizeName(name: string, max = 200) {
  const cleaned = name
    .replace(/["*:<>?/\\|\u0000-\u001f]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/, "");
  return (cleaned || "sin-nombre").slice(0, max);
}

// ─── SharePoint ───────────────────────────────────────────────────────────

type DriveItem = {
  id: string;
  name: string;
  size?: number;
  webUrl?: string;
  folder?: object;
  file?: { mimeType?: string };
  parentReference?: { id?: string };
  createdDateTime?: string;
  createdBy?: { user?: { displayName?: string }; application?: { displayName?: string } };
};

function toStored(i: DriveItem): StoredItem {
  return {
    id: i.id,
    name: i.name,
    size: i.size ?? 0,
    mime: i.file?.mimeType ?? null,
    webUrl: i.webUrl ?? null,
    parentId: i.parentReference?.id ?? null,
    isFolder: !!i.folder,
    createdAt: i.createdDateTime,
    createdBy: i.createdBy?.user?.displayName ?? i.createdBy?.application?.displayName ?? null,
  };
}

let driveIdCache: string | null = null;
async function driveId() {
  if (process.env.SHAREPOINT_DRIVE_ID) return process.env.SHAREPOINT_DRIVE_ID;
  if (driveIdCache) return driveIdCache;
  const site = process.env.SHAREPOINT_SITE_ID;
  if (!site) throw new Error("SHAREPOINT_SITE_ID no está definido");
  const libName = process.env.SHAREPOINT_LIBRARY_NAME ?? "Proyectos";
  const res = await graphFetch<{ value: { id: string; name: string }[] }>(`/sites/${site}/drives?$select=id,name`);
  const drive = res.value.find((d) => d.name === libName);
  if (!drive) throw new Error(`No se encuentra la biblioteca "${libName}" en el sitio`);
  driveIdCache = drive.id;
  return drive.id;
}

const sharepoint: Storage = {
  kind: "sharepoint",
  async rootId() {
    const d = await driveId();
    const root = await graphFetch<DriveItem>(`/drives/${d}/root?$select=id`);
    return root.id;
  },
  async ensureFolder(parentId, name) {
    const d = await driveId();
    const safe = sanitizeName(name);
    try {
      const item = await graphFetch<DriveItem>(`/drives/${d}/items/${parentId}/children`, {
        method: "POST",
        json: { name: safe, folder: {}, "@microsoft.graph.conflictBehavior": "fail" },
      });
      return toStored(item);
    } catch (e) {
      if (e instanceof GraphError && e.status === 409) {
        const item = await graphFetch<DriveItem>(`/drives/${d}/items/${parentId}:/${encodeURIComponent(safe)}`);
        return toStored(item);
      }
      throw e;
    }
  },
  async createUploadSession(parentId, fileName) {
    const d = await driveId();
    const safe = sanitizeName(fileName);
    const res = await graphFetch<{ uploadUrl: string }>(
      `/drives/${d}/items/${parentId}:/${encodeURIComponent(safe)}:/createUploadSession`,
      { method: "POST", json: { item: { "@microsoft.graph.conflictBehavior": "rename" } } },
    );
    return { uploadUrl: res.uploadUrl };
  },
  async getItem(id) {
    const d = await driveId();
    return toStored(await graphFetch<DriveItem>(`/drives/${d}/items/${id}`));
  },
  async listChildren(folderId) {
    const d = await driveId();
    const out: StoredItem[] = [];
    let next: string | undefined = `/drives/${d}/items/${folderId}/children?$top=200`;
    while (next) {
      const res: { value: DriveItem[]; "@odata.nextLink"?: string } = await graphFetch(next);
      out.push(...res.value.map(toStored));
      next = res["@odata.nextLink"];
    }
    return out;
  },
  async moveItem(id, newParentId) {
    const d = await driveId();
    await graphFetch(`/drives/${d}/items/${id}`, {
      method: "PATCH",
      json: { parentReference: { id: newParentId }, "@microsoft.graph.conflictBehavior": "rename" },
    });
  },
  async renameItem(id, name) {
    const d = await driveId();
    await graphFetch(`/drives/${d}/items/${id}`, { method: "PATCH", json: { name: sanitizeName(name) } });
  },
  async deleteItem(id) {
    const d = await driveId();
    await graphFetch(`/drives/${d}/items/${id}`, { method: "DELETE" });
  },
  async downloadUrl(id) {
    const d = await driveId();
    const item = await graphFetch<{ "@microsoft.graph.downloadUrl": string }>(
      `/drives/${d}/items/${id}?$select=id,@microsoft.graph.downloadUrl`,
    );
    return item["@microsoft.graph.downloadUrl"];
  },
};

// ─── Local (desarrollo) ───────────────────────────────────────────────────

type LocalMeta = {
  items: Record<string, Omit<StoredItem, "id"> & { blob?: string }>;
  sessions: Record<string, { parentId: string; name: string; tmp: string; received: number }>;
};

const LOCAL_DIR = path.resolve(/* turbopackIgnore: true */ process.cwd(), process.env.LOCAL_STORAGE_DIR ?? ".storage");
const META = path.join(LOCAL_DIR, "index.json");
let lock: Promise<unknown> = Promise.resolve();

async function withMeta<T>(fn: (m: LocalMeta) => Promise<T> | T): Promise<T> {
  const run = lock.then(async () => {
    await fs.mkdir(path.join(LOCAL_DIR, "blobs"), { recursive: true });
    let meta: LocalMeta;
    try {
      meta = JSON.parse(await fs.readFile(META, "utf8"));
    } catch {
      meta = { items: { root: { name: "Proyectos", size: 0, isFolder: true, parentId: null } }, sessions: {} };
    }
    const result = await fn(meta);
    await fs.writeFile(META, JSON.stringify(meta, null, 1));
    return result;
  });
  lock = run.catch(() => undefined);
  return run;
}

function localWebUrl(id: string) {
  return `/api/storage/local/item/${id}`;
}

function notFound(id: string): never {
  throw new GraphError(`Elemento ${id} no encontrado`, 404);
}

export const local: Storage & {
  receiveChunk(token: string, range: string | null, body: Buffer, mime: string | null): Promise<StoredItem | { nextExpectedRanges: string[] }>;
  blobPath(id: string): Promise<{ file: string; item: StoredItem }>;
} = {
  kind: "local",
  async rootId() {
    return "root";
  },
  async ensureFolder(parentId, name) {
    const safe = sanitizeName(name);
    return withMeta((m) => {
      if (!m.items[parentId]) notFound(parentId);
      const found = Object.entries(m.items).find(([, i]) => i.parentId === parentId && i.name === safe && i.isFolder);
      if (found) return { id: found[0], ...found[1] };
      const id = randomUUID();
      m.items[id] = { name: safe, size: 0, isFolder: true, parentId, createdAt: new Date().toISOString(), webUrl: localWebUrl(id) };
      return { id, ...m.items[id]! };
    });
  },
  async createUploadSession(parentId, fileName) {
    const token = randomUUID();
    await withMeta((m) => {
      if (!m.items[parentId]) notFound(parentId);
      m.sessions[token] = { parentId, name: sanitizeName(fileName), tmp: path.join(LOCAL_DIR, "blobs", `${token}.part`), received: 0 };
    });
    return { uploadUrl: `/api/storage/local/upload/${token}` };
  },
  async receiveChunk(token, range, body, mime) {
    return withMeta(async (m) => {
      const s = m.sessions[token];
      if (!s) throw new GraphError("Sesión de subida no encontrada", 404);
      const match = /bytes (\d+)-(\d+)\/(\d+)/.exec(range ?? "");
      const [start, end, total] = match ? [Number(match[1]), Number(match[2]), Number(match[3])] : [0, body.length - 1, body.length];
      if (start !== s.received) throw new GraphError("Rango inesperado", 416);
      await fs.appendFile(s.tmp, body);
      s.received = end + 1;
      if (s.received < total) return { nextExpectedRanges: [`${s.received}-`] };
      const id = randomUUID();
      let name = s.name;
      const siblings = new Set(Object.values(m.items).filter((i) => i.parentId === s.parentId).map((i) => i.name));
      for (let n = 1; siblings.has(name); n++) name = s.name.replace(/(\.[^.]*)?$/, ` ${n}$1`);
      const blob = path.join(LOCAL_DIR, "blobs", id);
      await fs.rename(s.tmp, blob);
      m.items[id] = {
        name,
        size: total,
        mime: mime ?? "application/octet-stream",
        isFolder: false,
        parentId: s.parentId,
        createdAt: new Date().toISOString(),
        webUrl: localWebUrl(id),
        blob,
      };
      delete m.sessions[token];
      return { id, ...m.items[id]! };
    });
  },
  async getItem(id) {
    return withMeta((m) => {
      const i = m.items[id];
      if (!i) notFound(id);
      return { id, ...i };
    });
  },
  async listChildren(folderId) {
    return withMeta((m) =>
      Object.entries(m.items)
        .filter(([, i]) => i.parentId === folderId)
        .map(([id, i]) => ({ id, ...i })),
    );
  },
  async moveItem(id, newParentId) {
    await withMeta((m) => {
      if (!m.items[id]) notFound(id);
      if (!m.items[newParentId]) notFound(newParentId);
      m.items[id]!.parentId = newParentId;
    });
  },
  async renameItem(id, name) {
    await withMeta((m) => {
      if (!m.items[id]) notFound(id);
      m.items[id]!.name = sanitizeName(name);
    });
  },
  async deleteItem(id) {
    await withMeta(async (m) => {
      const i = m.items[id];
      if (!i) return;
      if (i.blob) await fs.rm(i.blob, { force: true });
      delete m.items[id];
    });
  },
  async downloadUrl(id) {
    return `/api/storage/local/item/${id}`;
  },
  async blobPath(id) {
    return withMeta((m) => {
      const i = m.items[id];
      if (!i?.blob) notFound(id);
      return { file: i.blob, item: { id, ...i } };
    });
  },
};

// ─── Base de datos (pruebas en Vercel sin SharePoint) ─────────────────────

type ChunkReceiver = {
  receiveChunk(token: string, range: string | null, body: Buffer, mime: string | null): Promise<StoredItem | { nextExpectedRanges: string[] }>;
  read(id: string): Promise<{ data: Buffer; item: StoredItem }>;
};

function dbRow(r: typeof storageItems.$inferSelect): StoredItem {
  return {
    id: r.id,
    name: r.name,
    size: r.size,
    mime: r.mime,
    parentId: r.parentId,
    isFolder: r.isFolder,
    createdAt: r.createdAt.toISOString(),
    webUrl: r.isFolder ? null : `/api/storage/local/item/${r.id}`,
  };
}

const UUID_RE = /^[0-9a-f-]{36}$/i;

async function dbGet(id: string) {
  if (!UUID_RE.test(id)) notFound(id);
  const [r] = await db
    .select({ id: storageItems.id, name: storageItems.name, parentId: storageItems.parentId, isFolder: storageItems.isFolder, size: storageItems.size, mime: storageItems.mime, createdAt: storageItems.createdAt, data: sql<null>`null` })
    .from(storageItems)
    .where(eq(storageItems.id, id));
  if (!r) notFound(id);
  return r as typeof storageItems.$inferSelect;
}

export const dbStore: Storage & ChunkReceiver = {
  kind: "local",
  async rootId() {
    const [r] = await db.select({ id: storageItems.id }).from(storageItems).where(and(isNull(storageItems.parentId), eq(storageItems.isFolder, true)));
    if (r) return r.id;
    const [c] = await db.insert(storageItems).values({ name: "Proyectos", isFolder: true }).returning({ id: storageItems.id });
    return c!.id;
  },
  async ensureFolder(parentId, name) {
    const safe = sanitizeName(name);
    await dbGet(parentId);
    const [found] = await db
      .select()
      .from(storageItems)
      .where(and(eq(storageItems.parentId, parentId), eq(storageItems.name, safe), eq(storageItems.isFolder, true)));
    if (found) return dbRow(found);
    const [c] = await db.insert(storageItems).values({ name: safe, parentId, isFolder: true }).returning();
    return dbRow(c!);
  },
  async createUploadSession(parentId, fileName) {
    await dbGet(parentId);
    const [u] = await db.insert(storageUploads).values({ parentId, name: sanitizeName(fileName) }).returning({ token: storageUploads.token });
    return { uploadUrl: `/api/storage/local/upload/${u!.token}` };
  },
  async receiveChunk(token, range, body, mime) {
    if (!UUID_RE.test(token)) throw new GraphError("Sesión de subida no encontrada", 404);
    const match = /bytes (\d+)-(\d+)\/(\d+)/.exec(range ?? "");
    const [start, end, total] = match ? [Number(match[1]), Number(match[2]), Number(match[3])] : [0, body.length - 1, body.length];
    const [s] = await db
      .update(storageUploads)
      .set({ data: sql`${storageUploads.data} || ${body}`, received: end + 1 })
      .where(and(eq(storageUploads.token, token), eq(storageUploads.received, start)))
      .returning({ received: storageUploads.received, parentId: storageUploads.parentId, name: storageUploads.name });
    if (!s) throw new GraphError("Sesión no encontrada o rango inesperado", 416);
    if (s.received < total) return { nextExpectedRanges: [`${s.received}-`] };
    const siblings = new Set(
      (await db.select({ name: storageItems.name }).from(storageItems).where(eq(storageItems.parentId, s.parentId))).map((r) => r.name),
    );
    let name = s.name;
    for (let n = 1; siblings.has(name); n++) name = s.name.replace(/(\.[^.]*)?$/, ` ${n}$1`);
    const [item] = await db.execute<typeof storageItems.$inferSelect & { parent_id: string; is_folder: boolean; created_at: Date }>(sql`
      insert into storage_items (name, parent_id, is_folder, size, mime, data)
      select ${name}, parent_id, false, ${total}, ${mime ?? "application/octet-stream"}, data from storage_uploads where token = ${token}
      returning id, name, parent_id, is_folder, size, mime, created_at`).then((r) => r.rows);
    await db.delete(storageUploads).where(eq(storageUploads.token, token));
    return { id: item!.id, name: item!.name, size: Number(item!.size), mime: item!.mime, parentId: item!.parent_id, isFolder: false, webUrl: `/api/storage/local/item/${item!.id}` };
  },
  async getItem(id) {
    return dbRow(await dbGet(id));
  },
  async listChildren(folderId) {
    if (!UUID_RE.test(folderId)) return [];
    const rows = await db
      .select({ id: storageItems.id, name: storageItems.name, parentId: storageItems.parentId, isFolder: storageItems.isFolder, size: storageItems.size, mime: storageItems.mime, createdAt: storageItems.createdAt, data: sql<null>`null` })
      .from(storageItems)
      .where(eq(storageItems.parentId, folderId));
    return rows.map((r) => dbRow(r as typeof storageItems.$inferSelect));
  },
  async moveItem(id, newParentId) {
    await dbGet(newParentId);
    await db.update(storageItems).set({ parentId: newParentId }).where(eq(storageItems.id, id));
  },
  async renameItem(id, name) {
    await db.update(storageItems).set({ name: sanitizeName(name) }).where(eq(storageItems.id, id));
  },
  async deleteItem(id) {
    if (!UUID_RE.test(id)) return;
    // borra la carpeta y todo su contenido
    await db.execute(sql`
      with recursive tree as (select id from storage_items where id = ${id}
        union all select s.id from storage_items s join tree t on s.parent_id = t.id)
      delete from storage_items where id in (select id from tree)`);
  },
  async downloadUrl(id) {
    return `/api/storage/local/item/${id}`;
  },
  async read(id) {
    if (!UUID_RE.test(id)) notFound(id);
    const [r] = await db.select().from(storageItems).where(eq(storageItems.id, id));
    if (!r || r.isFolder || !r.data) notFound(id);
    return { data: r.data, item: dbRow(r) };
  },
};

export type StorageDriver = "sharepoint" | "local" | "db";

/**
 * sharepoint: con credenciales de Graph. db: pruebas en Vercel sin Graph
 * (el disco de Vercel no persiste). local: desarrollo en disco.
 */
export function storageDriver(): StorageDriver {
  const d = process.env.STORAGE_DRIVER;
  if (d === "sharepoint" || d === "local" || d === "db") return d;
  if (graphConfigured() && process.env.SHAREPOINT_SITE_ID) return "sharepoint";
  return process.env.VERCEL ? "db" : "local";
}

export function getStorage(): Storage {
  const d = storageDriver();
  return d === "sharepoint" ? sharepoint : d === "db" ? dbStore : local;
}

/** Almacén no-SharePoint que recibe subidas por la API propia. */
export function chunkStore(): (ChunkReceiver & Storage) | null {
  const d = storageDriver();
  if (d === "db") return dbStore;
  if (d === "local") {
    return {
      ...local,
      async read(id: string) {
        const { file, item } = await local.blobPath(id);
        return { data: await fs.readFile(file), item };
      },
    };
  }
  return null;
}
