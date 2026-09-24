# SPEC — Plataforma de Gestión de Nuevos Desarrollos (NPD) · NATU Laboratories

> Documento de especificación para construir con Claude Code.
> Estado: v1.0 · Septiembre 2026 · Responsable: Irene (Digital Manager)

---

## 1. Contexto y objetivo

Laboratorios NatuAromatic S.L. (NATU) desarrolla productos de **perfumería, ambientación y cosmética** para:
- **Marca privada (PL)**: productos para clientes con su propia marca.
- **Marca propia (MP)**: NATU, BetrésON, SevenKIDS, Delisea.

Hoy las solicitudes de nuevos desarrollos llegan de forma dispersa (emails, llamadas) y el seguimiento entre departamentos es manual. La plataforma debe:

1. **Registrar** solicitudes de nuevos proyectos mediante un asistente guiado.
2. **Decidir** su viabilidad (aprobar / pedir más info / rechazar).
3. **Coordinar** el trabajo de los departamentos, que actúan en paralelo y con ciclos de revisión.
4. **Dar visibilidad** del estado de cada proyecto y de la cartera completa.
5. **Centralizar** la documentación en SharePoint.

**Alcance**: desde la solicitud hasta el **paso a producción**. La producción y la expedición quedan fuera (se gestionan en SAP Business One).

---

## 2. Modelo de proceso: Stage-Gate

El proyecto avanza por **fases** separadas por **puertas (gates)** de decisión. Dentro de cada fase, varios departamentos trabajan **en paralelo** mediante **tareas** con dependencias y ciclos de revisión.

### 2.1 Fases y puertas

> Las dos aprobaciones se muestran como **P1** y **P2** ("paso 1" y "paso 2"). En código y base de datos se mantienen las claves `G1` / `G2`.

> **Revisión 24/09/2026:** el flujo pasa a 6 fases agrupadas en dos etapas, con dos aprobaciones formales (sustituye a la propuesta P1–G5 original):
> **Validación** (Solicitud → Cotización → Valoración con cliente) y **En curso** (Desarrollo → Diseño y artes finales → Preparación para producción). El proyecto entra en *En curso* cuando el cliente aprueba el presupuesto (P2).

| # | Etapa | Fase | Para pasar a la siguiente | Decide |
|---|-------|------|---------------------------|--------|
| 0 | Validación | **Solicitud** | **P1 – Aprobación de la solicitud** (aprobar / pedir info / rechazar / pausar). Al aprobar se eligen los departamentos implicados. | Aprobadores P1 (configurables por tipo; habitualmente Marketing) |
| 1 | Validación | **Cotización** | Enviar la cotización al cliente (importe opcional + PDF en `01 Cotización`) | Marketing, Operaciones, Comercial o el comercial de la cuenta |
| 2 | Validación | **Valoración con cliente** | **P2 – Aprobación del presupuesto**: cliente aprueba / pide cambios (vuelve a Cotización) / rechaza / pausa. **Solo PL:** anticipo del 30 % recibido, o inicio sin anticipo con el nombre de la persona que asume la responsabilidad (queda auditado y se puede registrar el pago más tarde). | Aprobadores P2 (configurables por tipo; habitualmente Comercial) |
| 3 | En curso | **Desarrollo** | Avanzar de fase | Marketing / Admin / aprobadores |
| 4 | En curso | **Diseño y artes finales** | Avanzar de fase | ídem |
| 5 | En curso | **Preparación para producción** | Pasar a producción (estado *En producción*) | ídem |

Tipos de proyecto: **PL** (marca privada), **MP** (marca propia) y **MDD** (marca de distribuidor; mismos datos de cliente que PL, sin cláusula de anticipo). Códigos `AAAA-PL-NNNN`, `AAAA-MP-NNNN`, `AAAA-MDD-NNNN`.

Subcarpetas SharePoint: `00 Solicitud`, `01 Cotización`, `02 Valoración cliente`, `03 Desarrollo`, `04 Diseño-AAFF`, `05 Preparación producción`.

Brief (revisión): género obligatorio con selección múltiple (mujer / hombre / unisex); se eliminan estilo, rango de edad, estacionalidad, alérgenos, % natural, vegano y certificaciones; se añade **Blacklist** (texto pegado y/o adjunto, opcional) y enlace a **Fragrantica** en cada referencia de inspiración. Revisión posterior: se quitan las notas de salida/corazón/fondo del brief (la pirámide la define I+D en la ficha técnica), se permite subir varios archivos de inspiración y se elimina el canal Horeca.

