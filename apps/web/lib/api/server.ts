import "server-only";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";

const INTERNAL_URL = process.env.ONYX_INTERNAL_URL ?? "http://127.0.0.1:4000";

export async function serverFetch<T>(path: string): Promise<T> {
  const cookieStore = await cookies();
  const response = await fetch(`${INTERNAL_URL}${path}`, {
    headers: { cookie: cookieStore.toString() },
    cache: "no-store",
  });
  if (response.status === 401) redirect("/login");
  if (response.status === 404) notFound();
  if (!response.ok) throw new Error(`Onyx API ${path} responded ${response.status}`);
  return (await response.json()) as T;
}

export async function serverFetchPublic<T>(path: string): Promise<T | null> {
  try {
    const response = await fetch(`${INTERNAL_URL}${path}`, { cache: "no-store" });
    return response.ok ? ((await response.json()) as T) : null;
  } catch {
    return null;
  }
}
