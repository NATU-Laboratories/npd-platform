# Plataforma NPD · NATU Laboratories

Gestión de nuevos desarrollos (perfumería, ambientación y cosmética) desde la solicitud hasta el paso a producción, con modelo **Stage-Gate**. Especificación completa en [`docs/SPEC.md`](docs/SPEC.md).

**Estado: V1 (Solicitud y decisión)**. El modelo de datos ya incluye las tablas de V2 (tareas, dependencias, plantillas) para no reestructurar después.

## Stack

Next.js 16 (App Router, Server Actions) · TypeScript · Tailwind v4 · Drizzle ORM + PostgreSQL (Neon) · Auth.js v5 con Microsoft Entra ID · Microsoft Graph (SharePoint + `sendMail`) · Recharts · Zod · Vercel (+ Cron).

## Qué incluye V1

| Área | Implementación |
|---|---|
| SSO | Entra ID. Usuario nuevo → *pendiente de activación* + aviso al admin. Sin roles no ve nada. Sesión de 8 h y estado releído de BD en cada petición (desactivar en el backoffice es inmediato; un usuario deshabilitado en Entra ID no puede volver a entrar). |
| Asistente de solicitud | 5 pasos (datos básicos → PL/MP → producto condicional por categoría con bloque olfativo → adjuntos y notas → resumen). Autoguardado como borrador, barra de completitud, aviso no bloqueante bajo el umbral, validación Zod compartida cliente/servidor. Usable en móvil (pantalla completa). |
| Código | `AAAA-PL-NNNN` / `AAAA-MP-NNNN`, secuencial por año y tipo (contador transaccional). |
| SharePoint | Carpeta `AAAA-XX-NNNN · Cliente/Marca · Nombre` con subcarpetas de fase. Los adjuntos del borrador se suben a `_Borradores/<id>` y se mueven a `00 Solicitud` al enviar. En BD se guardan `drive_item_id`, no rutas. |
| Subidas | El navegador sube por trozos **directamente** a la *upload session* de Graph (sin pasar por el límite de 4,5 MB de Vercel, sin exponer tokens). El servidor verifica que el item está en la carpeta del proyecto antes de registrarlo. |
| G1 | Aprobar (plantilla sugerida por tipo/subtipo/categoría → departamentos precargados, editables) · Pedir más info (texto + campos a resaltar) · Rechazar (motivo obligatorio) · Pausar. Reanudar y cancelar. |
| Máquina de estados | `src/lib/server/state-machine.ts`: único punto de cambio de estado; valida permiso y transición, escribe `activity_log` y dispara notificaciones. |
| Notificaciones | Email HTML con marca NATU vía Graph desde buzón compartido. Todo envío queda en `notification_log`; reenvío manual desde el backoffice. |
| Resiliencia | Cola `jobs` con reintentos y backoff exponencial: se intenta tras la respuesta (`after()`) y el cron `/api/cron/jobs` reintenta. Si Graph cae, la solicitud se guarda igual y el error queda en `error_log`. |
| Panel | KPIs, gráficos (mensual PL/MP, estado, tipo/marca, categoría, solicitante, embudo por fase), listado filtrable/ordenable con semáforo de fecha, "mis proyectos", "requieren mi acción", "en riesgo". |
| Ficha | Cabecera con acciones por rol, línea de fases, brief visual (pirámide olfativa, inspiraciones, galería, datos comerciales), actividad filtrable con diff de ediciones, comentarios con `@persona` / `@departamento`, archivos por fase + "Abrir en SharePoint". |
| Backoffice | Usuarios (roles, departamentos, estado), departamentos (color, emails, responsable, miembros), matriz de decisores puerta × tipo, catálogos (marcas, clientes con import CSV, formatos, notas…), plantillas (lectura), configuración, auditoría con export CSV, errores, notificaciones/cola, uso. |

