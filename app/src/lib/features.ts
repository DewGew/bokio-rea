import "server-only";
import { cache } from "react";
import { db } from "./db";

/** Funktioner som ingår i Pro. Varje funktion kan dessutom stängas av för hela appen. */
export const FEATURES = {
  ai: { label: "AI-avläsning av kvitton", description: "Läser av belopp, datum och förslag på kontering från uppladdade underlag." },
  mcp: { label: "Koppling till Claude", description: "Låter Claude läsa (och bokföra) i ett företag via MCP." },
  inbound: { label: "Kvitton via e-post", description: "Tar emot kvitton och leverantörsfakturor på företagets egen e-postadress." },
} as const;

export type Feature = keyof typeof FEATURES;
export const FEATURE_KEYS = Object.keys(FEATURES) as Feature[];
export const PLANS = { free: "Gratis", pro: "Pro" } as const;
export type Plan = keyof typeof PLANS;
export const planLabel = (plan: string) => PLANS[plan as Plan] ?? plan;

export type Switches = Record<Feature, boolean>;

/** Appens strömbrytare. En funktion är på om ingen rad säger "off". */
export const globalSwitches = cache(async (): Promise<Switches> => {
  const rows = await db.systemSetting.findMany({ where: { key: { startsWith: "feature." } } });
  const off = new Set(rows.filter((r) => r.value === "off").map((r) => r.key));
  return { ai: !off.has("feature.ai"), mcp: !off.has("feature.mcp"), inbound: !off.has("feature.inbound") };
});

export type FeatureState = { available: true } | { available: false; reason: "global" | "plan" };

export function featureState(plan: string, switches: Switches, feature: Feature): FeatureState {
  if (!switches[feature]) return { available: false, reason: "global" };
  if (plan !== "pro") return { available: false, reason: "plan" };
  return { available: true };
}

export async function featureFor(company: { plan: string }, feature: Feature) {
  return featureState(company.plan, await globalSwitches(), feature);
}

/** Text till användaren när en funktion inte är tillgänglig. */
export function featureMessage(state: FeatureState, feature: Feature) {
  if (state.available) return "";
  const name = FEATURES[feature].label;
  return state.reason === "global"
    ? `${name} är tillfälligt avstängd av administratören.`
    : `${name} ingår i Pro. Kontakta administratören för att uppgradera företaget.`;
}
