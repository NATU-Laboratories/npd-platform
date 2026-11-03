# DESIGN.md · Plataforma NPD de NATU Laboratories

Sistema visual de la plataforma (Nuevos desarrollos y Reposiciones). Lo leen las personas y los agentes
que crean o cambian pantallas: cualquier interfaz nueva debe parecer parte de la misma herramienta.
Base: Brand Book NATU v1.0 (2024). Tokens en `src/app/globals.css`; componentes en `src/components/ui/`.

## 1. Carácter

- **Herramienta de trabajo interna**, no web comercial: clara, sobria y densa en información sin agobiar.
- **Neutros cálidos de marca (≈80 %)** y **acentos suaves (≈20 %)**. Nada de colores saturados salvo para avisos.
- Prioridad: que cada persona vea **qué le toca** y **en qué estado está cada cosa**. Los colores de estado
  son información, no decoración.
- Interfaz y textos en **español** (de España).

## 2. Color

### Neutros (escala `slate` redefinida como grises cálidos)

| Token | Hex | Uso |
|---|---|---|
| `slate-50` | `#f8f7f5` | Fondo de página (`body`) |
| `slate-100` | `#f1efeb` | Fondos secundarios, chips inactivos, pistas de stepper |
| `slate-200` | `#e4e1dc` | Bordes de tarjetas, tablas y separadores |
| `slate-300` | `#d0ccc5` | Bordes de controles de formulario |
| `slate-500` | `#77736d` | Texto secundario, etiquetas de tabla, ayudas |
| `slate-700` | `#474745` | Texto de cuerpo en componentes |
| `slate-900` | `#2b2b2a` | Títulos y texto principal |
| blanco | `#ffffff` | Superficie de tarjetas, diálogos y controles |

### Marca

| Token | Hex | Uso |
|---|---|---|
| `natu-dark` / `brand-600` | `#3e3f3e` | Cabecera, botón principal, chip «actual», mensajes del usuario en el chat |
| `brand-700` | `#333433` | Hover del botón principal |
| `natu-sage` / `brand-200` | `#d3d7c4` | Acento principal: botón «Nueva…» de la cabecera, anillos de resaltado |
| `brand-50` / `brand-100` | `#f4f5ef` / `#e9ecdf` | Fondos de resalte suave (hover de sugerencias, filas «te toca») |
| `brand-400` / `brand-500` | `#96a27a` / `#626d48` | Pasos completados, enlaces de acción, foco (`:focus-visible`) |
| `#eef0e6` + texto `#56613f` | — | Banner/caja «salvia»: avisos positivos, plantilla seleccionada, «te toca» |
| `natu-salmon` | `#e2a29a` | Reservado para la situación «En curso» (y su punto `#cf8579`) |
| `natu-peach` | `#e4bca5` | Situación «Solicitado» |
| `natu-warm`, `natu-beige` | `#dad7d1`, `#dcd5be` | Fondos de apoyo puntuales (no usar como acento) |

### Semánticos (Tailwind estándar, siempre en versión suave)

- **Aviso / pendiente**: `amber-50` fondo, `amber-700/800` texto, `amber-200/300` anillo.
- **Error / rechazo / destructivo**: `rose-50` fondo, `rose-600/700` texto; botón `danger` `rose-600`.
- **Información / validación de calidad**: `sky-50` / `sky-800`.
- Sin verdes «semáforo» brillantes: lo positivo usa el salvia de marca.

### Estados (no inventar colores nuevos: reutilizar)

- Proyectos NPD: `STATUS_COLOR`, `VALIDATION_COLOR` y `SITUATIONS` en `src/lib/labels.ts`.
- Reposiciones: `REP_STATUS_COLOR` en `src/lib/replenishment/config.ts`.
- Departamentos: cada uno tiene su `color` (punto de 8 px en `DeptChip`); no colorear tarjetas enteras con él.
- Completado: fondo/punto salvia; actual: `natu-dark` con texto blanco; pendiente: `slate-100` con `slate-500`.

## 3. Tipografía

- **Montserrat Variable** (`font-sans`) para todo. `font-serif` (Athelas/Georgia) solo para acentos editoriales;
  en la plataforma prácticamente no se usa.
- Escala habitual:
  - Título de página: `text-xl font-semibold text-slate-900`.
  - Antetítulo (código/apartado): `text-xs font-semibold uppercase tracking-wide text-brand-500`.
  - Título de tarjeta: `text-sm font-semibold text-slate-900`.
  - Cuerpo: `text-sm`; ayudas y metadatos: `text-xs text-slate-500`.
  - Etiquetas de grupo/fase: `text-xs font-semibold uppercase tracking-wide text-slate-500`.
- Mayúscula solo al inicio de títulos y botones («Nueva reposición»). Comillas «angulares». «…» de un carácter.

## 4. Espaciado y estructura

