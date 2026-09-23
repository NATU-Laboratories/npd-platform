import { db } from "@/db";
import { gateDeciders } from "@/db/schema";
import { PageTitle, Table, Td, Th } from "@/components/admin";
import { Button } from "@/components/ui/button";
import { saveDecidersAction } from "@/app/actions/admin";
import { getActiveUsers } from "@/lib/server/catalogs";
import { PHASES } from "@/lib/labels";

export const metadata = { title: "Decisores por puerta" };

const PROPOSAL: Record<string, string> = {
  G1: "Responsable de Marketing",
  G2: "MP: Comité de Dirección · PL: Marketing registra aceptación del cliente",
  G3: "PL: Marketing registra ok del cliente · MP: Marketing (propuesta)",
  G4: "PL: Marketing registra ok del cliente · MP: Marketing (propuesta)",
  G5: "Operaciones / Project Manager (propuesta)",
};

export default async function DecidersPage() {
  const [rows, people] = await Promise.all([db.select().from(gateDeciders), getActiveUsers()]);
  return (
    <>
      <PageTitle
        title="Decisores por puerta"
        description="Matriz puerta × tipo de proyecto. Los usuarios seleccionados reciben el rol Decisor automáticamente. En V1 solo se decide G1; G2–G5 quedan configurados para V2."
      />
      <form action={saveDecidersAction}>
        <Table>
          <thead>
            <tr>
              <Th>Puerta</Th>
              <Th>Marca privada (PL)</Th>
              <Th>Marca propia (MP)</Th>
            </tr>
          </thead>
          <tbody>
            {PHASES.map((ph) => (
              <tr key={ph.gate}>
                <Td className="w-64">
                  <p className="font-medium">
                    {ph.gate} – {ph.gateName}
                  </p>
                  <p className="text-xs text-slate-500">{PROPOSAL[ph.gate]}</p>
                </Td>
                {(["PL", "MP"] as const).map((t) => (
                  <Td key={t}>
                    <div className="grid max-h-40 gap-0.5 overflow-y-auto">
                      {people.map((p) => (
                        <label key={p.id} className="flex items-center gap-1.5 text-xs">
                          <input
                            type="checkbox"
                            name={`${ph.gate}_${t}`}
                            value={p.id}
                            defaultChecked={rows.some((r) => r.gate === ph.gate && r.projectType === t && r.userId === p.id)}
                            className="accent-brand-600"
                          />
                          {p.name}
                        </label>
                      ))}
                    </div>
                  </Td>
                ))}
              </tr>
            ))}
          </tbody>
        </Table>
        <div className="mt-4 flex justify-end">
          <Button type="submit">Guardar matriz</Button>
        </div>
      </form>
    </>
  );
}