### 2.1 bis Ficha técnica por departamento (revisión 24/09/2026)

Cada proyecto tiene una **ficha técnica** con un apartado por departamento, que se completa conforme avanza el proyecto y queda a la vista de todos los departamentos implicados:

| Apartado | Departamento (por defecto) | Fase | Obligatorio para terminar |
|---|---|---|---|
| Cotización y condiciones comerciales | Comercial | 1 Cotización | Cotización enviada y P2 aprobado (automático), precio unitario, precio objetivo y PVP recomendado (los documentos de cotización y aprobación son opcionales) |
| Fórmula y pirámide olfativa | Laboratorio / I+D | 3 Desarrollo | Al menos una referencia, con su pirámide (perfumería/ambientación), y al menos una aprobada por el cliente |
| Envase y packaging | Marketing / NPD | 3 Desarrollo | Frasco, tapón y tipo de packaging secundario |
| Identificación del producto | Marketing / NPD | 3 Desarrollo | Nombre comercial (naming, precargado del brief), tipo y código de barras (EAN-13/EAN-8 validado) y QR (sí/no + destino) |
| Calidad y regulatorio · requisitos de etiqueta | Calidad y Regulatory | 3 Desarrollo | Denominación legal (precargada del formato), cantidad en ml (fl oz y ℮ opcionales), idiomas (precargados de los mercados), iconos de reciclaje, de peligro y otros (PAO…), INCI, modo de uso, precauciones, responsable (figura, nombre, dirección, país), UFI (no aplica / pendiente / disponible + código) y lote |
| Etiqueta y artes finales | Diseño | 4 Diseño y AAFF | Troquel (existente con referencia / nuevo con medidas), tipo y ubicación de etiqueta, artes finales y aprobación del cliente. Parte de la información de Identificación, Calidad y regulatorio, Fórmula y Envase: al abrirse su fase, Diseño recibe por email todo lo rellenado en esos apartados |
| Preparación para producción | Operaciones | 5 Preparación | Fecha prevista, materiales pedidos y escandallo final |

- Solo los **miembros** del departamento del apartado, el **decisor global** y los administradores editan el apartado; el resto de usuarios solo lo ve. Pueden adjuntar documentos y marcarlo como **terminado** (exige que no falte nada obligatorio) o **no aplica** (con motivo). La asignación apartado → departamento es configurable.
- La ficha muestra un resumen de lo hecho y lo que falta por departamento. Al avanzar de fase se avisa si quedan apartados sin terminar (se puede avanzar igualmente confirmándolo).
- Al entrar en una fase se notifica a los departamentos con apartados en ella, con lo ya disponible en la ficha. Al terminar un apartado se notifica al solicitante, al comercial de la cuenta y a Marketing.
- Los apartados pendientes de los que un usuario es responsable aparecen en "Requieren mi acción".
- Calidad y Regulatory pasan a ser un único departamento.

### 2.2 Resultados posibles de una puerta

| Resultado | Efecto |
|-----------|--------|
| **Aprobar** | Avanza a la siguiente fase. En P1, el decisor elige los departamentos implicados y se generan sus tareas. |
| **Solicitar más info** | Estado → *Pendiente de info*. Se notifica al solicitante con el detalle de lo que falta. Al responder, vuelve a *Solicitado* (o a la puerta pendiente). |
| **Rechazar** | Estado → *Rechazado*, con motivo obligatorio. |
| **Poner en pausa** | Estado → *En pausa*, con motivo. Reanudable. |

En P2–G4 se añade: **Devolver a fase anterior** (recycle), con motivo.

### 2.3 Estados del proyecto (independientes de la fase)

```
Borrador → Solicitado ⇄ Pendiente de info
Solicitado → Rechazado
Solicitado → En curso (fases 1–4)
En curso ⇄ En pausa
En curso → Cancelado
En curso → En producción   (tras G5; equivale a cerrado con éxito)
```

