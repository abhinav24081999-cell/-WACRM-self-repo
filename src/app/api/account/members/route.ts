// ============================================================
// GET /api/account/members
//
// Lists every member of the caller's account. Any member can call
// it (the Members tab is shown to admins+, but agents/viewers see
// a read-only roster too).
//
// Field visibility
//   Sensitive fields (email) are returned only when the caller is
//   admin+. Agents and viewers see name + avatar + role + joined
//   date only. This mirrors the design decision from the planning
//   phase: "agent/viewer sees names only".
// ============================================================

import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";

import { getCurrentAccount, requireRole, toErrorResponse } from "@/lib/auth/account";
import { isSharedPreview } from "@/lib/auth/platform-admin";
import { canManageMembers, isAccountRole } from "@/lib/auth/roles";
import { supabaseAdmin } from "@/lib/flows/admin-client";
import { checkRateLimit, RATE_LIMITS, rateLimitResponse } from "@/lib/rate-limit";
import type { AccountMember } from "@/types";
import { getT } from "@/lib/i18n/translate";

const t = getT("Api");
const plans = getT("WorkspacePlans");
const access = getT("PlatformAccess");

interface ProfileRow {
  user_id: string;
  full_name: string | null;
  email: string | null;
  avatar_url: string | null;
  account_role: string;
  created_at: string;
}

export async function GET() {
  try {
    const ctx = await getCurrentAccount();

    // RLS on profiles allows reading any row whose account matches
    // the caller's, so this query is naturally account-scoped.
    const { data, error } = await ctx.supabase
      .from("profiles")
      .select("user_id, full_name, email, avatar_url, account_role, created_at")
      .eq("account_id", ctx.accountId)
      .order("created_at", { ascending: true });

    if (error) {
      console.error("[GET /api/account/members] fetch error:", error);
      return NextResponse.json(
        { error: t('account.members.loadFailed') },
        { status: 500 },
      );
    }

    const canSeeEmails = canManageMembers(ctx.role);

    const members: AccountMember[] = (data as ProfileRow[]).flatMap((row) => {
      // Defensive: the DB enum should never let an unknown role
      // through, but if a migration ever broadens the enum without
      // updating TS, skip the row rather than crash the page.
      if (!isAccountRole(row.account_role)) return [];
      return [
        {
          user_id: row.user_id,
          full_name: row.full_name ?? "",
          email: canSeeEmails ? row.email : null,
          avatar_url: row.avatar_url,
          role: row.account_role,
          joined_at: row.created_at,
        },
      ];
    });

    return NextResponse.json({ members, readOnly: isSharedPreview() });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireRole("admin");
    if (isSharedPreview()) return Response.json({ error: plans("preview") }, { status: 403 });
    const limit = checkRateLimit(`staff-provision:${ctx.userId}`, RATE_LIMITS.adminAction);
    if (!limit.success) return rateLimitResponse(limit);
    const contentType = request.headers.get("content-type")?.split(";")[0].trim();
    const body = contentType === "application/json" ? await request.json().catch(() => null) : null;
    const name = typeof body?.name === "string" ? body.name.trim() : "";
    const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
    if (!name || name.length > 100 || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      !isAccountRole(body?.role) || body.role === "owner") {
      return Response.json({ error: access("invalidCustomer") }, { status: 400 });
    }

    const service = supabaseAdmin();
    const { error: schemaError } = await service.from("workspace_staff_provisioning_log")
      .select("user_id", { head: true }).limit(1);
    if (schemaError) return Response.json({ error: access("setupRequired") }, { status: 503 });

    const password = `${randomBytes(24).toString("base64url")}aA1!`;
    const { error } = await service.auth.admin.createUser({
      email, password, email_confirm: true, user_metadata: { full_name: name },
      app_metadata: { wacrm_staff_assignment: { account_id: ctx.accountId, actor_id: ctx.userId, role: body.role } },
    });
    if (error?.code === "email_exists" || error?.code === "user_already_exists") {
      return Response.json({ error: access("emailExists") }, { status: 409 });
    }
    if (error) {
      console.error("[staff-provision] Auth rejected creation:", error.code);
      return Response.json({ error: plans("staffFailed") }, { status: 409 });
    }
    return Response.json({ email, password }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return toErrorResponse(error);
  }
}
