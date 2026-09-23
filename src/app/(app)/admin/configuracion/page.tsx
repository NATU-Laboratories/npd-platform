import { PageTitle } from "@/components/admin";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox, Field, Input } from "@/components/ui/form";
import { saveSettingsAction } from "@/app/actions/admin";
import { getSettings } from "@/lib/server/settings";

export const metadata = { title: "Configuración" };

export default async function SettingsPage() {
  const s = await getSettings();
  return (
    <>
      <PageTitle title="Configuración" />
      <Card className="max-w-2xl p-5">
        <form action={saveSettingsAction} className="grid gap-4 sm:grid-cols-2">
          <Field label="Umbral de completitud (%)" hint="Por debajo, el asistente avisa antes de enviar (no bloquea).">
            <Input name="completeness_threshold" type="number" min={0} max={100} defaultValue={s.completeness_threshold} />
          </Field>
          <Field label="Días para «en riesgo»" hint="Proyectos abiertos con fecha necesaria dentro de este plazo.">
            <Input name="risk_days" type="number" min={1} max={365} defaultValue={s.risk_days} />
          </Field>
          <Field label="Tamaño máximo por archivo (MB)">
            <Input name="max_file_mb" type="number" min={1} max={250} defaultValue={s.max_file_mb} />
          </Field>
          <Field label="Buzón remitente" hint="Vacío = variable de entorno MAIL_SENDER.">
            <Input name="sender_mailbox" type="email" defaultValue={s.sender_mailbox} placeholder="proyectos@…" />
          </Field>
          <div className="sm:col-span-2">
            <Checkbox name="requesters_see_all" label="Los solicitantes pueden ver todos los proyectos en modo lectura" defaultChecked={s.requesters_see_all} />
          </div>
          <div className="sm:col-span-2">
            <Button type="submit">Guardar</Button>
          </div>
        </form>
      </Card>
    </>
  );
}
