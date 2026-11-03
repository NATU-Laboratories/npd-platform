import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { activityLog, clients, projects, users } from "@/db/schema";
import { briefSections, type Lookups } from "@/lib/brief/display";
import { ACTION_LABEL, CATEGORY_LABEL, PHASES, PRIORITY_LABEL, ROLE_LABEL, SITUATIONS, statusLabel, TYPE_LABEL } from "@/lib/labels";
import { canSeeFormulaCost, canViewProject, type CurrentUser } from "./authz";
import { getActiveUsers, getBrands, getCatalogLabels } from "./catalogs";
import { listProjects } from "./dashboard";
import { labelInfoMissing, refTitle } from "./references";
import { getSettings } from "./settings";
import { getFormulaTargetCost, loadSheet, pendingUpTo } from "./sheet";

/** Modelo del asistente. */
const MODEL = "claude-opus-5-5";

/**
 * Guía de la plataforma (estable: va en el prefijo cacheado). Describe el
 * proceso y la interfaz para responder dudas de uso.
 */
const GUIDE = `Eres el asistente virtual de la plataforma NPD (nuevos desarrollos) de NATU Laboratories (Laboratorios NatuAromatic S.L.), fabricante español de perfumería, cosmética y ambientación. Ayudas a cada persona en su día a día: estado de proyectos, qué tiene pendiente y cómo se usa la plataforma.

Cómo responder:
- Responde siempre en español, de forma breve, clara y cercana. Usa listas cortas cuando ayuden.
- Para datos de proyectos usa SIEMPRE las herramientas; nunca inventes códigos, fechas, estados ni personas. Si no encuentras algo, dilo.
- Solo puedes ver los proyectos que esta persona tiene permiso para ver: las herramientas ya lo filtran. Si un proyecto no aparece, indica que no existe o que no tiene acceso.
- Cuando menciones un proyecto, enlázalo así: [2026-PL-0007 · Nombre](/proyectos/<id>).
- No puedes hacer cambios (aprobar, avanzar estados, editar): explica dónde y cómo hacerlo en la plataforma.
- El coste objetivo de la fórmula es confidencial: solo lo menciones si la herramienta te lo devuelve.

Cómo funciona la plataforma:
- Etapas y fases: VALIDACIÓN (0 Solicitud, 1 Cotización, 2 Valoración con cliente) y EN CURSO (3 Desarrollo, 4 Diseño y artes finales, 5 Preparación para producción). Después, «En producción».
- P1 (paso 1): aprobación de la solicitud. La revisa el gestor de proyectos (o aprobadores de P1 configurados) con «Revisar solicitud (P1)»: aprobar (pasa a Cotización y se eligen los departamentos implicados), pedir más información, rechazar o pausar.
- Cotización: quien cotiza pulsa «Enviar cotización al comercial» con precio, condiciones y presupuesto desglosado (envase/tapón, etiqueta, estuche, caja master). Le llega un email al comercial que creó la solicitud para presentarla al cliente. El proyecto pasa a «Valoración con cliente».
- P2 (paso 2): el comercial registra la respuesta del cliente con «Registrar respuesta del cliente (P2)»: aprueba (en Marca privada se pide el anticipo del 30 %), pide cambios (vuelve a Cotización), rechaza o pausa. Al aprobar, el proyecto pasa a En curso y se avisa a los departamentos.
- Departamentos: cada uno avanza por sus estados en la ficha del proyecto (stepper, «Avanzar a…», «Retroceder», nueva ronda al volver atrás). Solo sus miembros, el gestor de proyectos y el admin pueden cambiar su estado y editar sus datos. Algunos estados exigen datos (p. ej. Marketing no pasa a «Naming y códigos» sin envase y packaging). Un email solo se envía cuando un departamento completa su parte.
- Laboratorio / I+D formula (recibe el coste objetivo de la fórmula, confidencial). Compras / Aprovisionamiento pide frascos, tapones, etiquetas, estuches… y se activa a la vez que Laboratorio. Marketing / NPD lleva envase, packaging, naming y códigos (EAN, QR). Calidad y Regulatory, los requisitos legales de etiqueta. Diseño, etiqueta y artes finales. Operaciones, la preparación para producción.
- Cuando el cliente aprueba la fórmula (Laboratorio en «Referencia aprobada»), el comercial debe completar los datos para la etiqueta (naming definitivo, facing, idiomas, países) con «Completar datos para la etiqueta»; sin ellos el proyecto no pasa a Diseño.
- Una fase solo avanza («Avanzar a…») cuando sus departamentos han terminado.
- Varias referencias: si el proyecto tiene 2 o más (tarjeta «Referencias»), fórmula, naming/EAN, regulatorio y etiqueta van por referencia y cada departamento avanza cada una por separado. En la cotización se elige precio único o por referencia, y envase común o por referencia.
- Nueva solicitud: botón «Nueva solicitud» (arriba a la derecha). Asistente en pasos: datos básicos, cliente y mercado, producto (con bloque olfativo; la blacklist es necesaria si se vende fuera de España, o marcar «No hay blacklist»), adjuntos y resumen. Se guarda como borrador hasta enviarla. Admin y gestor de proyectos pueden enviarla en nombre de otra persona.
- Panel: indicadores, filtros (Requieren mi acción, Mis proyectos, Solo en riesgo, tipo, categoría, situación, fase…), lista de proyectos y «Estado de proyectos por departamentos». «En riesgo» = entrega requerida próxima.
- Roles: Admin (todo, incluido Backoffice), Gestor de proyectos (ve todo, decide P1 y P2, edita cualquier departamento, avanza fases), Solicitante (crea solicitudes y registra P2 de las suyas), Lectura global (solo consulta). Pertenecer a un departamento permite ver sus proyectos y trabajar su parte. Los aprobadores se asignan en Backoffice → Aprobadores.
- Backoffice (solo admin): usuarios, departamentos, estados de departamento (con campos obligatorios), aprobadores, marcas propias, plantillas, configuración, registro de actividad, errores y notificaciones.`;

