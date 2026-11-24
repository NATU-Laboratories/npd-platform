import "server-only";
import { z } from "zod";
import { isAdmin, type CurrentUser } from "./authz";

/**
 * Conexión de Alexia con el agente de newsletters (servicio aparte en
 * news.agentes.natulaboratories.es). Alexia puede pedir newsletters, consultar
 * cómo van, pedir cambios y reenviar pruebas. NUNCA puede programar un envío:
 * eso exige que una persona pulse «Aprobar» en el email de aprobación.
 */
const URL_AGENTE = () => (process.env.NEWSLETTER_AGENT_URL ?? "").replace(/\/$/, "");
const CLAVE = () => process.env.NEWSLETTER_AGENT_KEY ?? "";

export const newslettersEnabled = () => !!URL_AGENTE() && !!CLAVE();

/** Marketing / NPD, Diseño y administradores. */
export function canUseNewsletters(u: CurrentUser) {
  return isAdmin(u) || u.departmentKeys.includes("marketing") || u.departmentKeys.includes("diseno");
}

async function llamar(metodo: "GET" | "POST", ruta: string, cuerpo?: unknown): Promise<string> {
  try {
    const r = await fetch(URL_AGENTE() + ruta, {
      method: metodo,
      headers: { Authorization: `Bearer ${CLAVE()}`, "Content-Type": "application/json" },
      body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
      signal: AbortSignal.timeout(30_000),
    });
    const texto = await r.text();
    if (!r.ok) return `El agente de newsletters ha respondido con un error (${r.status}): ${texto.slice(0, 500)}`;
    return texto;
  } catch (e) {
    return `No se ha podido contactar con el agente de newsletters: ${e instanceof Error ? e.message : String(e)}`;
  }
}

const marcas = z.enum(["betreson", "natu"]);
const idiomas = z.enum(["es", "it", "fr", "ro", "en"]);

export const crearNewsletterInput = z.object({
  marca: marcas.describe("betreson (Mailrelay, farmacias, solo español) o natu (Mailchimp, clientes de granel, multiidioma)"),
  tipo_campana: z
    .enum(["lanzamiento", "promo", "estacional", "informativa", "comunicado", "cierre", "felicitacion"])
    .describe("BetrésON: lanzamiento, promo, estacional o informativa. NATU: comunicado, cierre (cierres y horarios) o felicitacion."),
  objetivo: z.string().min(5).max(500).describe("Qué se quiere conseguir con la newsletter"),
  mensaje: z.string().min(5).max(4000).describe("Todo lo que debe aparecer: mensaje, fechas, condiciones, precios… sin inventar nada"),
  asunto_sugerido: z.string().max(120).optional(),
  productos: z
    .array(z.object({ nombre: z.string(), descripcion: z.string().optional(), url: z.string().url().optional(), imagen: z.string().url().optional() }))
    .max(12)
    .optional(),
  imagenes: z.array(z.string().url()).max(10).optional().describe("URLs públicas de imágenes (enlace directo a la imagen)"),
  idiomas: z.array(idiomas).min(1).optional().describe("Solo NATU: idiomas en los que sale. Si no lo dicen, pregunta."),
  fecha_envio: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/).describe("Fecha y hora de envío deseada, hora de Madrid: AAAA-MM-DDTHH:MM"),
  propuestas: z.union([z.literal(1), z.literal(2)]).optional().describe("2 = una editorial y otra comercial para elegir"),
  enviar_prueba_tambien_a: z.string().max(500).optional().describe("Otros emails de la empresa que deben recibir la prueba, separados por comas"),
});

export async function crearNewsletter(u: CurrentUser, i: z.infer<typeof crearNewsletterInput>) {
  return llamar("POST", "/v1/newsletters", {
    marca: i.marca,
    tipo_campana: i.tipo_campana,
    objetivo: i.objetivo,
    mensaje: i.mensaje,
    asunto_sugerido: i.asunto_sugerido,
    productos: i.productos ?? [],
    imagenes: (i.imagenes ?? []).map((url) => ({ url })),
    idiomas: i.marca === "natu" ? i.idiomas : undefined,
    fecha_envio: i.fecha_envio,
    propuestas: i.propuestas ?? 1,
    solicitante_email: u.email, // la prueba y el email de aprobación le llegan a quien lo pide
    destinatarios_prueba: i.enviar_prueba_tambien_a,
  });
}

export const estadoNewsletterInput = z.object({
  peticion_id: z.string().uuid().optional().describe("Si no se indica, devuelve las últimas newsletters de la persona"),
});

