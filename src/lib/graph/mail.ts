import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";
import { graphConfigured, graphFetch } from "./client";

export type MailMessage = { to: string[]; subject: string; html: string; replyTo?: string[] | null };

/**
 * Envío de email.
 * MAIL_DRIVER:
 * - "graph": Graph `sendMail` desde el buzón compartido (§6); por defecto si hay credenciales.
 * - "brevo": API de Brevo (BREVO_API_KEY, clave xkeysib-…); por defecto si hay BREVO_API_KEY.
 * - "smtp": servidor SMTP (p. ej. Gmail con contraseña de aplicación); por defecto si hay SMTP_HOST.
 * - "log": no envía; el HTML queda en notification_log y, en local, en .storage/mails.
 * - "fail": simula una caída del envío.
 * MAIL_REDIRECT_TO (pruebas): todos los emails van a estas direcciones, indicando a quién iban.
 */
export function mailDriver() {
  const d = process.env.MAIL_DRIVER;
  if (d === "graph" || d === "brevo" || d === "smtp" || d === "log" || d === "fail") return d;
  if (graphConfigured() && process.env.MAIL_SENDER) return "graph";
  if (process.env.BREVO_API_KEY) return "brevo";
  if (process.env.SMTP_HOST && process.env.SMTP_USER) return "smtp";
  return "log";
}

