import { fail, json, requireSameOrigin } from "@/lib/api";
import { query } from "@/lib/db";
import { clearSessionCookie, SESSION_COOKIE, sessionTokenHash } from "@/lib/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    const cookie = request.headers.get("cookie") ?? "";
    const token = cookie
      .split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${SESSION_COOKIE}=`))
      ?.slice(SESSION_COOKIE.length + 1);
    if (token) await query("DELETE FROM sessions WHERE token_hash = $1", [sessionTokenHash(token)]);
    return json({ signedOut: true }, 200, { "Set-Cookie": clearSessionCookie() });
  } catch (error) {
    return fail(error);
  }
}
