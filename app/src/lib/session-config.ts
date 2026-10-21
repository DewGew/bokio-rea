// Delas mellan servern och webbläsaren.

/** Man loggas ut automatiskt efter så här många minuter utan aktivitet. */
export const IDLE_MINUTES = 30;

export const ROLES = {
  owner: { label: "Ägare", hint: "Allt, inklusive att bjuda in och ta bort användare." },
  full: { label: "Full behörighet", hint: "Kan bokföra, fakturera och ändra inställningar, men inte hantera användare." },
  read: { label: "Läsbehörighet", hint: "Kan se bokföring, rapporter och underlag men inte ändra något." },
} as const;

export type Role = keyof typeof ROLES;
export const isRole = (r: string): r is Role => r in ROLES;