| Estado | Descripción |
|--------|-------------|
| Borrador | Guardado sin enviar (solo visible para su autor) |
| Solicitado | Enviado, pendiente de decisión en P1 |
| Pendiente de info | El decisor ha pedido información adicional |
| En curso | Aprobado; la fase indica dónde está |
| En pausa | Detenido temporalmente |
| En producción | Superado G5. Cierre con éxito |
| Rechazado | Denegado en una puerta |
| Cancelado | Abandonado tras haber sido aprobado |

Para el panel, tabla y filtro se usa un único vocabulario de **situación**: *Solicitado* (Solicitado + Pendiente de info), *Validando cliente* (activo en fases 1–2), *En curso* (activo en fases 3–5, tras P2), *En pausa*, *En producción* y *Rechazados / cancelados*. La tabla muestra la situación y, debajo, la fase concreta.

### 2.4 Tareas por departamento

- Cada fase contiene **tareas** asignadas a un **departamento** (y opcionalmente a una persona).
- Estados de tarea: `pendiente` · `bloqueada` (esperando dependencia) · `en_curso` · `en_revision` · `devuelta` · `esperando_cliente` · `completada` · `no_aplica`.
- **Dependencias**: una tarea puede depender de otras; queda `bloqueada` hasta que se completen.
- **Ciclos de revisión**: una tarea revisora (p. ej. Calidad revisa AAFF) puede **devolver** una tarea previa (Diseño) con comentario. La tarea devuelta se reabre y su contador de **versión/iteración** aumenta. Todo queda en el historial.
- Una puerta solo puede decidirse cuando todas las tareas obligatorias de la fase están `completada` o `no_aplica` (el decisor puede forzarla con justificación, que queda auditada).

### 2.5 Plantillas de flujo

Definidas en el backoffice. Cada plantilla = conjunto de tareas por fase, con departamento, dependencias, obligatoriedad y duración estimada (días). Al aprobar P1 se instancia la plantilla y el decisor puede **activar/desactivar departamentos** (el "desplegable" de departamentos) antes de confirmar.

Plantillas iniciales (seed):
1. PL – Desarrollo completo
2. PL – Fórmula de catálogo NATU con marca del cliente
3. PL – Solo cambio de packaging/diseño
4. Marca propia – Nuevo producto
5. Personal Care (PL, MP o MDD) – con tareas regulatorias reforzadas (evaluación de seguridad, expediente de producto, notificación previa a comercialización)

Ejemplo (fase 3, Diseño y AAFF):
```
T1 Marketing: textos brutos (etiqueta/estuche)
T2 Regulatory + Calidad: revisión de textos          ← depende de T1 · puede devolver T1
T3 Comunicación: adaptación de tono                   ← depende de T2
T4 Diseño: artes finales                              ← depende de T3
T5 Calidad + Regulatory: revisión AAFF                ← depende de T4 · puede devolver T4
T6 Comunicación/Diseño: traducciones                  ← depende de T5
T7 Cliente (PL): aprobación AAFF [esperando_cliente]  ← depende de T6
```

---

## 3. Departamentos (seed, editable en backoffice)

| Departamento | Papel principal |
|--------------|-----------------|
| Marketing / NPD | Aprueba P1, gestiona el proyecto, elige envase, briefings |
| Laboratorio / I+D | Fórmula, muestras, estabilidad y compatibilidad |
| Calidad | Revisión de textos y AAFF, documentación |
| Regulatory | Claims, requisitos por país, expedientes, cosmética |
| Diseño | Etiqueta, packaging, AAFF |
| Comunicación | Tono, textos, traducciones |
| Operaciones | Escandallos, costes, documentación logística |
| Compras / Aprovisionamiento | Pedido de materiales y envases |
| Producción | Factibilidad de maquinaria y planificación (consultivo) |
| Almacén | Consultivo (opcional) |
| Comercial | Solicitantes; interlocución con el cliente PL |
| Dirección | Comité (P2 en marca propia), lectura global |

Cada departamento tiene: nombre, color, **lista de emails de notificación**, responsable y miembros.

---

## 4. Roles y permisos

Los usuarios acceden con su cuenta corporativa Microsoft 365 (SSO). Un usuario puede tener varios roles y pertenecer a uno o varios departamentos.

