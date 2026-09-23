import "server-only";
import { db } from "@/db";
import { settings } from "@/db/schema";
import { SETTINGS_DEFAULTS, type AppSettings } from "@/lib/catalog-defaults";

export async function getSettings(): Promise<AppSettings> {
  const rows = await db.select().from(settings);
  const out: Record<string, unknown> = { ...SETTINGS_DEFAULTS };
  for (const r of rows) out[r.key] = r.value;
  return out as AppSettings;
}

export async function setSetting<K extends keyof AppSettings>(key: K, value: AppSettings[K]) {
  await db
    .insert(settings)
    .values({ key, value })
    .onConflictDoUpdate({ target: settings.key, set: { value } });
}
