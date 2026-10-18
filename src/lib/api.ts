import { cookies } from "next/headers";
import type { NextRequest } from "next/server";
import { query } from "@/lib/db";
import { SESSION_COOKIE, sessionTokenHash } from "@/lib/security";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code = "request_error",
  ) {
    super(message);
  }
}

export type SessionUser = { id: string; phone: string; sessionId: string; branchId: string | null };
export type BranchScope = SessionUser & { branchId: string; businessId: string };

export function json(data: unknown, status = 200, headers?: HeadersInit): Response {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store", ...headers } });
}

export function fail(error: unknown): Response {
  const requestId = crypto.randomUUID();
  if (error instanceof ApiError)
    return json({ error: error.message, code: error.code, requestId }, error.status);
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String(error.code)
      : "internal";
  console.error(JSON.stringify({ requestId, event: "api_failure", code }));
  return json(
    { error: "در انجام درخواست مشکلی پیش آمد. دوباره تلاش کنید.", code: "internal", requestId },
    500,
  );
}

export function requireSameOrigin(request: Request): void {
  const originHeader = request.headers.get("origin");
  const host = request.headers.get("host");
  if (!originHeader || !host) throw new ApiError(403, "درخواست معتبر نیست.", "csrf");
  try {
    const origin = new URL(originHeader);
    const forwardedProtocol = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
    const requestProtocol = forwardedProtocol
      ? `${forwardedProtocol}:`
      : new URL(request.url).protocol;
    if (origin.host.toLowerCase() !== host.toLowerCase() || origin.protocol !== requestProtocol) {
      throw new ApiError(403, "درخواست معتبر نیست.", "csrf");
    }
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(403, "درخواست معتبر نیست.", "csrf");
  }
}

export async function readJson<T = Record<string, unknown>>(request: Request): Promise<T> {
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > 1_000_000) throw new ApiError(413, "حجم درخواست بیش از حد مجاز است.", "too_large");
  try {
    return (await request.json()) as T;
  } catch {
    throw new ApiError(400, "بدنهٔ درخواست معتبر نیست.", "invalid_json");
  }
}

export async function getSessionUser(request?: Request): Promise<SessionUser | null> {
  const cookieStore = request ? null : await cookies();
  const cookieHeader = request?.headers.get("cookie") ?? "";
  const rawCookie =
    cookieStore?.get(SESSION_COOKIE)?.value ??
    cookieHeader
      .split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${SESSION_COOKIE}=`))
      ?.slice(SESSION_COOKIE.length + 1);
  if (!rawCookie || rawCookie.length > 100) return null;
  const result = await query<{
    session_id: string;
    user_id: string;
    phone_e164: string;
    active_branch_id: string | null;
  }>(
    `SELECT s.id AS session_id, u.id AS user_id, u.phone_e164, s.active_branch_id
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = $1 AND s.expires_at > now()`,
    [sessionTokenHash(rawCookie)],
  );
  if (!result.rowCount) return null;
  const row = result.rows[0];
  void query("UPDATE sessions SET last_seen_at = now() WHERE id = $1", [row.session_id]).catch(
    () => undefined,
  );
  return {
    id: row.user_id,
    phone: row.phone_e164,
    sessionId: row.session_id,
    branchId: row.active_branch_id,
  };
}

export async function requireUser(request: Request): Promise<SessionUser> {
  const user = await getSessionUser(request);
  if (!user) throw new ApiError(401, "برای ادامه وارد حساب شوید.", "unauthorized");
  return user;
}

export async function requireBranch(request: Request): Promise<BranchScope> {
  const user = await requireUser(request);
  const result = await query<{ business_id: string }>(
    `SELECT b.business_id
     FROM branches b
     JOIN business_memberships m ON m.business_id = b.business_id AND m.user_id = $1
     WHERE b.id = $2 AND b.is_active = true`,
    [user.id, user.branchId],
  );
  if (!result.rowCount)
    throw new ApiError(409, "ابتدا یک کسب‌وکار و شعبهٔ فعال انتخاب کنید.", "no_active_branch");
  return { ...user, branchId: user.branchId as string, businessId: result.rows[0].business_id };
}

export function clientIpKey(request: NextRequest | Request): string {
  const ip =
    request.headers.get("x-real-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown";
  return ip.slice(0, 100);
}

export function safePhone(phone: string): string {
  return `${phone.slice(0, 6)}••••${phone.slice(-2)}`;
}
