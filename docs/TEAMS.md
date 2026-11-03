# Asistente NPD en Microsoft Teams

El asistente virtual de la plataforma se puede usar como chat personal en Teams («Asistente NPD»).
Responde lo mismo que el chat flotante: cada persona solo ve los proyectos que ve en la plataforma,
y solo consulta (no hace cambios).

- Punto de conexión del bot: `https://<dominio>/api/teams/messages`
- Cada mensaje se valida (token de Bot Framework, ID del bot y tenant de NATU).
- La persona se identifica por su cuenta corporativa (ID de Entra o email) y se asocia a su usuario
  de la plataforma. Si no está dada de alta y activa, el bot se lo indica y no responde nada más.
- El historial de cada chat se guarda en `assistant_chats` (últimos 30 mensajes). «reiniciar» lo borra.

## Permisos que necesita quien lo configure

| Paso | Permiso |
|---|---|
| Crear el recurso Azure Bot | Colaborador (*Contributor*) en una suscripción o grupo de recursos de Azure |
| Crear el registro de aplicación del bot | *Application Developer* (o superior) en Microsoft Entra ID |
| Publicar la app en Teams | *Teams Administrator* |

## 1. Crear el bot en Azure

1. Entra en **portal.azure.com** → **Crear un recurso** → busca **Azure Bot** → **Crear**.
2. Rellena:
   - **Identificador del bot**: `npd-asistente`
   - **Suscripción** y **Grupo de recursos**: los de NATU (o crea uno, p. ej. `rg-npd`).
   - **Residencia de datos**: Regional → Europa (o Global).
   - **Plan de tarifa**: cámbialo a **Gratis (F0)**. Los mensajes por el canal de Teams no tienen coste.
   - **Tipo de aplicación**: **Inquilino único (Single Tenant)**.
   - **Tipo de creación**: **Crear un nuevo identificador de aplicación de Microsoft**.
3. **Revisar y crear** → **Crear**. Al terminar, **Ir al recurso**.

## 2. Configurar el bot

1. En el recurso, **Configuración**:
   - **Punto de conexión de mensajería**: `https://npd-platform-seven.vercel.app/api/teams/messages`
     (o el dominio definitivo de la plataforma).
   - Copia el **Id. de aplicación de Microsoft** y el **Id. de inquilino de la aplicación**.
   - **Aplicar**.
2. En la misma pantalla, junto al Id. de aplicación, pulsa **Administrar contraseña**
   → **Certificados y secretos** → **Nuevo secreto de cliente** → descripción «NPD Teams», caducidad 24 meses
   → **Agregar**. Copia el **Valor** (solo se muestra una vez).
3. Vuelve al recurso del bot → **Canales** → **Microsoft Teams** → acepta las condiciones → **Aplicar**.

> «Probar en Web Chat» no responderá: el bot solo atiende mensajes de Teams del tenant de NATU.

## 3. Variables en Vercel

En Vercel → proyecto **npd-platform** → **Settings → Environment Variables** (Production):

| Key | Value |
|---|---|
| `TEAMS_APP_ID` | Id. de aplicación de Microsoft |
| `TEAMS_APP_PASSWORD` | Valor del secreto de cliente |
| `TEAMS_TENANT_ID` | Id. de inquilino |

Guarda y haz **Redeploy**. Comprueba en `https://<dominio>/api/health` que aparece `"teamsBot": true`.

## 4. Paquete de la app de Teams

Con el Id. de aplicación, genera el paquete (manifiesto + iconos de NATU):

```bash
pnpm teams:package <TEAMS_APP_ID> https://npd-platform-seven.vercel.app
```

Se crea `teams-app/build/asistente-npd-teams.zip`.

## 5. Publicarla en Teams

1. Entra en **admin.teams.microsoft.com** → **Aplicaciones de Teams** → **Administrar aplicaciones**
   → **Cargar nueva aplicación** → **Cargar** → elige el `.zip`.
2. Abre la app «Asistente NPD» y comprueba que su estado es **Permitida**.
3. Para que la vea todo el mundo (o un grupo de prueba):
   - **Directivas de permisos** (o *Administrar aplicaciones → Acceso*): que esté permitida para esos usuarios.
   - Opcional: **Directivas de configuración** → **Aplicaciones ancladas** → añade «Asistente NPD»
     para que aparezca fija en la barra lateral.
4. Los usuarios la encuentran en Teams → **Aplicaciones** → **Creada para tu organización** → **Agregar**.
   Los cambios de directivas pueden tardar unas horas en llegar.

## Mantenimiento

- El secreto de cliente caduca (24 meses): antes de esa fecha crea uno nuevo y actualiza `TEAMS_APP_PASSWORD`.
- Si el bot no responde, revisa Backoffice → Errores (origen `teams`).
- Los usuarios deben estar dados de alta en la plataforma con su email corporativo (los preregistrados
  «sin email» no se pueden asociar).