| Rol | Permisos |
|-----|----------|
| **Admin** | Todo + backoffice (usuarios, roles, departamentos, marcas propias, plantillas, logs) |
| **Decisor global** (gestor de proyectos) | Ve todos los proyectos; decide P1 y P2, envía cotizaciones, avanza fases, edita el brief y rellena y cierra todos los apartados de la ficha técnica |
| **Solicitante** | Crear solicitudes, ver y editar sus borradores, responder peticiones de info, comentar en sus proyectos. Por defecto: comerciales, marketing, dirección |
| **Decisor** | Decidir en las puertas que tenga asignadas (configurable por puerta y tipo de proyecto). En P2, el comercial que dio de alta el proyecto siempre puede decidir, además de los aprobadores configurados |
| **Miembro de departamento** | Ver proyectos donde su departamento tiene tareas, cambiar estado de esas tareas, comentar, subir archivos |
| **Lectura global** | Ver todos los proyectos y dashboards (Dirección) |

Reglas:
- Un usuario **sin rol asignado** que inicie sesión vía SSO queda en estado *pendiente de activación* y el admin recibe aviso.
- Los usuarios desactivados en Entra ID pierden acceso automáticamente.
- Los solicitantes ven sus propios proyectos + (configurable) todos los proyectos en modo lectura.

---

## 5. Asistente de solicitud (modal/popup multipaso)

Guardado automático como **Borrador** en cada paso. Barra de progreso e **indicador de completitud** (% de campos recomendados cubiertos) visible en todo momento.

### Paso 1 — Datos básicos (común)
| Campo | Tipo | Obl. |
|-------|------|------|
| Solicitado por | auto (usuario logueado) | ✔ |
| Fecha de solicitud | auto | ✔ |
| Tipo de proyecto | PL / Marca propia | ✔ |
| Categoría | Perfumería / Ambientación / Personal Care | ✔ |
| Nombre provisional del proyecto | texto | ✔ |
| Fecha de entrega requerida | fecha | ✔ |
| Motivo de la fecha | select: feria, lanzamiento del cliente, temporada, licitación, orientativa, otro + texto | ✔ |
| Prioridad sugerida | baja / media / alta / urgente | ✔ |

### Paso 2A — Marca privada (PL)
| Campo | Tipo | Obl. |
|-------|------|------|
| Cliente | buscador sobre catálogo de clientes + "nuevo cliente" (nombre, país, contacto) | ✔ |
| Comercial responsable de la cuenta | usuario (por defecto el solicitante) | ✔ |
| Subtipo | Desarrollo completo / Fórmula de catálogo NATU / Réplica de producto existente del cliente / Extensión de gama / Solo cambio de packaging | ✔ |
| Mercados de venta | multiselect países | ✔ |
| Canal | multiselect: gran distribución, perfumería, farmacia/parafarmacia, online, horeca, otro | ✔ |
| Nº de referencias | número | ✔ |
| Unidades primer pedido | número | ✔ |
| Previsión anual de unidades | número | recomendado |
| Precio objetivo de compra (cliente) | € | recomendado |
| PVP previsto | € | recomendado |
| Quién aporta el diseño | Cliente / NATU / Mixto | ✔ |
| Quién aporta el packaging | Cliente / NATU / Mixto | ✔ |
| Idiomas de etiquetado | multiselect | recomendado |

### Paso 2B — Marca propia (MP)
| Campo | Tipo | Obl. |
|-------|------|------|
| Marca | NATU / BetrésON / SevenKIDS / Delisea (catálogo) | ✔ |
| Línea / colección | texto o catálogo | – |
| Origen | Petición de cliente/retailer, iniciativa de Marketing, Dirección, tendencia detectada, hueco en gama, otro | ✔ |
| Cliente/retailer vinculado | opcional; vincula al comercial de la cuenta para notificaciones | – |
| Mercados / canal | multiselect | ✔ |
| PVP objetivo | € | recomendado |
| Unidades estimadas (primer año) | número | recomendado |
| Justificación / oportunidad | texto largo | ✔ |

### Paso 3 — Producto (condicional por categoría)

**Perfumería**
- Formato: EDT, EDP, body mist, colonia, colonia infantil, extracto, otro · Capacidad (ml)
- Bloque olfativo (ver abajo)

**Ambientación**
- Formato: mikado, spray, vela, recambio eléctrico, ambientador de coche, sachet, textil, otro · Capacidad
- Duración/rendimiento deseado
- Bloque olfativo

