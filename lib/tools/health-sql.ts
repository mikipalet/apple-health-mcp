import { sql } from "drizzle-orm";

// Read-only guard: the statement must be a single SELECT or WITH…SELECT, with no
// statement separator. This is the code-level safety net; the README also documents
// pointing health_sql at a Postgres role granted only SELECT for defense in depth.
export function assertReadOnly(query: string): void {
  const trimmed = query.trim().replace(/;\s*$/, ""); // allow one trailing semicolon
  if (trimmed.includes(";")) throw new Error("Only a single statement is allowed.");
  if (!/^(select|with)\b/i.test(trimmed)) throw new Error("Only read-only SELECT/WITH queries are allowed.");
  return;
}

export async function healthSql(db: any, query: string) {
  assertReadOnly(query);
  const result = await db.execute(sql.raw(query));
  return result.rows ?? result;
}
