@AGENTS.md

# Proyecto NPD (NATU)

- Especificación funcional: `docs/SPEC.md`. La interfaz y los textos de usuario van en español.
- Todo cambio de estado de proyecto pasa por `src/lib/server/state-machine.ts` (permisos + `activity_log` + notificaciones). No actualices `projects.status` desde otro sitio.
- El brief vive en `projects.brief` (JSONB) validado por `src/lib/brief/schema.ts`; la obligatoriedad y etiquetas están en `src/lib/brief/fields.ts`. Los campos de filtro/KPI se desnormalizan en columnas (`columnsFromBrief`).
- Server actions: autorizar siempre en servidor (`requireActionUser`, `requireAdminAction`, `canViewProject`…).
- Graph nunca desde el cliente. Emails y SharePoint pasan por la cola `jobs` para reintentos.
- Comprobaciones: `pnpm lint && pnpm typecheck && pnpm test && pnpm build`. Tras tocar `src/db/schema.ts`: `pnpm db:generate`.
