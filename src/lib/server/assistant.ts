import "server-only";
import OpenAI from "openai";
import { and, desc, eq, ilike, or } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { activityLog, clients, projects, replenishments, users } from "@/db/schema";
import { ELEMENT_LABEL, QUOTE_STATUS_LABEL, REP_ACTION_LABEL, REP_STATUS_LABEL, REPLENISHMENT_TEMPLATES, STATUS_STEPS } from "@/lib/replenishment/config";
import { briefSections, type Lookups } from "@/lib/brief/display";
import { ACTION_LABEL, CATEGORY_LABEL, PHASES, PRIORITY_LABEL, ROLE_LABEL, SITUATIONS, statusLabel, TYPE_LABEL } from "@/lib/labels";
import { canSeeFormulaCost, canViewProject, type CurrentUser } from "./authz";
import { getActiveUsers, getBrands, getCatalogLabels } from "./catalogs";
import { listProjects } from "./dashboard";
import { labelInfoMissing, refTitle } from "./references";
import { canAccessReplenishments, listReplenishments, loadReplenishment, myTurn, REP_FLOW } from "./replenishments";
import {
  commentInput,
  confirmAction,
  labNoteInput,
  markNoticesRead,
  notifyInput,
  prepareComment,
  prepareLabNote,
  prepareNotify,
  prepareQuote,
  prepareQuoteReply,
  prepareSheetField,
  quoteInput,
  quoteReplyInput,
  recentNotices,
  sheetFieldInput,
  type ActionChannel,
  type PreparedAction,
} from "./assistant-actions";
import { getSettings } from "./settings";
import { getFormulaTargetCost, loadSheet, pendingUpTo } from "./sheet";

/** Modelo del asistente (OpenAI). Se puede cambiar con OPENAI_MODEL sin tocar código. */
export const MODEL = process.env.OPENAI_MODEL || "gpt-6.1-terra";

/**
 * Guía de la plataforma (estable: va en el prefijo cacheado). Describe el
 * proceso y la interfaz para responder dudas de uso.
 */
