import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migrationsDir = join(process.cwd(), "supabase", "migrations");

const migrations = readdirSync(migrationsDir)
  .filter((name) => name.endsWith(".sql"))
  .sort()
  .map((name) => ({ name, sql: readFileSync(join(migrationsDir, name), "utf8") }));

const tablesWithoutDomainData = new Set([
  "profiles",
  "account_invitations",
  "member_presence",
  "pending_message_statuses",
]);

function accountScopedTables(): Map<string, boolean> {
  const tables = new Map<string, boolean>();
  const accountForeignKey = /\baccount_id\s+uuid\b[^,;]*references\s+(?:public\.)?accounts\s*\(\s*id\s*\)/i;
  const tableName = /(?:create\s+table(?:\s+if\s+not\s+exists)?|alter\s+table)\s+(?:public\.)?(\w+)/i;
  for (const { sql } of migrations) {
    for (const statement of sql.split(";")) {
      const foreignKey = statement.match(accountForeignKey);
      if (!foreignKey) continue;
      const match = statement.match(tableName);
      if (match) {
        const deletionRule = statement.slice((foreignKey.index ?? 0) + foreignKey[0].length);
        tables.set(match[1].toLowerCase(), /^\s+on\s+delete\s+restrict\b/i.test(deletionRule));
      }
    }
  }
  return tables;
}

function latestFunctionBody(functionName: string): string {
  const header = new RegExp(`create\\s+or\\s+replace\\s+function\\s+public\\.${functionName}\\s*\\(`, "i");
  const latest = migrations.filter(({ sql }) => header.test(sql)).at(-1);
  if (!latest) throw new Error(`${functionName} is not defined in any migration`);
  const start = latest.sql.search(header);
  const bodyStart = latest.sql.indexOf("$$", start);
  const bodyEnd = latest.sql.indexOf("$$", bodyStart + 2);
  return latest.sql.slice(bodyStart + 2, bodyEnd);
}

describe("redeem_invitation migration", () => {
  const body = latestFunctionBody("redeem_invitation");

  it("finds the account-scoped tables it is meant to guard", () => {
    const tables = accountScopedTables();
    expect([...tables.keys()]).toContain("contacts");
    expect([...tables.keys()]).toContain("api_keys");
    expect([...tables.keys()]).toContain("quick_replies");
  });

  it("guards account-scoped data during invitation redemption", () => {
    const missing = [...accountScopedTables()]
      .filter(([table, restrictsDeletion]) => !tablesWithoutDomainData.has(table) && !restrictsDeletion)
      .map(([table]) => table)
      .filter((table) => !new RegExp(`from\\s+${table}\\s+where\\s+account_id\\s*=\\s*v_old_account_id`, "i").test(body));
    expect(missing).toEqual([]);
  });

  it("refuses when the old account has other members", () => {
    expect(body).toMatch(/from\s+profiles\s+where\s+account_id\s*=\s*v_old_account_id\s+and\s+user_id\s*<>\s*v_caller_id/i);
  });
});

describe("member RPC migrations", () => {
  it.each(["set_member_role", "remove_account_member", "transfer_account_ownership"])(
    "%s locks the caller and target profiles in user_id order",
    (functionName) => {
      expect(latestFunctionBody(functionName)).toMatch(
        /from\s+profiles\s+where\s+user_id\s+in\s*\(\s*auth\.uid\(\),\s*p_\w+\s*\)\s+order\s+by\s+user_id\s+for\s+update/i,
      );
    },
  );
});
