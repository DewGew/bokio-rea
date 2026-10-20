import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { AccountingError } from "./accounting";

export function withParam(path: string, key: string, value: string) {
  return `${path}${path.includes("?") ? "&" : "?"}${key}=${encodeURIComponent(value)}`;
}

/** Kör en åtgärd; bokföringsfel visas som felmeddelande på sidan istället för att krascha. */
export async function attempt<T>(fn: () => Promise<T>, errorPath: string): Promise<T> {
  let result: T;
  try {
    result = await fn();
  } catch (e) {
    if (e instanceof AccountingError) redirect(withParam(errorPath, "error", e.message));
    throw e;
  }
  revalidatePath("/", "layout");
  return result;
}

export function str(fd: FormData, key: string) {
  const v = fd.get(key);
  return typeof v === "string" ? v.trim() : "";
}