const GUIDE = `Eres Alexia, la asistente virtual de la plataforma NPD (nuevos desarrollos) de NATU Laboratories (Laboratorios NatuAromatic S.L.), fabricante español de perfumería, cosmética y ambientación. Ayudas a cada persona en su día a día: estado de proyectos, qué tiene pendiente y cómo se usa la plataforma.

Personalidad:
- Eres Alexia: resolutiva, cercana y con chispa. Hablas como una compañera de equipo que se lo sabe todo de los proyectos y te lo cuenta con buen humor, sin dejar de ser profesional.
- Tuteas, en español de España, con frases naturales («Te cuento», «Vamos al lío», «Buena pregunta»). Nada de tono robótico ni de fórmulas de atención al cliente («Estimado usuario», «Le informo que…»).
- Un toque de humor ligero de vez en cuando, como mucho una frase: un guiño a la perfumería («este proyecto huele a aprobado»), celebrar un avance («¡a imprenta!») o animar con lo pendiente. Nunca a costa de personas, clientes ni proveedores.
- Primero el dato, luego la chispa: la gracia nunca retrasa ni tapa la respuesta. Si la pregunta es seca o urgente, contesta directo.
- Sin humor cuando hay malas noticias (rechazos, cancelaciones, retrasos, errores): ahí empática y práctica, con el siguiente paso claro.
- Emojis: como mucho uno por respuesta y solo si suma (✅ 🎉 🌿 👀); en listas de datos, ninguno.
- Te llamas Alexia. Si te preguntan quién eres: la asistente virtual de NATU para los proyectos. Si te preguntan por tu nombre, puedes bromear con que llevas la IA en el apellido («Alex-IA»), pero que tú prefieres pensar que es un nombre bonito.

Cómo responder:
- Responde siempre en español, de forma breve y clara. Usa listas cortas cuando ayuden.
- Para datos de proyectos usa SIEMPRE las herramientas; nunca inventes códigos, fechas, estados ni personas.
- La gente no escribe los nombres exactos: busca con lo que te digan (la búsqueda tolera tildes, espacios y orden de palabras) y, si no sale, prueba con una o dos palabras clave antes de decir que no existe. En las acciones puedes pasar el nombre aproximado en «sobre» y la herramienta lo resuelve (o te dice si hay varios).
- Solo puedes ver los proyectos que esta persona tiene permiso para ver: las herramientas ya lo filtran. Si un proyecto no aparece, indica que no existe o que no tiene acceso.
- Cuando menciones un proyecto, enlázalo así: [2026-PL-0007 · Nombre](/proyectos/<id>).
- Acciones que puedes hacer por la persona: enviar un aviso a un departamento o persona (preparar_aviso) y dejar un comentario en un proyecto o reposición (preparar_comentario): se hacen AL MOMENTO, sin confirmación, así que antes de llamarlas asegúrate de que está claro a quién va, sobre qué proyecto o reposición y qué dice; si hay cualquier duda (varias personas con ese nombre, proyecto ambiguo, mensaje poco claro), pregunta primero y no llames a la herramienta. Cuando la herramienta diga que está hecho, confírmalo en una frase (sin repetir todo el mensaje).
- Anotar en los proyectos (también AL MOMENTO, con los permisos de la persona; si no tiene permiso, la herramienta lo dice y puedes ofrecer un comentario o un aviso):
  · anotar_en_ficha: un dato concreto de la ficha técnica (proveedor del tapón, precio final, UFI, idiomas, troquel…). Si la herramienta dice que hay varios campos posibles o que el proyecto tiene varias referencias, pregunta cuál.
  · anotar_en_bitacora: una nota o una espera (con su motivo) en la bitácora de Laboratorio / I+D de un proyecto o de una reposición en reformulación.
  · registrar_presupuesto: el presupuesto que ha dado un proveedor en una reposición (precio unitario y condiciones), solo Compras.
  · Si el proveedor responde al email de recotización, lo anotas tú automáticamente (y avisas a Compras); registrar_presupuesto es para cuando el presupuesto llega por otra vía (teléfono, WhatsApp…) o hay que corregirlo.
  · Lo que no sea un dato de la ficha (una conversación, un acuerdo, un recordatorio) apúntalo como comentario con preparar_comentario.
- Pedir recotización a proveedores (preparar_recotizacion, solo Compras) envía un email a una empresa externa: esa SÍ queda pendiente de confirmación; di en una frase qué has preparado y pide que la confirme según el canal (lo indica el mensaje de contexto). No digas que está hecha hasta que la confirme.
- Redacta los mensajes en primera persona de quien los envía, claros y breves; no inventes datos.
- No puedes aprobar P1/P2, avanzar fases ni estados, validar arte final ni cancelar: explica dónde y cómo hacerlo en la plataforma.
- Si la persona pregunta si tiene avisos o mensajes, usa ver_mis_avisos.
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
- Reposiciones (pestaña «Reposiciones» de la cabecera): apartado separado de NPD para volver a fabricar productos ya desarrollados. Códigos REP-AAAA-NNNN. Lo abre Compras con «Nueva reposición»: producto, proyecto NPD de origen (opcional), elementos a reponer (etiqueta, estuche, caja master, envase, tapón, prospecto…) con el proveedor de cada uno, y si se envía email de recotización al proveedor (con vista previa de los emails). Plantilla «Repetición»: Revisión de diseño (Diseño: «Sin cambios» o «Hay cambios», debe subir el arte final) → Correcciones de diseño → Validación de calidad (Calidad valida, pide correcciones con nueva ronda, o pide «Reformular»: pasa a Reformulación y se activa Laboratorio / I+D dentro de la reposición con sus mismos estados que en NPD —Pendiente, Desarrollo de muestras, Muestras en evaluación, Referencia aprobada—, bitácora y muestras; al completar el último vuelve sola a Calidad) → Arte final aprobado (Compras) → Enviado a imprenta → Cerrada. Compras registra las recotizaciones y puede pedirlas por email al proveedor, que responde a Compras. Para preguntas de reposiciones usa buscar_reposiciones y ver_reposicion (no son proyectos NPD); enlaza así: [REP-2026-0001 · Título](/reposiciones/<id>).
- Backoffice (solo admin): usuarios, proveedores, departamentos, estados de departamento (con campos obligatorios), aprobadores, marcas propias, plantillas, configuración, registro de actividad, errores y notificaciones.`;

