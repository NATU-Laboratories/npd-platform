import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";
import { graphConfigured, graphFetch } from "./client";

export type MailMessage = { to: string[]; subject: string; html: string };

/**
 * Envío de email vía Graph `sendMail` desde el buzón compartido (§6).
 * MAIL_DRIVER: "graph" (por defecto si hay credenciales) | "log" (no envía;
 * el HTML queda en notification_log y, en local, en .storage/mails) |
 * "fail" (simula caída de Graph).
 */
export function mailDriver() {
  const d = process.env.MAIL_DRIVER;
  if (d === "graph" || d === "log" || d === "fail") return d;
  return graphConfigured() && process.env.MAIL_SENDER ? "graph" : "log";
}

export async function sendMail(msg: MailMessage, sender?: string) {
  const driver = mailDriver();
  if (driver === "fail") throw new Error("MAIL_DRIVER=fail: fallo simulado de Graph sendMail");
  if (driver === "log") {
    console.info(`[mail:log] ${msg.subject} → ${msg.to.join(", ")}`);
    if (process.env.VERCEL) return; // disco efímero: el HTML ya está en notification_log
    const dir = path.resolve(/* turbopackIgnore: true */ process.cwd(), process.env.LOCAL_STORAGE_DIR ?? ".storage", "mails");
    await fs.mkdir(dir, { recursive: true });
    const file = path.join(dir, `${Date.now()}-${msg.subject.replace(/[^\w-]+/g, "_").slice(0, 60)}.html`);
    await fs.writeFile(file, `<!-- To: ${msg.to.join(", ")} -->\n<!-- Subject: ${msg.subject} -->\n${msg.html}`);
    return;
  }
  const from = sender || process.env.MAIL_SENDER!;
  await graphFetch(`/users/${encodeURIComponent(from)}/sendMail`, {
    method: "POST",
    json: {
      message: {
        subject: msg.subject,
        body: { contentType: "HTML", content: msg.html },
        toRecipients: msg.to.map((address) => ({ emailAddress: { address } })),
      },
      saveToSentItems: true,
    },
  });
}