**Personal Care**
- Formato: crema, gel, champú, body lotion, desodorante, aceite, otro · Capacidad
- Función y claims deseados (multiselect + texto)
- Tipo de piel/cabello y público (adulto, infantil, bebé)
- Textura deseada
- ¿Lleva perfume? → si sí, bloque olfativo
- Ingredientes deseados / a evitar

**Bloque olfativo** (reutilizable)
- Familia(s) olfativa(s): chips (floral, frutal, cítrico, amaderado, oriental/ámbar, aromático, fougère, chipre, gourmand, acuático, verde, almizclado…)
- Notas deseadas de **salida / corazón / fondo** (chips con autocompletado sobre catálogo de notas)
- Intensidad (1–5) y duración deseada
- Referencias de inspiración: lista repetible {producto, marca, qué gusta de ella}
- Público: género (femenino/masculino/unisex), rango de edad, estilo
- Estacionalidad
- Restricciones: sin alérgenos concretos, vegano, % natural, certificaciones

### Paso 4 — Adjuntos y notas
- Subida múltiple drag & drop (imágenes, PDF, Office, zip). Límite configurable (por defecto 50 MB/archivo).
- Etiqueta por archivo: moodboard, referencia, brief del cliente, packaging, otro.
- Notas adicionales (texto largo).

### Paso 5 — Resumen y envío
- Vista resumen de todo el brief + completitud.
- Si completitud < umbral configurable (p. ej. 60%), aviso (no bloqueante) listando campos recomendados vacíos.
- Al enviar: estado → *Solicitado*, se genera el **código** del proyecto, se crea la carpeta en SharePoint, se suben adjuntos y se notifica.

**Código de proyecto**: `AAAA-PL-NNNN` / `AAAA-MP-NNNN` (secuencial por año y tipo). Ej.: `2026-PL-0042`.

---

## 6. Notificaciones (email vía Microsoft Graph desde buzón compartido)

| Evento | Destinatarios |
|--------|---------------|
| Nueva solicitud enviada | Decisores de P1 + emails del departamento Marketing |
| Solicitud de más info | Solicitante (+ comercial de la cuenta si es distinto) |
| Info aportada | Decisor que la pidió |
| Proyecto aprobado en P1 | Emails de los departamentos seleccionados + solicitante |
| Proyecto rechazado | Solicitante (con motivo) |
| Tarea desbloqueada / asignada | Departamento o persona asignada |
| Tarea devuelta | Departamento/persona de la tarea devuelta |
| Mención `@usuario` en comentario | Usuario mencionado |
| Fase lista para decisión | Decisor de esa puerta |
| Cambio de puerta (P2–G5) | Solicitante + departamentos implicados |
| Proyecto en riesgo (fecha necesaria < X días y fase atrasada) | Project Manager / Marketing (resumen diario) |

- Plantillas de email en HTML, con marca NATU, resumen del proyecto y botón "Ver en la plataforma".
- Preferencias por usuario: inmediato / resumen diario (para eventos no críticos).
- Todo envío se registra en `notification_log` con estado (enviado/fallido) y reintentos.
- Fase posterior: avisos a Teams.

---

## 7. Pantallas

### 7.1 Panel principal (dashboard)
**Tarjetas KPI**: proyectos totales (periodo seleccionable), por estado agrupado, PL vs MP, por marca, por categoría, por solicitante/comercial, tiempo medio hasta decisión en P1, % aprobados, proyectos en riesgo.

**Gráficos**: evolución mensual de solicitudes (línea), distribución por estado (barras), por tipo/marca (barras), embudo por fase.

**Listado de proyectos** (tabla filtrable, ordenable, con búsqueda):
Fecha solicitud · Código · Nombre · Tipo (PL / MP–Marca) · Categoría · Cliente · Solicitante · Entrega requerida (semáforo) · Situación (con la fase debajo) · Departamentos activos · **Ver detalle**.

Filtros: tipo, marca, categoría, estado, fase, solicitante, departamento, rango de fechas, "solo en riesgo", "mis proyectos", "requieren mi acción".

Botón destacado: **+ Nueva solicitud** (abre el asistente).