export async function estadoNewsletter(u: CurrentUser, i: z.infer<typeof estadoNewsletterInput>) {
  return i.peticion_id
    ? llamar("GET", `/v1/newsletters/${i.peticion_id}`)
    : llamar("GET", `/v1/newsletters?solicitante=${encodeURIComponent(u.email)}&limite=5`);
}

export const cambiosNewsletterInput = z.object({
  peticion_id: z.string().uuid(),
  feedback: z.string().min(5).max(2000).describe("Qué hay que cambiar, con las palabras de la persona"),
  enfoque: z.enum(["editorial", "comercial"]).optional().describe("Solo si había 2 propuestas y quiere cambiar una"),
  imagenes: z.array(z.string().url()).max(10).optional().describe("Imágenes nuevas (enlace directo) para usar en la nueva versión"),
});

export async function pedirCambiosNewsletter(u: CurrentUser, i: z.infer<typeof cambiosNewsletterInput>) {
  return llamar("POST", `/v1/newsletters/${i.peticion_id}/regenerar`, { feedback: i.feedback, enfoque: i.enfoque, imagenes: i.imagenes, actor: u.email });
}

export const pruebaNewsletterInput = z.object({
  peticion_id: z.string().uuid(),
  emails: z.string().min(5).max(500).describe("Emails de la empresa, separados por comas"),
});

export async function reenviarPruebaNewsletter(u: CurrentUser, i: z.infer<typeof pruebaNewsletterInput>) {
  return llamar("POST", `/v1/newsletters/${i.peticion_id}/prueba`, { emails: i.emails, actor: u.email });
}

/** Instrucciones para Alexia (solo se añaden si la persona puede usar newsletters). */
export const NEWSLETTER_GUIDE = `Newsletters (agente de newsletters de NATU): puedes pedir newsletters por la persona.
- BetrésON: marca de farmacia; va por Mailrelay al grupo Farmacias Activas; solo en español; lanzamientos, promos, estacionales o informativas.
- NATU: clientes de granel; va por Mailchimp; una campaña por idioma (es, it, fr, ro), con el texto adaptado; SOLO comunicaciones: comunicados, cierres y horarios, felicitaciones. Por NATU no se lanzan productos.
- Cuando la persona pida preparar, crear, hacer o redactar una newsletter (o un email a clientes de BetrésON o NATU), vas a LLAMAR a crear_newsletter. NO redactes tú el asunto ni el texto en el chat: el agente de newsletters diseña, redacta, maqueta y manda la prueba.
- Antes de llamar, repasa lo mismo que pide el formulario y pregunta EN UN SOLO MENSAJE (lista corta) solo lo que falte:
  · Marca (BetrésON o NATU) y tipo (BetrésON: lanzamiento, promoción, estacional o informativa; NATU: comunicado, cierre o felicitación).
  · Objetivo y mensaje con los textos clave: fechas, condiciones, precios… todo lo que deba aparecer.
  · Productos (sobre todo en BetrésON): nombre, descripción breve y enlace, si los hay.
  · Imágenes: enlaces directos a las imágenes (URL pública que se abre como imagen; los enlaces de SharePoint/OneDrive no sirven porque piden iniciar sesión). Si no tiene, se hace sin fotos. Por Teams no puedes recibir archivos adjuntos: si quiere subir fotos, puede usar el formulario de n8n.
  · Fecha y hora de envío (hora de Madrid). En NATU, los idiomas (español, italiano, francés, rumano).
  · Opcionales, en una sola línea: asunto sugerido, 1 o 2 propuestas (editorial y comercial) y si la prueba debe ir también a otros emails de la empresa.
  Si la persona ya ha dado algo, no lo vuelvas a preguntar. Si dice que no tiene o que da igual, sigue sin ello. Con la respuesta, llama a crear_newsletter pasando sus datos tal cual (sin inventar fechas, precios ni condiciones).
- Si dice que es una prueba, llámala igualmente: las pruebas solo llegan a emails de la empresa y nada se envía a clientes sin aprobación.
- Para añadir o cambiar imágenes después, usa pedir_cambios_newsletter con «imagenes».
- crear_newsletter y pedir_cambios_newsletter tardan 1–3 minutos en segundo plano: di que está en marcha y que le llegarán por email la prueba y el email de aprobación. Para saber cómo va, usa estado_newsletter.
- No puedes programar ni enviar una newsletter: se aprueba con el botón «Aprobar y programar» del email de aprobación (cualquiera del equipo puede aprobar).`;
