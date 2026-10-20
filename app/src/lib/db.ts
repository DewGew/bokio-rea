import { PrismaClient } from "@prisma/client";
// Delad modul som även används av byggskriptet (scripts/migrate.mjs).
import { pooledName } from "../../scripts/db-url.mjs";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

// Använd DATABASE_URL, eller motsvarande variabel om integrationen gett den ett annat namn/prefix.
const name = pooledName();
const datasourceUrl = name ? process.env[name] : undefined;

export const db = globalForPrisma.prisma ?? new PrismaClient(datasourceUrl ? { datasourceUrl } : undefined);

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;