### 7.2 Ficha de proyecto (detalle)
1. **Cabecera**: código, nombre, tipo/marca, categoría, cliente, estado, prioridad, fecha necesaria con días restantes y semáforo; acciones según rol (decidir puerta, pausar, cancelar, editar).
2. **Línea de fases** visual (estilo retroplanning): fases 0–4 con puertas, fase actual resaltada, fechas de entrada y salida en cada una.
3. **Carriles por departamento**: por cada departamento implicado, sus tareas con estado (chip de color), responsable, fecha objetivo, nº de iteraciones y dependencias ("esperando a Diseño").
4. **Cronograma**: Gantt ligero de tareas (plan vs real) y días en cada fase.
5. **Brief visual**:
   - Pirámide olfativa dibujada (salida/corazón/fondo) y chips de familias
   - Galería de referencias de inspiración e imágenes adjuntas
   - Ficha de datos comerciales (unidades, precios, mercados en mapa/lista, canal)
6. **Actividad** (timeline único, filtrable): comentarios, peticiones de info y respuestas, decisiones en puertas (con quién, cuándo y motivo), cambios de estado de tareas, devoluciones, ediciones de campos (valor anterior → nuevo), subidas de archivos.
7. **Comentarios**: generales o vinculados a una tarea; menciones `@usuario` y `@departamento`; adjuntos en comentarios.
8. **Archivos**: listado sincronizado con la carpeta de SharePoint (por subcarpeta de fase) + enlace "Abrir en SharePoint" + subida desde la ficha.

**Edición**: los campos del brief son editables por el solicitante (mientras esté en *Solicitado/Pendiente de info*) y por Marketing/Admin en cualquier momento. Toda edición queda auditada.

### 7.3 Modal de decisión de puerta
- Resumen de la fase y checklist de tareas.
- Opciones: Aprobar / Solicitar más info / Rechazar / Pausar (+ Devolver a fase anterior en P2–G4).
- **P1 Aprobar**: seleccionar plantilla de flujo sugerida (por tipo, subtipo y categoría) → multiselect de departamentos a implicar (precargado desde plantilla) → comentario opcional → confirmar. Se generan tareas y se envían notificaciones.
- **Solicitar más info**: texto obligatorio + checklist opcional de campos del brief que faltan (los resalta al solicitante).
- **Rechazar**: motivo obligatorio (select + texto): no viable técnicamente, precio, volumen insuficiente, fuera de estrategia, duplicado, otro.
- En PL, P2–G4 permiten adjuntar la evidencia de aprobación del cliente (email/PDF).

### 7.4 "Mis tareas"
Bandeja por usuario/departamento: tareas pendientes, en curso, devueltas y bloqueadas, ordenadas por fecha objetivo.

---

## 8. Backoffice (solo Admin)

- **Usuarios**: listado (sincronizado vía SSO), activar/desactivar, roles, departamentos, preferencias de notificación.
- **Departamentos**: CRUD, color, emails de notificación, responsable, miembros.
- **Decisores por puerta**: matriz puerta × tipo de proyecto → usuarios/rol.
- **Marcas propias**: alta, edición y activación de las marcas de NATU. El resto de listas (formatos, familias, notas, canales, mercados, motivos de rechazo) se mantienen en el seed; los clientes se dan de alta desde la solicitud.
- **Plantillas de flujo**: editor de fases → tareas (departamento, dependencias, obligatoria, puede devolver a…, duración estimada).
- **Configuración**: umbral de completitud, días para "en riesgo", límites de archivos, buzón remitente.
- **Registro de actividad (auditoría)**: quién hizo qué, cuándo, sobre qué entidad; filtrable y exportable a CSV.
- **Logs de errores**: errores de aplicación, fallos de Graph (SharePoint/email), reintentos; con detalle técnico.
- **Uso**: usuarios activos, sesiones, solicitudes por usuario, acciones por día.
- **Notificaciones**: log de envíos y opción de reenviar.

---

## 9. Arquitectura técnica

| Capa | Tecnología |
|------|-----------|
| Frontend + backend | **Next.js** (App Router, TypeScript), Server Actions / Route Handlers |
| UI | Tailwind CSS + shadcn/ui; gráficos con Recharts |
| Base de datos | **PostgreSQL en Neon** |
| ORM | Drizzle o Prisma |
| Auth | **Microsoft Entra ID (SSO)** vía Auth.js (provider Microsoft Entra ID) |
| Archivos | **SharePoint** (sitio dedicado) vía **Microsoft Graph** |
| Email | **Microsoft Graph `sendMail`** desde buzón compartido |
| Hosting | **Vercel** |
| Tareas programadas | Vercel Cron (resumen diario, detección de riesgo, reintentos) |
| Validación | Zod (compartida entre formulario y servidor) |
| Integraciones futuras | n8n (clientes desde Pipedrive, avisos Teams) |

