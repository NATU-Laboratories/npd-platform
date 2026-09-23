import NextAuth, { type NextAuthConfig } from "next-auth";
import MicrosoftEntraID from "next-auth/providers/microsoft-entra-id";
import Credentials from "next-auth/providers/credentials";
import { CredentialsSignin } from "next-auth";
import { timingSafeEqual } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { loginEvents, roles, userRoles, users } from "@/db/schema";

declare module "next-auth" {
  interface Session {
    user: { id: string; email: string; name: string };
  }
}

/** Fallo técnico (p. ej. base de datos) durante el acceso provisional. */
class LoginBackendError extends CredentialsSignin {
  code = "backend";
}

/**
 * Acceso provisional sin Entra ID (desarrollo y pruebas previas a la
 * configuración de Microsoft). En un despliegue de Vercel exige una clave
 * compartida (AUTH_DEV_PASSWORD); sin ella solo funciona en local.
 */
const devPassword = process.env.AUTH_DEV_PASSWORD ?? "";
export const devLoginRequiresPassword = devPassword.length > 0;
export const devLoginEnabled =
  process.env.AUTH_DEV_LOGIN === "true" && (devLoginRequiresPassword || !process.env.VERCEL);

function passwordOk(given: unknown) {
  if (!devLoginRequiresPassword) return true;
  const a = Buffer.from(String(given ?? ""));
  const b = Buffer.from(devPassword);
  return a.length === b.length && timingSafeEqual(a, b);
}

const adminEmails = (process.env.ADMIN_EMAILS ?? "")
  .split(",")
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

/**
 * Da de alta o actualiza al usuario tras autenticarse. Los usuarios nuevos
 * quedan "pendientes de activación" (§4) salvo los de ADMIN_EMAILS (arranque).
 * Devuelve null si el usuario está desactivado.
 */
async function upsertUser(p: { oid?: string; email: string; name: string }) {
  const email = p.email.toLowerCase();
  const [existing] = await db
    .select()
    .from(users)
    .where(p.oid ? sql`${users.entraOid} = ${p.oid} or lower(${users.email}) = ${email}` : sql`lower(${users.email}) = ${email}`)
    .limit(1);

  if (existing) {
    if (existing.status === "disabled") return null;
    await db
      .update(users)
      .set({ lastLoginAt: new Date(), name: p.name || existing.name, entraOid: existing.entraOid ?? p.oid ?? null })
      .where(eq(users.id, existing.id));
    await db.insert(loginEvents).values({ userId: existing.id });
    return existing.id;
  }

  const bootstrapAdmin = adminEmails.includes(email);
  const [created] = await db
    .insert(users)
    .values({
      email,
      name: p.name || email,
      entraOid: p.oid ?? null,
      status: bootstrapAdmin ? "active" : "pending",
      isActive: bootstrapAdmin,
      lastLoginAt: new Date(),
    })
    .returning({ id: users.id });
  await db.insert(loginEvents).values({ userId: created!.id });

  if (bootstrapAdmin) {
    const [adminRole] = await db.select().from(roles).where(eq(roles.key, "admin"));
    if (adminRole) await db.insert(userRoles).values({ userId: created!.id, roleId: adminRole.id }).onConflictDoNothing();
  } else {
    // Aviso a los administradores (import dinámico para no cargar Graph en el callback)
    const { notifyPendingUser } = await import("@/lib/server/notifications");
    await notifyPendingUser(created!.id);
  }
  return created!.id;
}

const providers: NextAuthConfig["providers"] = [
  MicrosoftEntraID({
    clientId: process.env.AUTH_MICROSOFT_ENTRA_ID_ID,
    clientSecret: process.env.AUTH_MICROSOFT_ENTRA_ID_SECRET,
    issuer: process.env.AUTH_MICROSOFT_ENTRA_ID_ISSUER,
    authorization: { params: { scope: "openid profile email User.Read" } },
  }),
];

if (devLoginEnabled) {
  providers.push(
    Credentials({
      id: "dev",
      name: "Desarrollo",
      credentials: { email: { label: "Email" }, name: { label: "Nombre" }, password: { label: "Clave", type: "password" } },
      async authorize(creds) {
        if (!passwordOk(creds?.password)) return null;
        const email = String(creds?.email ?? "").trim();
        if (!email.includes("@")) return null;
        const name = String(creds?.name ?? "").trim() || email.split("@")[0]!;
        try {
          const id = await upsertUser({ email, name });
          return id ? { id, email, name } : null;
        } catch (err) {
          console.error("[auth] fallo en el acceso provisional", err);
          throw new LoginBackendError();
        }
      },
    }),
  );
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers,
  session: { strategy: "jwt", maxAge: 8 * 60 * 60 },
  pages: { signIn: "/login", error: "/login" },
  trustHost: true,
  callbacks: {
    async signIn({ account, profile }) {
      if (account?.provider !== "microsoft-entra-id") return true;
      const tenant = process.env.AUTH_MICROSOFT_ENTRA_ID_TENANT_ID;
      if (tenant && profile?.tid && profile.tid !== tenant) return false;
      const email = String(profile?.email ?? profile?.preferred_username ?? "");
      if (!email) return false;
      const id = await upsertUser({ oid: String(profile?.oid ?? ""), email, name: String(profile?.name ?? "") });
      return id ? true : "/login?error=disabled";
    },
    async jwt({ token, user, account, profile }) {
      if (account?.provider === "dev" && user?.id) token.uid = user.id;
      if (account?.provider === "microsoft-entra-id" && profile) {
        const email = String(profile.email ?? profile.preferred_username ?? "").toLowerCase();
        const [u] = await db
          .select({ id: users.id })
          .from(users)
          .where(sql`${users.entraOid} = ${String(profile.oid ?? "")} or lower(${users.email}) = ${email}`)
          .limit(1);
        if (u) token.uid = u.id;
      }
      return token;
    },
    async session({ session, token }) {
      if (token.uid) session.user.id = token.uid as string;
      return session;
    },
  },
});