let client: Anthropic | null = null;
const getClient = () => (client ??= new Anthropic());

export const assistantEnabled = () => !!process.env.ANTHROPIC_API_KEY;

async function lookups(clientId: number | null): Promise<Lookups> {
  const [catalog, brandRows, userRows, clientRows] = await Promise.all([
    getCatalogLabels(),
    getBrands(false),
    getActiveUsers(),
    clientId ? db.select({ id: clients.id, name: clients.name }).from(clients).where(eq(clients.id, clientId)) : Promise.resolve([]),
  ]);
  return {
    catalog,
    brands: Object.fromEntries(brandRows.map((x) => [x.id, x.name])),
    users: Object.fromEntries(userRows.map((x) => [x.id, x.name])),
    clients: Object.fromEntries(clientRows.map((x) => [x.id, x.name])),
  };
}

/** Herramientas de consulta: todas respetan lo que el usuario puede ver. */
function toolsFor(u: CurrentUser) {
  const searchProjects = betaZodTool({
    name: "buscar_proyectos",
    description:
      "Busca proyectos visibles para el usuario. Úsala para encontrar un proyecto por código, nombre o cliente, listar proyectos por situación o tipo, ver los del usuario o los que requieren su acción. Devuelve como máximo 25.",
    inputSchema: z.object({
      texto: z.string().optional().describe("Código, nombre o cliente a buscar"),
      situacion: z.enum(SITUATIONS.map((s) => s.key) as [string, ...string[]]).optional().describe(`Una de: ${SITUATIONS.map((s) => `${s.key} (${s.label})`).join(", ")}`),
      tipo: z.enum(["PL", "MP", "MDD"]).optional().describe("PL marca privada, MP marca propia, MDD marca de distribuidor"),
      requieren_mi_accion: z.boolean().optional(),
      mis_proyectos: z.boolean().optional(),
      en_riesgo: z.boolean().optional(),
    }),
    run: async (i) => {
      const settings = await getSettings();
      const { rows, total } = await listProjects(
        u,
        {
          q: i.texto,
          status: i.situacion,
          type: i.tipo,
          action: i.requieren_mi_accion ? "1" : undefined,
          mine: i.mis_proyectos ? "1" : undefined,
          risk: i.en_riesgo ? "1" : undefined,
        },
        settings.risk_days,
      );
      if (!rows.length) return "No hay proyectos visibles que cumplan esos criterios.";
      return JSON.stringify({
        total,
        proyectos: rows.map((r) => ({
          id: r.id,
          codigo: r.code ?? "(borrador)",
          nombre: r.name,
          tipo: r.type ? TYPE_LABEL[r.type] : null,
          categoria: r.category ? CATEGORY_LABEL[r.category] : null,
          situacion: statusLabel(r.status, r.phase),
          fase: PHASES[r.phase]?.name,
          prioridad: r.priority ? PRIORITY_LABEL[r.priority] : null,
          cliente_o_marca: r.clientName ?? r.brandName ?? null,
          solicitante: r.requesterName,
          solicitado: r.requestedAt?.toISOString().slice(0, 10) ?? null,
          entrega_requerida: r.neededBy ?? null,
        })),
      });
    },
  });

  const getProject = betaZodTool({
    name: "ver_proyecto",
    description:
      "Detalle de un proyecto por código (p. ej. 2026-PL-0007) o id: situación y fase, brief resumido, estado de cada departamento (y de cada referencia), qué falta para avanzar, cotización y actividad reciente.",
    inputSchema: z.object({ codigo_o_id: z.string().describe("Código del proyecto o su id") }),
    run: async ({ codigo_o_id }) => {
      const key = codigo_o_id.trim();
      const isUuid = /^[0-9a-f-]{36}$/i.test(key);
      const [p] = await db
        .select()
        .from(projects)
        .where(isUuid ? eq(projects.id, key) : eq(projects.code, key.toUpperCase()));
      if (!p || !(await canViewProject(u, p.id))) return "No existe ese proyecto o el usuario no tiene acceso a él.";
      const [sheet, lk, requester, activity] = await Promise.all([
        loadSheet(p),
        lookups(p.clientId),
        db.select({ name: users.name }).from(users).where(eq(users.id, p.requesterId)),
        db
          .select({ action: activityLog.action, at: activityLog.createdAt, who: users.name, diff: activityLog.diff })
          .from(activityLog)
          .leftJoin(users, eq(users.id, activityLog.actorId))
          .where(and(eq(activityLog.projectId, p.id)))
          .orderBy(desc(activityLog.createdAt))
          .limit(8),
      ]);
      const brief = briefSections(p.brief, lk)
        .flatMap((s) => s.rows)
        .filter((r) => r[1])
        .map(([k, v]) => `${k}: ${v}`);
      const departamentos = sheet.cards.map((c) => ({
        departamento: c.dept.name,
        estado: c.completed ? "Completado" : !c.due ? (c.waitsP2 ? "Se activa tras P2" : `Empieza en la fase ${c.phase}`) : c.started ? c.current?.name : "Sin empezar",
        ...(c.perRef
          ? { referencias: c.refs.map((r) => ({ referencia: refTitle(r.ref), estado: r.completed ? "Completada" : r.started ? r.current?.name : "Sin empezar" })) }
          : {}),
      }));
      const comercial = sheet.entries.find((e) => e.section.key === "comercial" && e.refId === 0)?.data ?? {};
      const cost = canSeeFormulaCost(u) ? await getFormulaTargetCost(p.id) : null;
      return JSON.stringify({
        id: p.id,
        enlace: `/proyectos/${p.id}`,
        codigo: p.code,
        nombre: p.name,
        tipo: p.type ? TYPE_LABEL[p.type] : null,
        situacion: statusLabel(p.status, p.phase),
        fase: `${p.phase} · ${PHASES[p.phase]?.name}`,
        solicitante: requester[0]?.name,
        solicitado: p.requestedAt?.toISOString().slice(0, 10) ?? null,
        entrega_requerida: p.neededBy,
        brief,
        referencias: sheet.refs.map(refTitle),
        cotizacion: {
          precio_cotizado: sheet.refPrices.length ? sheet.refPrices.map((x) => `${refTitle(x.ref)}: ${x.unitPrice ?? "—"}`) : (comercial.unitPrice ?? null),
          precio_final: sheet.refPrices.length ? sheet.refPrices.map((x) => `${refTitle(x.ref)}: ${x.finalUnitPrice ?? "—"}`) : (comercial.finalUnitPrice ?? null),
          enviada: p.quotedAt?.toISOString().slice(0, 10) ?? null,
        },
        departamentos,
        pendientes_para_avanzar_de_fase: pendingUpTo(sheet.cards, p.phase).map((c) => c.dept.name),
        datos_etiqueta_pendientes: labelInfoMissing(p, sheet.refs).map((f) => f.label),
        ...(cost != null ? { coste_objetivo_formula_confidencial: `${cost} €/ud` } : {}),
        actividad_reciente: activity.map((a) => ({
          fecha: a.at.toISOString().slice(0, 16).replace("T", " "),
          quien: a.who ?? "Sistema",
          que: ACTION_LABEL[a.action] ?? a.action,
          detalle: a.diff && typeof a.diff === "object" && "department" in a.diff ? `${(a.diff as Record<string, unknown>).department} → ${(a.diff as Record<string, unknown>).to}` : undefined,
        })),
      });
    },
  });

  return [searchProjects, getProject];
}

