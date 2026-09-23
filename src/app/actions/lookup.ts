"use server";
import { requireActionUser } from "@/lib/server/authz";
import { searchClients } from "@/lib/server/catalogs";

export async function searchClientsAction(q: string) {
  await requireActionUser();
  return searchClients(q, 15);
}