/** Direcciones de prueba a las que se desvía todo el correo (vacío = envío normal). */
export function mailRedirect() {
  return (process.env.MAIL_REDIRECT_TO ?? "")
    .split(",")
    .map((e) => e.trim())
    .filter((e) => e.includes("@"));
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Modo pruebas: el email va a MAIL_REDIRECT_TO con una franja que dice a quién iba. */
function redirected(msg: MailMessage): MailMessage {
  const to = mailRedirect();
  if (!to.length) return msg;
  const banner = `<div style="background:#fff4cc;border:1px solid #f0c36d;padding:10px 14px;margin:0 0 12px;font:13px/1.4 Arial,sans-serif;color:#5c4400">
<strong>Modo pruebas</strong>: este email no se ha enviado a sus destinatarios reales.<br>
Iba dirigido a: ${esc(msg.to.join(", "))}${msg.replyTo?.length ? `<br>Responder a: ${esc(msg.replyTo.join(", "))}` : ""}</div>`;
  const html = /<body[^>]*>/i.test(msg.html) ? msg.html.replace(/<body[^>]*>/i, (m) => `${m}${banner}`) : banner + msg.html;
  return { to, subject: `[PRUEBA] ${msg.subject}`, html, replyTo: msg.replyTo };
}

export async function sendMail(original: MailMessage, sender?: string) {
  const driver = mailDriver();
  if (driver === "fail") throw new Error("MAIL_DRIVER=fail: fallo simulado del envío de email");
  const msg = redirected(original);
  if (driver === "log") {
    console.info(`[mail:log] ${msg.subject} → ${msg.to.join(", ")}`);
    if (process.env.VERCEL) return; // disco efímero: el HTML ya está en notification_log
    const dir = path.resolve(/* turbopackIgnore: true */ process.cwd(), process.env.LOCAL_STORAGE_DIR ?? ".storage", "mails");
    await fs.mkdir(dir, { recursive: true });
    const file = path.join(dir, `${Date.now()}-${msg.subject.replace(/[^\w-]+/g, "_").slice(0, 60)}.html`);
    await fs.writeFile(file, `<!-- To: ${msg.to.join(", ")} -->\n${msg.replyTo?.length ? `<!-- Reply-To: ${msg.replyTo.join(", ")} -->\n` : ""}<!-- Subject: ${msg.subject} -->\n${msg.html}`);
    return;
  }
  if (driver === "smtp") return sendSmtp(msg);
  if (driver === "brevo") return sendBrevo(msg);
  const from = sender || process.env.MAIL_SENDER!;
  await graphFetch(`/users/${encodeURIComponent(from)}/sendMail`, {
    method: "POST",
    json: {
      message: {
        subject: msg.subject,
        body: { contentType: "HTML", content: msg.html },
        toRecipients: msg.to.map((address) => ({ emailAddress: { address } })),
        ...(msg.replyTo?.length ? { replyTo: msg.replyTo.map((address) => ({ emailAddress: { address } })) } : {}),
      },
      saveToSentItems: true,
    },
  });
}

let transport: import("nodemailer").Transporter | null = null;

/** SMTP (Gmail: smtp.gmail.com, puerto 465, usuario = la cuenta, contraseña de aplicación). */
async function sendSmtp(msg: MailMessage) {
  const nodemailer = await import("nodemailer");
  const port = Number((process.env.SMTP_PORT ?? "465").trim());
  transport ??= nodemailer.createTransport({
    host: process.env.SMTP_HOST?.trim(),
    port,
    secure: port === 465,
    auth: { user: process.env.SMTP_USER?.trim(), pass: (process.env.SMTP_PASSWORD ?? "").replace(/\s+/g, "").replace(/^["']|["']$/g, "") },
  });
  const fromAddress = process.env.MAIL_FROM || process.env.SMTP_USER!;
  await transport.sendMail({
    from: { name: process.env.MAIL_FROM_NAME || "NATU · Proyectos NPD", address: fromAddress },
    to: msg.to,
    subject: msg.subject,
    html: msg.html,
    ...(msg.replyTo?.length ? { replyTo: msg.replyTo } : {}),
  });
}

/** Pistas sobre el formato de las variables SMTP (sin mostrar sus valores). */
function smtpHints() {
  const host = process.env.SMTP_HOST ?? "";
  const user = process.env.SMTP_USER ?? "";
  const pass = process.env.SMTP_PASSWORD ?? "";
  const hints: string[] = [];
  if (host !== host.trim() || user !== user.trim()) hints.push("SMTP_HOST o SMTP_USER tienen espacios al principio o al final");
  if (/^["']|["']$/.test(pass.trim()) || /^["']|["']$/.test(user.trim())) hints.push("SMTP_USER o SMTP_PASSWORD están entre comillas: quítalas");
  if (/brevo|sendinblue/i.test(host)) {
    if (!/@smtp-brevo\.com$/i.test(user.trim())) hints.push("Con Brevo, SMTP_USER es el «Iniciar sesión» de SMTP y API → SMTP (termina en @smtp-brevo.com), no tu email");
    if (/^xkeysib-/i.test(pass.trim())) hints.push("SMTP_PASSWORD es una clave de API (xkeysib-…): hace falta una clave SMTP (xsmtpsib-…)");
    else if (!/^xsmtpsib-/i.test(pass.trim())) hints.push("SMTP_PASSWORD no parece una clave SMTP de Brevo (deberían empezar por xsmtpsib-)");
  }
  if (/gmail/i.test(host) && pass.replace(/\s+/g, "").length !== 16) hints.push("Con Gmail, SMTP_PASSWORD es la contraseña de aplicación de 16 letras");
  if (!pass) hints.push("Falta SMTP_PASSWORD");
  return hints;
}

/** Comprueba la conexión y el usuario/contraseña SMTP sin enviar nada. */
export async function verifySmtp(): Promise<{ ok: boolean; error?: string; hints?: string[] }> {
  if (mailDriver() !== "smtp") return { ok: false, error: "MAIL_DRIVER no es smtp" };
  const hints = smtpHints();
  try {
    const nodemailer = await import("nodemailer");
    const port = Number((process.env.SMTP_PORT ?? "465").trim());
    const t = nodemailer.createTransport({
      host: process.env.SMTP_HOST?.trim(),
      port,
      secure: port === 465,
      auth: { user: process.env.SMTP_USER?.trim(), pass: (process.env.SMTP_PASSWORD ?? "").replace(/\s+/g, "").replace(/^["']|["']$/g, "") },
    });
    await t.verify();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err instanceof Error ? err.message : String(err)).slice(0, 200), hints };
  }
}

// ─── Brevo (API HTTP) ─────────────────────────────────────────────────────

const brevoKey = () => (process.env.BREVO_API_KEY ?? "").trim().replace(/^["']|["']$/g, "");

/** Error legible de la API de Brevo (su `message` explica la causa: clave, cuenta, remitente…). */
async function brevoError(r: Response) {
  const body = (await r.json().catch(() => null)) as { code?: string; message?: string } | null;
  return `Brevo ${r.status}${body?.code ? ` (${body.code})` : ""}: ${body?.message ?? r.statusText}`.slice(0, 300);
}

async function sendBrevo(msg: MailMessage) {
  const r = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "api-key": brevoKey(), "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      sender: { name: process.env.MAIL_FROM_NAME || "NATU · Proyectos NPD", email: process.env.MAIL_FROM },
      to: msg.to.map((email) => ({ email })),
      subject: msg.subject,
      htmlContent: msg.html,
      // Brevo admite un único «responder a»
      ...(msg.replyTo?.length ? { replyTo: { email: msg.replyTo[0] } } : {}),
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!r.ok) throw new Error(await brevoError(r));
}

/** Comprueba la clave de la API de Brevo (sin enviar nada). */
export async function verifyBrevo(): Promise<{ ok: boolean; error?: string; hints?: string[] }> {
  const key = brevoKey();
  const hints: string[] = [];
  if (!key) hints.push("Falta BREVO_API_KEY");
  else if (/^xsmtpsib-/i.test(key)) hints.push("BREVO_API_KEY es una clave SMTP (xsmtpsib-…): hace falta una clave de API (xkeysib-…), en SMTP y API → Claves API");
  else if (!/^xkeysib-/i.test(key)) hints.push("BREVO_API_KEY no parece una clave de API de Brevo (empiezan por xkeysib-)");
  if (!process.env.MAIL_FROM) hints.push("Falta MAIL_FROM (remitente verificado en Brevo o de un dominio autenticado)");
  try {
    const r = await fetch("https://api.brevo.com/v3/account", { headers: { "api-key": key, accept: "application/json" }, signal: AbortSignal.timeout(8000) });
    if (!r.ok) return { ok: false, error: await brevoError(r), hints };
    return hints.length ? { ok: false, hints } : { ok: true };
  } catch (err) {
    return { ok: false, error: (err instanceof Error ? err.message : String(err)).slice(0, 200), hints };
  }
}
