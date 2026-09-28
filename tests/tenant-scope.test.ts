/**
 * Multi-tenancy guard: every query that reads, updates or deletes a shop-owned table must be
 * scoped to one shop with `tenantId` (see docs/CONVENTIONS.md). Inserts are checked by the
 * compiler (tenantId is a required column), and composite foreign keys stop cross-shop references.
 *
 * This parses src/ and flags `.from(t)`, `.update(t)` and `.delete(t)` on a tenant table when
 * neither the query chain nor the variables used in its `.where(...)` mention tenantId.
 * If a query is scoped some other way (e.g. by a unique proof token), put a comment containing
 * `tenant-scope:` and the reason on the line above it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

// Tables WITHOUT tenant_id (or looked up by secret token): tenants, sessions/account_tokens/portal_sessions/login_attempts (keyed by
// user/secret token/email/ip) and mentions (scoped through its message). Everything else is shop-owned.
const GLOBAL_TABLES = new Set(["tenants", "sessions", "accountTokens", "portalSessions", "loginAttempts", "mentions"]);

function tenantTables(): Set<string> {
  const src = readFileSync(path.join(__dirname, "../src/lib/db/schema.ts"), "utf8");
  const names = [...src.matchAll(/export const (\w+) = pgTable\(/g)].map((m) => m[1]!);
  return new Set(names.filter((n) => !GLOBAL_TABLES.has(n)));
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = path.join(dir, f);
    if (statSync(p).isDirectory()) return sourceFiles(p);
    return /\.(ts|tsx)$/.test(f) ? [p] : [];
  });
}

type Finding = { file: string; line: number; text: string };

function check(file: string, tables: Set<string>): Finding[] {
  const text = readFileSync(file, "utf8");
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const findings: Finding[] = [];
  const lines = text.split("\n");

  const tableName = (e: ts.Expression): string | null => {
    if (ts.isIdentifier(e)) return e.text;
    if (ts.isPropertyAccessExpression(e) && ts.isIdentifier(e.expression) && ["s", "schema"].includes(e.expression.text)) return e.name.text;
    return null;
  };

  /** The whole fluent chain the call belongs to: db.select().from(x).where(...).orderBy(...) */
  const chainTop = (n: ts.Node): ts.Node => {
    let cur: ts.Node = n;
    while (cur.parent && (ts.isPropertyAccessExpression(cur.parent) || (ts.isCallExpression(cur.parent) && cur.parent.expression === cur))) cur = cur.parent;
    return cur;
  };

  const enclosingFunction = (n: ts.Node): ts.Node => {
    let cur: ts.Node | undefined = n.parent;
    while (cur && !ts.isFunctionLike(cur) && !ts.isSourceFile(cur)) cur = cur.parent;
    return cur ?? sf;
  };

  /** Identifiers used inside .where(...) args of the chain, e.g. `and(...conds)` → conds. */
  const whereIdentifiers = (chain: ts.Node): string[] => {
    const ids: string[] = [];
    const visit = (n: ts.Node) => {
      if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === "where") {
        n.arguments.forEach((a) => {
          const walk = (x: ts.Node) => {
            if (ts.isIdentifier(x)) ids.push(x.text);
            x.forEachChild(walk);
          };
          walk(a);
        });
      }
      n.forEachChild(visit);
    };
    visit(chain);
    return ids;
  };

  const scoped = (call: ts.CallExpression): boolean => {
    const chain = chainTop(call);
    if (/tenantId|tenant_id/.test(chain.getText(sf))) return true;
    // Where-conditions built elsewhere in the same function: accept if a line using them mentions tenantId.
    const fnText = enclosingFunction(call).getText(sf).split("\n");
    for (const id of new Set(whereIdentifiers(chain))) {
      const re = new RegExp(`\\b${id}\\b`);
      if (fnText.some((l) => re.test(l) && /tenantId|tenant_id/.test(l))) return true;
    }
    // Explicit, reasoned exception on the line(s) above.
    const line = sf.getLineAndCharacterOfPosition(chain.getStart(sf)).line;
    return lines.slice(Math.max(0, line - 3), line + 1).some((l) => l.includes("tenant-scope:"));
  };

  const visit = (n: ts.Node) => {
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.arguments.length >= 1) {
      const method = n.expression.name.text;
      if (method === "from" || method === "update" || method === "delete") {
        const t = tableName(n.arguments[0]!);
        if (t && tables.has(t) && !scoped(n)) {
          const { line } = sf.getLineAndCharacterOfPosition(n.getStart(sf));
          findings.push({ file: path.relative(process.cwd(), file), line: line + 1, text: `${method}(${t})` });
        }
      }
    }
    n.forEachChild(visit);
  };
  visit(sf);
  return findings;
}

test("every query on a shop-owned table is scoped by tenantId", () => {
  const tables = tenantTables();
  assert.ok(tables.has("jobs") && tables.has("customers") && !tables.has("tenants"), "schema tables were not detected");
  const files = sourceFiles(path.join(__dirname, "../src")).filter((f) => !f.endsWith(path.join("db", "schema.ts")));
  const findings = files.flatMap((f) => check(f, tables));
  assert.deepEqual(
    findings.map((f) => `${f.file}:${f.line} ${f.text}`),
    [],
    "These queries are not limited to one shop. Add eq(<table>.tenantId, user.tenantId) to the where clause.",
  );
});