### 9.1 SharePoint
- Sitio dedicado: **"Proyectos NPD"**, biblioteca **"Proyectos"**.
- Al enviar una solicitud se crea la carpeta `AAAA-XX-NNNN · Cliente/Marca · Nombre` con subcarpetas:
  `00 Solicitud`, `01 Concepto`, `02 Desarrollo`, `03 Diseño-AAFF`, `04 Preparación producción`.
- Subidas: archivos > 4 MB mediante *upload session* de Graph.
- En BD se guarda `drive_item_id` de carpeta y archivos (no rutas de texto), para sobrevivir a renombrados.
- Los permisos de acceso a la plataforma **no** dependen de los de SharePoint; la app actúa con permisos de aplicación sobre ese sitio.

### 9.2 Requisitos para IT (tenant Microsoft 365)
1. Registrar una aplicación en **Entra ID** (single-tenant).
2. Permisos **delegados**: `openid`, `profile`, `email`, `User.Read` (login).
3. Permisos de **aplicación** (con consentimiento de admin):
   - `Sites.Selected` → conceder acceso *write* **solo** al sitio "Proyectos NPD".
   - `Mail.Send` → restringido con **Application Access Policy** (o RBAC de Exchange para aplicaciones) **solo** al buzón compartido `proyectos@…`.
4. Crear el sitio de SharePoint y el buzón compartido.
5. Facilitar: Tenant ID, Client ID, secreto/certificado, Site ID, dirección del buzón.

### 9.3 Modelo de datos (borrador)

```
users(id, entra_oid, email, name, is_active, status[pending|active|disabled], notif_pref, created_at, last_login_at)
roles(id, key)                                   -- admin, requester, decider, dept_member, global_reader
user_roles(user_id, role_id)
departments(id, name, color, notify_emails[], lead_user_id, is_active)
department_members(department_id, user_id)

brands(id, name, is_active)
clients(id, name, country, contact, account_manager_user_id, external_ref)
catalog_items(id, type, value, parent_id, sort, is_active)   -- formatos, familias, notas, canales, mercados, motivos...

projects(
  id, code, name, type[PL|MP], category[perfume|ambient|cosmetic],
  subtype, brand_id, client_id, requester_id, account_manager_id,
  origin, status, phase, priority,
  needed_by, needed_by_reason, requested_at, decided_g1_at, closed_at,
  completeness_pct, brief jsonb,                -- campos específicos por tipo/categoría
  sharepoint_folder_id, sap_order_ref, template_id,
  created_at, updated_at)

project_departments(project_id, department_id)

gates(id, project_id, gate[P1..G5], status[pending|approved|info_requested|rejected|paused|recycled|forced],
      decided_by, decided_at, comment, reason_code, client_evidence_file_id)

info_requests(id, project_id, gate_id, requested_by, requested_at, message, fields_missing[], 
              answered_by, answered_at, answer)

workflow_templates(id, name, applies_to jsonb, is_active)
template_tasks(id, template_id, phase, department_id, title, description, is_required,
               can_return_to_task_id, est_days, sort)
template_task_deps(task_id, depends_on_task_id)

tasks(id, project_id, phase, department_id, assignee_id, title, description, status,
      is_required, iteration, due_date, started_at, completed_at, template_task_id)
task_deps(task_id, depends_on_task_id)

comments(id, project_id, task_id?, author_id, body, mentions jsonb, created_at, edited_at)
files(id, project_id, task_id?, comment_id?, sharepoint_item_id, name, mime, size, tag, phase, uploaded_by, created_at)

activity_log(id, project_id?, actor_id, action, entity, entity_id, diff jsonb, created_at)   -- auditoría
notification_log(id, event, project_id, recipients[], subject, status, error, attempts, sent_at)
error_log(id, source, level, message, stack, context jsonb, created_at)
settings(key, value jsonb)
```