Pendiente para V2/V3 según el SPEC: tareas por departamento, carriles, Gantt, "Mis tareas", puertas G2–G5, editor de plantillas, resumen diario/alertas de riesgo, Teams, Pipedrive, PDF. La preferencia "resumen diario" ya se guarda por usuario, pero en V1 todos los avisos son inmediatos.

## Desarrollo local

Requisitos: Node 22, pnpm, PostgreSQL local (o una rama de Neon).

```bash
pnpm install
cp .env.example .env.local        # DATABASE_URL, AUTH_SECRET, AUTH_DEV_LOGIN=true, CRON_SECRET
pnpm db:migrate
pnpm db:seed --demo               # catálogos + usuarios/clientes de ejemplo
pnpm dev
```

Sin credenciales de Graph la app usa **almacenamiento local** (`.storage/`) y **guarda los emails como HTML** en `.storage/mails/` en lugar de enviarlos. Con `AUTH_DEV_LOGIN=true` la pantalla de login ofrece entrar como los usuarios demo (admin, comercial, marketing/decisora G1, I+D, dirección, usuario sin rol).

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build
pnpm db:generate                  # tras cambiar src/db/schema.ts
```

## Modo pruebas en Vercel (antes de configurar Microsoft)

Con `AUTH_DEV_LOGIN=true` y `AUTH_DEV_PASSWORD=<clave>` la pantalla de login muestra un **acceso provisional** (email + nombre + clave). Los emails de `ADMIN_EMAILS` entran como Admin; el resto queda pendiente de activación. Sin credenciales de Graph, los archivos se guardan en Postgres (`storage_items`) y los emails no se envían: se pueden ver en *Backoffice → Notificaciones → Ver email*. Una franja amarilla avisa de que es modo pruebas. Para cerrarlo, borrar ambas variables y hacer *Redeploy*.

## Despliegue (Vercel + Neon)

1. Crear la base de datos en Neon y ejecutar `pnpm db:migrate` y `pnpm db:seed` (sin `--demo`) contra ella.
2. Variables de entorno de `.env.example` en Vercel (nunca en el repo). `ADMIN_EMAILS` con el email de quien administra: entra como Admin en su primer login.
3. Cron: `vercel.json` programa `/api/cron/jobs` una vez al día (06:00 UTC), compatible con el plan Hobby. En plan Pro conviene cambiarlo a `*/10 * * * *` para reintentar emails fallidos cada 10 minutos. Definir `CRON_SECRET`.
4. IT (tenant Microsoft 365), según §9.2 del SPEC: app single-tenant en Entra ID con redirect `https://<dominio>/api/auth/callback/microsoft-entra-id`; permisos delegados `openid profile email User.Read`; permisos de aplicación `Sites.Selected` (write solo en "Proyectos NPD") y `Mail.Send` restringido por Application Access Policy al buzón `proyectos@…`. Facilitar Tenant ID, Client ID, secreto, Site ID y buzón.

## Estructura

```
src/
  app/(app)/              panel, ficha, asistente, backoffice (requieren sesión activa)
  app/actions/            server actions (autorización en servidor en cada una)
  app/api/                auth, cron, descarga de archivos, almacenamiento local
  components/             UI (wizard, ficha, panel, primitivas)
  db/                     esquema Drizzle, cliente y seed
  lib/brief/              esquema Zod del brief, registro de campos, completitud, presentación
  lib/graph/              cliente Graph, SharePoint/local, sendMail
  lib/server/             authz, máquina de estados, notificaciones, cola, consultas
drizzle/                  migraciones SQL
```

## Puntos abiertos (del SPEC §12)

Decisores de G3–G5 (configurables en *Decisores por puerta*), emails por departamento (backoffice), contenido final de las plantillas (seed editable), visibilidad de solicitantes (ajuste en *Configuración*), origen del catálogo de clientes (import CSV disponible; Pipedrive en V3), nombre y dominio.
