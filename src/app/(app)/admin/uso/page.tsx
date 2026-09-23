import { sql } from "drizzle-orm";
import { db } from "@/db";
import { PageTitle, Table, Td, Th } from "@/components/admin";
import { Card } from "@/components/ui/card";

export const metadata = { title: "Uso" };

export default async function UsagePage() {
  const [summary, perUser, perDay] = await Promise.all([
    db.execute<{ active7: number; active30: number; sessions30: number }>(sql`
      select
        (select count(distinct user_id) from login_events where created_at > now() - interval '7 days')::int as active7,
        (select count(distinct user_id) from login_events where created_at > now() - interval '30 days')::int as active30,
        (select count(*) from login_events where created_at > now() - interval '30 days')::int as sessions30`),
    db.execute<{ name: string; sessions: number; requests: number; last: string | null }>(sql`
      select u.name,
        (select count(*) from login_events l where l.user_id = u.id and l.created_at > now() - interval '30 days')::int as sessions,
        (select count(*) from projects p where p.requester_id = u.id and p.status <> 'draft')::int as requests,
        u.last_login_at as last
      from users u where u.status = 'active' order by sessions desc, u.name limit 100`),
    db.execute<{ day: string; actions: number; users: number }>(sql`
      select to_char(date_trunc('day', created_at at time zone 'Europe/Madrid'), 'YYYY-MM-DD') as day,
        count(*)::int as actions, count(distinct actor_id)::int as users
      from activity_log where created_at > now() - interval '30 days'
      group by 1 order by 1 desc`),
  ]);
  const s = summary.rows[0]!;
  return (
    <>
      <PageTitle title="Uso" description="Usuarios activos, sesiones, solicitudes por usuario y acciones por día." />
      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        {[
          ["Usuarios activos (7 días)", s.active7],
          ["Usuarios activos (30 días)", s.active30],
          ["Sesiones (30 días)", s.sessions30],
        ].map(([l, v]) => (
          <Card key={l} className="px-4 py-3">
            <p className="text-xs text-slate-500">{l}</p>
            <p className="mt-1 text-2xl font-semibold">{v}</p>
          </Card>
        ))}
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Table>
          <thead>
            <tr>
              <Th>Usuario</Th>
              <Th className="text-right">Sesiones 30 d</Th>
              <Th className="text-right">Solicitudes</Th>
            </tr>
          </thead>
          <tbody>
            {perUser.rows.map((r) => (
              <tr key={r.name}>
                <Td>{r.name}</Td>
                <Td className="text-right tabular-nums">{r.sessions}</Td>
                <Td className="text-right tabular-nums">{r.requests}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
        <Table>
          <thead>
            <tr>
              <Th>Día</Th>
              <Th className="text-right">Acciones</Th>
              <Th className="text-right">Usuarios</Th>
            </tr>
          </thead>
          <tbody>
            {perDay.rows.map((r) => (
              <tr key={r.day}>
                <Td>{r.day}</Td>
                <Td className="text-right tabular-nums">{r.actions}</Td>
                <Td className="text-right tabular-nums">{r.users}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </div>
    </>
  );
}
