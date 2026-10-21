import { createHash } from "node:crypto";

/** Tokens (sessioner, inbjudningar) sparas bara som hash i databasen. */
export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
