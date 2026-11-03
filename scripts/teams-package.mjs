// Genera el paquete de la app de Teams (manifest.json + iconos en un .zip) para subirlo
// en el Centro de administración de Teams. Uso:
//   pnpm teams:package <TEAMS_APP_ID> [https://url-de-la-plataforma]
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [appId, url = "https://npd-platform-seven.vercel.app"] = process.argv.slice(2);
if (!/^[0-9a-f-]{36}$/i.test(appId ?? "")) {
  console.error("Indica el ID de aplicación (cliente) del bot: pnpm teams:package <TEAMS_APP_ID> [URL]");
  process.exit(1);
}
const base = url.replace(/\/$/, "");
const manifest = {
  $schema: "https://developer.microsoft.com/json-schemas/teams/v1.19/MicrosoftTeams.schema.json",
  manifestVersion: "1.19",
  version: "1.0.0",
  id: appId,
  developer: { name: "NATU Laboratories", websiteUrl: base, privacyUrl: base, termsOfUseUrl: base },
  name: { short: "Asistente NPD", full: "Asistente NPD · NATU Laboratories" },
  description: {
    short: "Consulta el estado de los proyectos NPD y tus pendientes.",
    full: "Asistente de la plataforma NPD de NATU Laboratories: cómo va cada proyecto que puedes ver, qué tienes pendiente y cómo se usa la plataforma. Solo consulta, no hace cambios.",
  },
  icons: { color: "color.png", outline: "outline.png" },
  accentColor: "#96A27A",
  bots: [
    {
      botId: appId,
      scopes: ["personal"],
      supportsFiles: false,
      isNotificationOnly: false,
      commandLists: [
        {
          scopes: ["personal"],
          commands: [
            { title: "¿Qué tengo pendiente?", description: "Proyectos que requieren tu acción" },
            { title: "¿Qué proyectos están en riesgo?", description: "Entrega requerida próxima" },
            { title: "reiniciar", description: "Empezar una conversación nueva" },
          ],
        },
      ],
    },
  ],
  permissions: ["identity", "messageTeamMembers"],
  validDomains: [new URL(base).host],
};

const dir = new URL("../teams-app/", import.meta.url).pathname;
const out = join(dir, "build");
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
writeFileSync(join(out, "manifest.json"), JSON.stringify(manifest, null, 2));
copyFileSync(join(dir, "color.png"), join(out, "color.png"));
copyFileSync(join(dir, "outline.png"), join(out, "outline.png"));
execFileSync("zip", ["-j", "-q", join(out, "asistente-npd-teams.zip"), "manifest.json", "color.png", "outline.png"], { cwd: out });
console.log(`Paquete listo: ${join(out, "asistente-npd-teams.zip")}`);
