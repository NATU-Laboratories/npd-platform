---
name: web-design-guidelines
description: Revisa pantallas y componentes de la plataforma NPD (accesibilidad, foco, formularios, estados, textos, rendimiento) con las Web Interface Guidelines de Vercel adaptadas al proyecto. Úsala cuando se pida «revisa la interfaz», «revisa la accesibilidad», «audita el diseño» o antes de publicar pantallas nuevas.
argument-hint: <archivo-o-patrón>
---

# Revisión de interfaz (Web Interface Guidelines, adaptadas a NPD)

Basada en la skill `web-design-guidelines` de vercel-labs/agent-skills (MIT). Las reglas están en
[`guidelines.md`](guidelines.md): una copia fijada (no se descargan en cada revisión, para que no cambien
sin revisar y para que funcione sin red).

## Cómo se hace

1. Archivos a revisar: los indicados (`$ARGUMENTS`) o, si no hay, los `.tsx` cambiados en la rama
   (`git diff --name-only origin/main...HEAD -- 'src/**/*.tsx'`). Si no hay ninguno, pregunta cuáles.
2. Lee `guidelines.md`, `DESIGN.md` (sistema visual de NATU) y los archivos.
3. Aplica las reglas de `guidelines.md` **con las adaptaciones de abajo**, que tienen prioridad.
4. Informa con el formato de `guidelines.md` (agrupado por archivo, `ruta:línea - problema`), en español.
   Si se pide, corrige después; vuelve a pasar `pnpm lint && pnpm typecheck`.

## Adaptaciones al proyecto (prevalecen sobre `guidelines.md`)

- **Idioma**: la interfaz y los textos van en español (CLAUDE.md). Señala cualquier texto de usuario en inglés.
- **Mayúsculas**: títulos y botones en mayúscula solo al inicio (estilo español: «Nueva reposición»,
  no «Nueva Reposición»). Ignora la regla de *Title Case*.
- **Comillas**: «angulares» para citar estados, campos o nombres en textos de usuario; no exijas “inglesas”.
- **Puntos suspensivos**: «…» (un carácter) en textos de carga y placeholders: «Guardando…», «Buscar…».
- **Fechas y números**: `formatDate` de `@/lib/utils` (es-ES, zona Europe/Madrid) y `toLocaleString("es-ES")`
  o `Intl.*` en `es-ES`; precios con coma decimal. No marques `formatDate` como «formato fijo».
- **Componentes propios**: `Field` (label + error + hint), `Input`, `Select`, `Textarea`, `Checkbox`
  (`@/components/ui/form`), `Button` (`@/components/ui/button`), `Dialog/DialogContent`, `Card`, `Badge`.
  Un `Field` solo asocia la etiqueta si recibe `htmlFor` y el control el mismo `id`: márcalo si falta.
- **Foco**: hay un `:focus-visible` global en `globals.css` (contorno salvia). No exijas `focus-visible:ring-*`
  en cada control salvo que lo anulen (`outline-none` sin alternativa).
- **Estado en la URL**: los filtros de listados van en `searchParams` (como el panel y Reposiciones).
  Diálogos y desplegables pueden quedarse en estado local.
- **Acciones destructivas**: confirmación (`window.confirm` o diálogo) siempre; las de estado de proyecto
  pasan por la máquina de estados del servidor (no es un problema de interfaz).
- **Fuera de alcance**: modo oscuro (la plataforma es solo clara), imágenes de producto/CDN, virtualización
  de listas cortas (< 200 filas), `safe-area` salvo en elementos fijos inferiores.
- **Tono de los textos**: frases cortas y directas, en segunda persona («Sube el arte final…»); los errores
  dicen qué hacer para resolverlos.
