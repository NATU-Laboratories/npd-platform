import { db } from "@/db";
import { gateDeciders } from "@/db/schema";
import { PageTitle } from "@/components/admin";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { saveDecidersAction } from "@/app/actions/admin";
import { getActiveUsers } from "@/lib/server/catalogs";
import { APPROVAL_GATES, PROJECT_TYPE_KEYS, TYPE_LABEL } from "@/lib/labels";

export const metadata = { title: "Aprobadores" };

const HINT: Record<string, string> = {
  G1: "Habitualmente Marketing / NPD.",
  G2: "Habitualmente Comercial: registra que el cliente ha aprobado el presupuesto. En PL exige el anticipo del 30 % o un responsable que asuma iniciar sin él.",
};

export default async function DecidersPage() {
  const [rows, people] = await Promise.all([db.select().from(gateDeciders), getActiveUsers()]);
  return (
    <>
      <PageTitle
        title="Aprobadores por fase"
        description="Quién puede aprobar en cada una de las dos puertas del proceso, por tipo de proyecto. Los usuarios seleccionados reciben el rol Aprobador automáticamente."
      />
      <form action={saveDecidersAction} className="flex flex-col gap-6">
        {APPROVAL_GATES.map((g) => (
          <Card key={g.gate}>
            <CardHeader title={`${g.gate} · ${g.name}`} description={`${g.description} ${HINT[g.gate] ?? ""}`} />
            <CardBody className="grid gap-4 md:grid-cols-3">
              {PROJECT_TYPE_KEYS.map((t) => (
                <fieldset key={t} className="rounded-lg border border-slate-200 p-3">
                  <legend className="px-1 text-xs font-semibold text-slate-600">
                    {TYPE_LABEL[t]} ({t})
                  </legend>
                  <div className="grid max-h-48 gap-1 overflow-y-auto">
                    {people.map((p) => (
                      <label key={p.id} className="flex items-center gap-1.5 text-sm">
                        <input
                          type="checkbox"
                          name={`${g.gate}_${t}`}
                          value={p.id}
                          defaultChecked={rows.some((r) => r.gate === g.gate && r.projectType === t && r.userId === p.id)}
                          className="accent-brand-600"
                        />
                        {p.name}
                      </label>
                    ))}
                    {!people.length && <p className="text-xs text-slate-400">No hay usuarios activos.</p>}
                  </div>
                </fieldset>
              ))}
            </CardBody>
          </Card>
        ))}
        <div className="flex justify-end">
          <Button type="submit">Guardar aprobadores</Button>
        </div>
      </form>
    </>
  );
}
