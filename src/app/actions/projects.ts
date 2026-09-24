"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { AuthzError, requireActionUser } from "@/lib/server/authz";
import { logError } from "@/lib/server/errors";
import {
  ActionError,
  answerInfoRequest,
  cancelProject,
  createDraft,
  decideGate,
  advancePhase,
  decideBudget,
  deleteDraft,
  markPrepaymentReceived,
  pauseProject,
  sendQuote,
  type BudgetDecision,
  resumeProject,
  saveBrief,
  submitProject,
  type GateDecision,
} from "@/lib/server/state-machine";

export type ActionResult<T = undefined> =
  | { ok: true; data?: T }
  | { ok: false; error: string; fieldErrors?: Record<string, string> };

/** Envuelve una acción: errores de negocio → mensaje; inesperados → error_log. */
async function run<T>(name: string, fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (err) {
    if (err instanceof ActionError) return { ok: false, error: err.message, fieldErrors: err.fieldErrors };
    if (err instanceof AuthzError) return { ok: false, error: err.message };
    await logError(`action:${name}`, err);
    return { ok: false, error: "Se ha producido un error inesperado. Queda registrado en el log." };
  }
}

export async function newDraftAction() {
  const u = await requireActionUser();
  const id = await createDraft(u);
  redirect(`/solicitudes/${id}`);
}

export async function saveBriefAction(projectId: string, brief: unknown) {
  return run("saveBrief", async () => {
    const u = await requireActionUser();
    const res = await saveBrief(u, projectId, brief);
    revalidatePath(`/proyectos/${projectId}`);
    return res;
  });
}

export async function submitAction(projectId: string) {
  return run("submit", async () => {
    const u = await requireActionUser();
    const code = await submitProject(u, projectId);
    revalidatePath("/");
    return { code };
  });
}

export async function deleteDraftAction(projectId: string) {
  return run("deleteDraft", async () => {
    const u = await requireActionUser();
    await deleteDraft(u, projectId);
    revalidatePath("/");
  });
}

export async function decideGateAction(projectId: string, decision: GateDecision) {
  return run("decideGate", async () => {
    const u = await requireActionUser();
    await decideGate(u, projectId, decision);
    revalidatePath(`/proyectos/${projectId}`);
    revalidatePath("/");
  });
}

export async function answerInfoAction(projectId: string, answer: string) {
  return run("answerInfo", async () => {
    const u = await requireActionUser();
    await answerInfoRequest(u, projectId, answer);
    revalidatePath(`/proyectos/${projectId}`);
  });
}

export async function resumeAction(projectId: string, comment: string) {
  return run("resume", async () => {
    const u = await requireActionUser();
    await resumeProject(u, projectId, comment);
    revalidatePath(`/proyectos/${projectId}`);
  });
}

export async function cancelAction(projectId: string, reason: string) {
  return run("cancel", async () => {
    const u = await requireActionUser();
    await cancelProject(u, projectId, reason);
    revalidatePath(`/proyectos/${projectId}`);
  });
}

export async function pauseAction(projectId: string, reason: string) {
  return run("pause", async () => {
    const u = await requireActionUser();
    await pauseProject(u, projectId, reason);
    revalidatePath(`/proyectos/${projectId}`);
  });
}

export async function sendQuoteAction(projectId: string, input: { amount?: number | null; comment?: string | null }) {
  return run("sendQuote", async () => {
    const u = await requireActionUser();
    await sendQuote(u, projectId, input);
    revalidatePath(`/proyectos/${projectId}`);
    revalidatePath("/");
  });
}

export async function decideBudgetAction(projectId: string, decision: BudgetDecision) {
  return run("decideBudget", async () => {
    const u = await requireActionUser();
    await decideBudget(u, projectId, decision);
    revalidatePath(`/proyectos/${projectId}`);
    revalidatePath("/");
  });
}

export async function advancePhaseAction(projectId: string, comment: string) {
  return run("advancePhase", async () => {
    const u = await requireActionUser();
    await advancePhase(u, projectId, comment);
    revalidatePath(`/proyectos/${projectId}`);
    revalidatePath("/");
  });
}

export async function markPrepaymentAction(projectId: string, note: string) {
  return run("markPrepayment", async () => {
    const u = await requireActionUser();
    await markPrepaymentReceived(u, projectId, note);
    revalidatePath(`/proyectos/${projectId}`);
  });
}