- Contenedor: `max-w-7xl` centrado, `px-4 py-6`. Formularios largos: `max-w-4xl`.
- Ritmo vertical entre bloques: `gap-4`; dentro de tarjetas `p-4` (o `px-4 py-3 sm:px-5`).
- Rejillas: 1 columna en móvil, 2–3 en `sm`/`lg`. Ficha de detalle: contenido `1fr` + lateral `22rem` en `lg`.
- Cabecera fija (`sticky top-0`, `h-16`, `natu-dark`): logo, pestañas «Nuevos desarrollos» / «Reposiciones»,
  Backoffice (admin), botón «Nueva…» salvia y avatar con iniciales.
- Backoffice: menú lateral de enlaces (`lg:w-52`) + contenido.

## 5. Elevación y forma

- Tarjetas: `rounded-xl border border-slate-200 bg-white shadow-sm`.
- Controles y botones: `rounded-md`; chips y badges: `rounded-full`; diálogos: `rounded-xl` (hoja inferior
  `rounded-t-2xl` en móvil).
- Sombras solo `shadow-sm` (tarjetas, botones) y `shadow-lg/xl` (menús, diálogos, widget flotante).

## 6. Componentes

Usar siempre los existentes antes de crear otros.

- **Button** (`ui/button`): `default` (gris oscuro, acción principal: una por zona), `secondary` (blanco con
  anillo), `ghost` (cancelar/volver), `danger`, `warning` (acciones que devuelven o piden cambios), `link`.
  Tamaños `sm`/`default`/`lg`/`icon`. Con carga: icono `Loader2 animate-spin` y deshabilitado.
- **Field + Input/Select/Textarea/Checkbox** (`ui/form`): etiqueta encima, `*` rosa si es obligatorio,
  ayuda en `text-xs`; error en `rose-600` bajo el campo. Pasar `htmlFor` y el mismo `id` al control.
- **Card / CardHeader / CardBody** (`ui/card`).
- **Badge / StatusBadge / DeptChip** (`ui/badge`): estados con `ring-1` y fondo suave.
- **Dialog / DialogContent** (`ui/dialog`): título + descripción; botones al final a la derecha
  (`ghost` «Volver/Cancelar» + principal «Confirmar»). `wide` para vistas previas.
- **Tablas**: `Table/Th/Td` (`components/admin`) o tabla con cabecera `bg-slate-50 text-xs text-slate-500`
  y filas `border-b border-slate-100`; contenedor con `overflow-x-auto`.
- **Stepper de estados**: píldoras `rounded-full` unidas por una línea corta; completadas salvia con ✓,
  actual `natu-dark`, pendientes `slate-100`.
- **Banners**: «te toca» / positivo en caja salvia (`#eef0e6`, `ring-natu-sage`); avisos en ámbar; errores en rosa.
- **Toasts**: `sonner` (`toast.success/error/warning/info`) para el resultado de acciones.
- **Vista previa de emails**: `EmailPreview` (pestañas por destinatario + iframe aislado).
- **Emails**: `renderEmail` (`src/lib/server/email-template.ts`): cabecera `#3e3f3e`, tabla de datos,
  botón oscuro; para externos sin botón y con pie propio.
- **Iconos**: `lucide-react`, `size-4` (o `size-3.5` en textos pequeños); decorativos con `aria-hidden`;
  botones solo-icono con `aria-label` y `title`.

## 7. Textos

- Segunda persona, frases cortas y concretas: «Sube el arte final antes de enviarlo a Calidad».
- Botones con verbo y objeto: «Enviar cotización al comercial», «Pedir correcciones».
- Errores: qué pasa y cómo arreglarlo. Estados vacíos: frase breve en `text-slate-500`.
- Fechas con `formatDate` (es-ES, Europe/Madrid); números con `toLocaleString("es-ES")`; precios con coma.

## 8. Accesibilidad

- Foco visible global (contorno `brand-500`); no quitarlo sin alternativa.
- Todo control con etiqueta (visible o `aria-label`); acciones con `<button>`, navegación con `<Link>`.
- Contraste: texto secundario mínimo `slate-500` sobre blanco; no poner texto sobre `natu-sage` más claro que `natu-dark`.
- Mensajes dinámicos: toasts (sonner) o `aria-live="polite"`; confirmación en acciones destructivas.

## 9. Responsive

- Móvil primero: pestañas y botones abrevian el texto (`hidden sm:inline` / `sm:hidden`).
- Tablas con scroll horizontal; formularios en una columna; diálogos como hoja inferior.
- Elementos fijos (barra de guardar, widget del asistente) no deben tapar el contenido: añadir `pb-*` al final.

## 10. Evitar

- Colores nuevos fuera de esta paleta, degradados, sombras fuertes y animaciones decorativas.
- Más de un botón principal oscuro en la misma zona.
- Tarjetas pintadas enteras con colores de estado (usar badge o punto) salvo el sombreado salvia de completado.
- Textos en inglés, *Title Case* y comillas "rectas" en textos de usuario.