Notas:
- `projects.brief` en JSONB validado con esquemas Zod por tipo/categoría; los campos usados para filtrar o para KPIs (tipo, categoría, marca, cliente, fechas, unidades) van en columnas propias.
- Transiciones de estado centralizadas en un único módulo (máquina de estados) que valida permisos, escribe `activity_log` y dispara notificaciones.

---

## 10. Requisitos no funcionales

- **Idioma**: interfaz en español (preparada para i18n; mercados IT/FR/RO en el futuro).
- **Responsive**: el asistente de solicitud debe funcionar en móvil (los comerciales están en ruta).
- **Rendimiento**: listado y dashboard < 2 s con 2.000 proyectos.
- **Seguridad**: autorización en servidor en cada acción; nunca exponer tokens de Graph al cliente; secretos en variables de entorno de Vercel.
- **Resiliencia**: si falla SharePoint o el email, la solicitud **no se pierde**: se guarda en BD, se registra el error y se reintenta (cola simple con reintentos vía cron).
- **Auditoría**: toda acción que modifique datos queda en `activity_log`.
- **RGPD**: los datos personales se limitan a usuarios internos y contactos de clientes B2B.

---

## 11. Plan por versiones y criterios de aceptación

### V1 — Solicitud y decisión (MVP)
- SSO con Microsoft, alta de usuarios pendiente de activación.
- Backoffice: usuarios, roles, departamentos (emails), catálogos básicos, decisores de P1, logs de actividad y errores.
- Asistente de solicitud completo (PL / MP · perfumería / ambientación / cosmética), borradores, adjuntos, completitud.
- Carpeta SharePoint por proyecto con adjuntos.
- P1: aprobar (con selección de departamentos → email con detalles) / solicitar info / rechazar / pausar.
- Dashboard con KPIs y listado filtrable.
- Ficha de proyecto: cabecera, brief visual (incl. pirámide olfativa), actividad, comentarios con menciones, archivos.

**Criterios de aceptación V1**
- [ ] Un comercial crea una solicitud PL desde el móvil con 3 adjuntos; aparece en el listado como *Solicitado*, su carpeta existe en SharePoint con los archivos en `00 Solicitud` y el decisor recibe el email.
- [ ] El decisor pide más info; el solicitante recibe email, ve los campos resaltados, responde, y todo el intercambio aparece en la actividad del proyecto.
- [ ] El decisor aprueba seleccionando 3 departamentos; los emails configurados de esos departamentos reciben el resumen y el estado pasa a *En curso* / fase 1.
- [ ] Un rechazo exige motivo y queda visible en la ficha.
- [ ] Si Graph falla al enviar el email, la solicitud se guarda, el error aparece en el log y el envío se reintenta.
- [ ] Un usuario sin rol no puede ver proyectos.

### V2 — Coordinación de departamentos
- Plantillas de flujo y editor en backoffice.
- Tareas por departamento, dependencias, bloqueos, devoluciones e iteraciones.
- Carriles por departamento, cronograma y bandeja "Mis tareas".
- Puertas P2–G5 con decisores configurables, devolución a fase anterior y evidencia del cliente en PL.
- Estado *En producción* y referencia SAP.

**Criterios de aceptación V2**
- [ ] Calidad devuelve los AAFF a Diseño; la tarea de Diseño se reabre como iteración 2, Diseño recibe aviso y la devolución consta en la actividad.
- [ ] Una tarea con dependencias no se puede iniciar hasta que se completan sus predecesoras.
- [ ] No se puede decidir una puerta con tareas obligatorias abiertas salvo forzado justificado por el decisor.

### V3 — Analítica y mejoras
- Analítica de cuellos de botella (tiempo medio por departamento y por tarea, nº de iteraciones), lead time por tipo, embudo de conversión.
- Resumen diario y alertas de riesgo.
- Avisos en Teams, sincronización de clientes con Pipedrive (n8n).
- Exportación del brief a PDF.

---

## 12. Puntos abiertos

1. Confirmar decisores de **G3, G4 y G5** (propuesta en §2.1).
2. Nombres y emails concretos por departamento (se configuran en el backoffice).
3. Contenido inicial de las **plantillas de flujo** (validar con cada departamento a partir del retroplanning).
4. ¿Los solicitantes pueden ver **todos** los proyectos en lectura o solo los suyos?
5. Origen del catálogo de clientes: carga inicial manual/CSV o sincronización desde Pipedrive.
6. Nombre de la plataforma y dominio.