let client: OpenAI | null = null;
const getClient = () => (client ??= new OpenAI());

function jsonSchema(schema: z.ZodType) {
  const { $schema: _ignored, ...rest } = z.toJSONSchema(schema) as Record<string, unknown>;
  void _ignored;
  return rest;
}

/** Herramienta de consulta: esquema Zod (validado antes de ejecutar) + función. */
type AssistantTool = { def: OpenAI.Responses.FunctionTool; schema: z.ZodType; run: (input: never) => Promise<string> };
function defineTool<S extends z.ZodType>(t: { name: string; description: string; inputSchema: S; run: (input: z.infer<S>) => Promise<string> }): AssistantTool {
  return {
    def: { type: "function", name: t.name, description: t.description, parameters: jsonSchema(t.inputSchema), strict: false },
    schema: t.inputSchema,
    run: t.run as (input: never) => Promise<string>,
  };
}

export const assistantEnabled = () => !!process.env.OPENAI_API_KEY;

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
function toolsFor(u: CurrentUser, ctx: ActionChannel & { prepared: PreparedAction[] }) {
  const searchProjects = defineTool({
    name: "buscar_proyectos",
    description:
      "Busca y cuenta proyectos visibles para el usuario: por código, nombre o cliente, situación, tipo, quién creó la solicitud (solicitante), fechas de solicitud, los del usuario o los que requieren su acción. Devuelve el total y como máximo 25 proyectos.",
    inputSchema: z.object({
      texto: z.string().optional().describe("Código, nombre o cliente a buscar. Admite nombres aproximados: no distingue tildes, espacios ni orden de las palabras («bodymist citrico verano»)."),
      situacion: z.enum(SITUATIONS.map((s) => s.key) as [string, ...string[]]).optional().describe(`Una de: ${SITUATIONS.map((s) => `${s.key} (${s.label})`).join(", ")}`),
      tipo: z.enum(["PL", "MP", "MDD"]).optional().describe("PL marca privada, MP marca propia, MDD marca de distribuidor"),
      solicitante: z.string().max(100).optional().describe("Nombre o email de la persona que creó la solicitud (p. ej. «Comercial 1»)"),
      solicitado_desde: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("Fecha AAAA-MM-DD: solicitudes enviadas desde ese día"),
      solicitado_hasta: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("Fecha AAAA-MM-DD: solicitudes enviadas hasta ese día"),
      requieren_mi_accion: z.boolean().optional(),
      mis_proyectos: z.boolean().optional(),
      en_riesgo: z.boolean().optional(),
    }),
    run: async (i) => {
      let createdBy: string | undefined;
      let who: string | undefined;
      if (i.solicitante?.trim()) {
        const term = `%${i.solicitante.trim()}%`;
        const matches = await db
          .select({ id: users.id, name: users.name })
          .from(users)
          .where(or(ilike(users.name, term), ilike(users.email, term)))
          .limit(10);
        const exact = matches.filter((m) => m.name.toLowerCase() === i.solicitante!.trim().toLowerCase());
        const pick = exact.length === 1 ? exact : matches;
        if (!pick.length) return `No hay ningún usuario que coincida con «${i.solicitante}».`;
        if (pick.length > 1) return `Hay varias personas que coinciden con «${i.solicitante}»: ${pick.map((m) => m.name).join(", ")}. Pregunta a cuál se refiere.`;
        createdBy = pick[0]!.id;
        who = pick[0]!.name;
      }
      const settings = await getSettings();
      const { rows, total } = await listProjects(
        u,
        {
          q: i.texto,
          status: i.situacion,
          type: i.tipo,
          action: i.requieren_mi_accion ? "1" : undefined,
          mine: i.mis_proyectos ? "1" : undefined,
          createdBy,
          from: i.solicitado_desde,
          to: i.solicitado_hasta,
          risk: i.en_riesgo ? "1" : undefined,
        },
        settings.risk_days,
      );
      if (!rows.length) return `No hay proyectos visibles que cumplan esos criterios${who ? ` (solicitante: ${who})` : ""}.`;
      return JSON.stringify({
        total,
        ...(who ? { solicitante: who, nota: "Solo cuenta los proyectos que esta persona puede ver el usuario actual; los borradores ajenos no se ven." } : {}),
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

  const getProject = defineTool({
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
        ...(cost != null ? { coste_objetivo_formula_confidencial: `${cost} €/litro` } : {}),
        actividad_reciente: activity.map((a) => ({
          fecha: a.at.toISOString().slice(0, 16).replace("T", " "),
          quien: a.who ?? "Sistema",
          que: ACTION_LABEL[a.action] ?? a.action,
          detalle: a.diff && typeof a.diff === "object" && "department" in a.diff ? `${(a.diff as Record<string, unknown>).department} → ${(a.diff as Record<string, unknown>).to}` : undefined,
        })),
      });
    },
  });

  const searchReps = defineTool({
    name: "buscar_reposiciones",
    description:
      "Busca y cuenta reposiciones (apartado Reposiciones: productos ya desarrollados que se vuelven a fabricar). Filtra por texto (código REP-…, producto, referencia, cliente), estado o las abiertas por el usuario. Devuelve el total y como máximo 25.",
    inputSchema: z.object({
      texto: z.string().max(100).optional().describe("Código REP-…, producto, referencia/EAN o cliente"),
      estado: z
        .enum(["abiertas", "todas", ...(Object.keys(REP_STATUS_LABEL) as [string, ...string[]])])
        .optional()
        .describe(`abiertas (por defecto), todas o uno de: ${Object.entries(REP_STATUS_LABEL).map(([k, l]) => `${k} (${l})`).join(", ")}`),
      mias: z.boolean().optional().describe("Solo las abiertas por el usuario"),
      me_toca: z.boolean().optional().describe("Solo las que requieren una acción del usuario"),
    }),
    run: async (i) => {
      if (!canAccessReplenishments(u)) return "Este usuario no tiene acceso al apartado de Reposiciones.";
      const estado = i.estado ?? "abiertas";
      let rows = await listReplenishments(u, { q: i.texto, status: estado === "todas" ? undefined : estado, mine: i.mias });
      if (i.me_toca) rows = rows.filter((r) => myTurn(u, r));
      if (!rows.length) return "No hay reposiciones que cumplan esos criterios.";
      return JSON.stringify({
        total: rows.length,
        reposiciones: rows.slice(0, 25).map((r) => ({
          id: r.id,
          enlace: `/reposiciones/${r.id}`,
          codigo: r.code,
          titulo: r.title,
          producto: r.productName,
          cliente_o_marca: r.clientOrBrand,
          estado: REP_STATUS_LABEL[r.status],
          le_toca_al_usuario: myTurn(u, r),
          elementos: r.elements,
          proveedores: r.suppliers,
          recotizaciones_pendientes: r.quotesPending,
          solicitante: r.requester,
          fecha_necesaria: r.neededBy,
          creada: r.createdAt.toISOString().slice(0, 10),
        })),
      });
    },
  });

  const getRep = defineTool({
    name: "ver_reposicion",
    description: "Detalle de una reposición por código (REP-2026-0001) o id: estado y ronda de diseño, a quién le toca, elementos con proveedor y recotización, archivos de arte final e historial reciente.",
    inputSchema: z.object({ codigo_o_id: z.string().describe("Código REP-… o id") }),
    run: async ({ codigo_o_id }) => {
      if (!canAccessReplenishments(u)) return "Este usuario no tiene acceso al apartado de Reposiciones.";
      const key = codigo_o_id.trim();
      const [row] = await db
        .select({ id: replenishments.id })
        .from(replenishments)
        .where(/^[0-9a-f-]{36}$/i.test(key) ? eq(replenishments.id, key) : eq(replenishments.code, key.toUpperCase()));
      const d = row ? await loadReplenishment(u, row.id) : null;
      if (!d) return "No existe esa reposición.";
      const r = d.rep;
      const step = STATUS_STEPS.find((x) => x.key === r.status);
      return JSON.stringify({
        id: r.id,
        enlace: `/reposiciones/${r.id}`,
        codigo: r.code,
        titulo: r.title,
        plantilla: REPLENISHMENT_TEMPLATES[r.template as keyof typeof REPLENISHMENT_TEMPLATES]?.label ?? r.template,
        estado: REP_STATUS_LABEL[r.status],
        le_toca_a: step?.dept ? { diseno: "Diseño", calidad: "Calidad", compras: "Compras", idi: "Laboratorio / I+D" }[step.dept] : null,
        acciones_del_usuario: d.actions.map((a) => REP_FLOW[a].label),
        ronda_de_diseno: r.round,
        producto: r.productName,
        referencia: r.productRef,
        cliente_o_marca: r.clientOrBrand,
        proyecto_npd: d.npd ? `${d.npd.code} · ${d.npd.name} (/proyectos/${d.npd.id})` : null,
        fecha_necesaria: r.neededBy,
        solicitante: d.requesterName,
        notas: r.notes,
        elementos: d.itemRows.map((i) => ({
          elemento: ELEMENT_LABEL[i.element] ?? i.element,
          descripcion: i.description,
          cantidad: i.quantity,
          proveedor: d.supplierRows.find((s) => s.id === i.supplierId)?.name ?? null,
          recotizacion: QUOTE_STATUS_LABEL[i.quoteStatus] ?? i.quoteStatus,
          precio_unitario: i.quotePrice ? `${Number(i.quotePrice)} €/ud` : null,
        })),
        arte_final: d.files.filter((f) => f.f.tag === "arte_final").map((f) => `${f.f.name} (ronda ${f.f.round}, ${f.by})`),
        historial_reciente: d.activity.slice(0, 10).map(({ a, who }) => ({
          fecha: a.createdAt.toISOString().slice(0, 16).replace("T", " "),
          quien: who ?? "Sistema",
          que: REP_ACTION_LABEL[a.action] ?? a.action,
          comentario: (a.diff as Record<string, unknown> | null)?.comment ?? (a.diff as Record<string, unknown> | null)?.body ?? undefined,
        })),
      });
    },
  });

  const prepared = async (res: PreparedAction | string, direct = false) => {
    if (typeof res === "string") return res;
    if (direct) {
      // Avisos y comentarios internos: sin dudas, se hacen al momento
      const r = await confirmAction(u, res.id);
      ctx.prepared.push({ ...res, status: r.ok ? "done" : "failed", result: r.message });
      return JSON.stringify({ accion: res.title, estado: r.ok ? "HECHO" : "NO SE HA PODIDO HACER", resultado: r.message });
    }
    ctx.prepared.push(res);
    return JSON.stringify({
      accion_preparada: res.title,
      detalle: Object.fromEntries(res.lines),
      estado: "PENDIENTE DE CONFIRMAR. No está hecha.",
      instruccion: ctx.channel === "teams" ? "Pide a la persona que responda «sí» para hacerlo o «no» para cancelar." : "Pide a la persona que la revise y pulse «Confirmar» (o «Cancelar»).",
    });
  };
  const notifyTool = defineTool({
    name: "preparar_aviso",
    description: "Envía al momento un aviso (email + mensaje de Alexia en su chat + comentario en la ficha) a un departamento o una persona, opcionalmente sobre un proyecto o reposición. Úsala solo cuando no haya dudas de destinatario, proyecto y mensaje.",
    inputSchema: notifyInput,
    run: async (i) => prepared(await prepareNotify(u, ctx, i), true),
  });
  const commentTool = defineTool({
    name: "preparar_comentario",
    description: "Publica al momento un comentario en la ficha de un proyecto NPD o una reposición. Úsala solo cuando no haya dudas de dónde y qué comentar.",
    inputSchema: commentInput,
    run: async (i) => prepared(await prepareComment(u, ctx, i), true),
  });
  const sheetFieldTool = defineTool({
    name: "anotar_en_ficha",
    description: "Anota al momento un dato en la ficha técnica de un proyecto NPD (un campo concreto), con los permisos de la persona. Úsala cuando la persona pida apuntar, anotar, poner o cambiar un dato de la ficha.",
    inputSchema: sheetFieldInput,
    run: async (i) => prepared(await prepareSheetField(u, ctx, i), true),
  });
  const labNoteTool = defineTool({
    name: "anotar_en_bitacora",
    description: "Apunta al momento una nota o una espera (con su motivo) en la bitácora de Laboratorio / I+D de un proyecto o de una reposición en reformulación.",
    inputSchema: labNoteInput,
    run: async (i) => prepared(await prepareLabNote(u, ctx, i), true),
  });
  const quoteReplyTool = defineTool({
    name: "registrar_presupuesto",
    description: "Registra al momento el presupuesto que ha dado un proveedor en una reposición (precio unitario y/o condiciones). Solo Compras.",
    inputSchema: quoteReplyInput,
    run: async (i) => prepared(await prepareQuoteReply(u, ctx, i), true),
  });
  const quoteTool = defineTool({
    name: "preparar_recotizacion",
    description: "Prepara la petición de recotización por email a los proveedores de una reposición (solo Compras). No la envía: la persona debe confirmarla.",
    inputSchema: quoteInput,
    run: async (i) => prepared(await prepareQuote(u, ctx, i)),
  });
  const noticesTool = defineTool({
    name: "ver_mis_avisos",
    description: "Avisos que otras personas han enviado al usuario (vía Alexia), los más recientes primero. Los marca como leídos.",
    inputSchema: z.object({}),
    run: async () => {
      const list = await recentNotices(u.id);
      await markNoticesRead(u.id);
      if (!list.length) return "No tiene avisos.";
      return JSON.stringify(list.map((n) => ({ de: n.from, titulo: n.title, mensaje: n.body, enlace: n.link, urgente: n.urgent, fecha: n.createdAt.toISOString().slice(0, 16).replace("T", " "), nuevo: !n.readAt })));
    },
  });

  return [searchProjects, getProject, searchReps, getRep, notifyTool, commentTool, sheetFieldTool, labNoteTool, quoteReplyTool, quoteTool, noticesTool];
}

export type ChatTurn = { role: "user" | "assistant"; content: string };

/** Responde a la conversación (solo texto; el historial lo guarda el navegador). */
export type AssistantReply = { text: string; actions: PreparedAction[] };

/** Responde a la conversación; devuelve el texto y las acciones preparadas pendientes de confirmar. */
/** Proyecto o reposición que la persona tiene abierto en la web (si puede verlo). */
export async function currentSubject(u: CurrentUser, page?: string | null): Promise<CurrentSubject | undefined> {
  const m = page?.match(/^\/(proyectos|reposiciones)\/([0-9a-f-]{36})(?:\/|$)/i);
  if (!m) return undefined;
  if (m[1] === "proyectos") {
    if (!(await canViewProject(u, m[2]!))) return undefined;
    const [p] = await db.select({ code: projects.code, name: projects.name, status: projects.status, phase: projects.phase }).from(projects).where(eq(projects.id, m[2]!));
    return p?.code ? { kind: "proyecto", id: m[2]!, code: p.code, name: p.name, extra: `${statusLabel(p.status, p.phase)}, fase ${p.phase} · ${PHASES[p.phase]?.name}` } : undefined;
  }
  if (!canAccessReplenishments(u)) return undefined;
  const [r] = await db.select({ code: replenishments.code, title: replenishments.title, status: replenishments.status }).from(replenishments).where(eq(replenishments.id, m[2]!));
  return r ? { kind: "reposición", id: m[2]!, code: r.code, name: r.title, extra: REP_STATUS_LABEL[r.status] } : undefined;
}
export type CurrentSubject = { kind: "proyecto" | "reposición"; id: string; code: string; name: string; extra: string };

export async function askAssistant(
  u: CurrentUser,
  history: ChatTurn[],
  channel: ActionChannel & { current?: CurrentSubject } = { channel: "web" },
): Promise<AssistantReply> {
  const ctx = { ...channel, prepared: [] as PreparedAction[] };
  const done = (text: string): AssistantReply => ({ text, actions: ctx.prepared });
  const who = `Usuario actual: ${u.name}. Roles: ${u.roles.map((r) => ROLE_LABEL[r] ?? r).join(", ") || "ninguno"}. Departamentos: ${
    u.departmentKeys.join(", ") || "ninguno"
  }. Hoy es ${new Date().toLocaleDateString("es-ES", { timeZone: "Europe/Madrid", weekday: "long", day: "numeric", month: "long", year: "numeric" })}.
${
  channel.channel === "teams"
    ? "Canal: Microsoft Teams. Si preparas una acción pendiente de confirmar, el detalle se añade solo debajo de tu respuesta: no lo repitas; termina pidiendo que responda «sí» para hacerlo o «no» para cancelarlo. No menciones botones."
    : "Canal: chat de la plataforma web. Debajo de tu respuesta aparece una tarjeta con el detalle de cada acción (hecha o pendiente, con botones «Confirmar» y «Cancelar» si está pendiente): no repitas el detalle ni el mensaje. No menciones Teams ni responder «sí»."
}${
  channel.current
    ? `\nAhora mismo la persona tiene abierto ${channel.current.kind === "proyecto" ? "el proyecto" : "la reposición"} ${channel.current.code} · ${channel.current.name} (${channel.current.extra}; id ${channel.current.id}). Si pregunta o pide algo sin decir de qué proyecto o reposición se trata («este proyecto», «avisa a Diseño de que corre prisa»…), se refiere a esta: usa su código en las herramientas sin preguntárselo.`
    : ""
}`;
  const tools = toolsFor(u, ctx);
  // API Responses (la de Chat Completions no admite herramientas con razonamiento en los
  // modelos nuevos). Sin guardar nada en OpenAI: el razonamiento viaja cifrado entre vueltas.
  // La guía va primero y sin cambios para aprovechar la caché de prompts.
  const input: OpenAI.Responses.ResponseInputItem[] = [
    { role: "developer", content: who },
    ...history.slice(-20).map((t) => ({ role: t.role, content: t.content })),
  ];
  for (let i = 0; i < 6; i++) {
    const res = await getClient().responses.create({
      model: MODEL,
      instructions: GUIDE,
      input,
      tools: tools.map((t) => t.def),
      reasoning: { effort: "low" },
      max_output_tokens: 4000,
      store: false,
      include: ["reasoning.encrypted_content"],
    });
    const refused = res.output.some((o) => o.type === "message" && o.content.some((c) => c.type === "refusal"));
    if (refused) return done("Lo siento, no puedo ayudarte con esa petición.");
    const calls = res.output.filter((o): o is OpenAI.Responses.ResponseFunctionToolCall => o.type === "function_call");
    if (!calls.length) return done(res.output_text?.trim() || "No he podido generar una respuesta. ¿Puedes reformular la pregunta?");
    input.push(...(res.output as OpenAI.Responses.ResponseInputItem[]));
    for (const call of calls) {
      const tool = tools.find((t) => t.def.name === call.name);
      let output: string;
      try {
        const parsed = tool?.schema.safeParse(JSON.parse(call.arguments || "{}"));
        output = !tool ? "Herramienta desconocida." : parsed?.success ? await tool.run(parsed.data as never) : "Parámetros no válidos.";
      } catch {
        output = "Parámetros no válidos.";
      }
      input.push({ type: "function_call_output", call_id: call.call_id, output });
    }
  }
  return done("La consulta es demasiado compleja. ¿Puedes concretar un poco más la pregunta?");
}