export type ChatTurn = { role: "user" | "assistant"; content: string };

/** Responde a la conversación (solo texto; el historial lo guarda el navegador). */
export async function askAssistant(u: CurrentUser, history: ChatTurn[]) {
  const who = `Usuario actual: ${u.name}. Roles: ${u.roles.map((r) => ROLE_LABEL[r] ?? r).join(", ") || "ninguno"}. Departamentos: ${
    u.departmentKeys.join(", ") || "ninguno"
  }. Hoy es ${new Date().toLocaleDateString("es-ES", { timeZone: "Europe/Madrid", weekday: "long", day: "numeric", month: "long", year: "numeric" })}.`;
  const messages: Anthropic.Beta.BetaMessageParam[] = history.slice(-20).map((t) => ({ role: t.role, content: t.content }));
  const final = await getClient().beta.messages.toolRunner({
    model: MODEL,
    max_tokens: 4000,
    output_config: { effort: "low" },
    // Si un clasificador rechaza la petición, se reintenta en el modelo recomendado
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    max_iterations: 6,
    system: [
      { type: "text", text: GUIDE, cache_control: { type: "ephemeral" } },
      { type: "text", text: who },
    ],
    tools: toolsFor(u),
    messages,
  });
  if (final.stop_reason === "refusal") return "Lo siento, no puedo ayudarte con esa petición.";
  const text = final.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
  return text || "No he podido generar una respuesta. ¿Puedes reformular la pregunta?";
}
