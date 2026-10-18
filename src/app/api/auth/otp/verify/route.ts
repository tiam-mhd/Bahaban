import type { NextRequest } from "next/server";
import { ApiError, clientIpKey, fail, json, readJson, requireSameOrigin } from "@/lib/api";
import { transaction, query } from "@/lib/db";
import { normalizeIranianMobile, normalizeDigits } from "@/lib/domain";
import { challengeIsActive, nextFailedAttempts } from "@/lib/otp-policy";
import {
  constantTimeEqual,
  newSessionToken,
  otpHash,
  requestKeyHash,
  sessionCookie,
  sessionExpiry,
  sessionTokenHash,
} from "@/lib/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function rateLimit(scope: string, key: string, max: number, seconds: number): Promise<void> {
  const keyHash = requestKeyHash(key);
  const result = await query<{ request_count: number }>(
    `INSERT INTO rate_limits(scope, key_hash, window_started_at, request_count)
     VALUES ($1, $2, to_timestamp(floor(extract(epoch FROM now()) / $3) * $3), 1)
     ON CONFLICT (scope, key_hash) DO UPDATE SET
       request_count = CASE WHEN rate_limits.window_started_at < EXCLUDED.window_started_at THEN 1 ELSE rate_limits.request_count + 1 END,
       window_started_at = GREATEST(rate_limits.window_started_at, EXCLUDED.window_started_at)
     RETURNING request_count`,
    [scope, keyHash, seconds],
  );
  if (result.rows[0].request_count > max)
    throw new ApiError(429, "تعداد تلاش‌ها زیاد است. کمی بعد دوباره تلاش کنید.", "rate_limited");
}

export async function POST(request: NextRequest) {
  try {
    requireSameOrigin(request);
    const body = await readJson<{ phone?: unknown; code?: unknown }>(request);
    if (typeof body.phone !== "string" || typeof body.code !== "string") {
      throw new ApiError(400, "شمارهٔ موبایل و کد را کامل کنید.", "invalid_code");
    }
    let phone: string;
    try {
      phone = normalizeIranianMobile(body.phone);
    } catch {
      throw new ApiError(400, "کد ورود معتبر نیست یا زمان آن تمام شده است.", "invalid_code");
    }
    const code = normalizeDigits(body.code).trim();
    if (!/^\d{4,8}$/.test(code))
      throw new ApiError(400, "کد ورود معتبر نیست یا زمان آن تمام شده است.", "invalid_code");
    await rateLimit("otp_verify_phone", phone, 10, 15 * 60);
    await rateLimit("otp_verify_ip", clientIpKey(request), 30, 15 * 60);

    const token = newSessionToken();
    const tokenHash = sessionTokenHash(token);
    const valid = await transaction(async (client) => {
      const challengeResult = await client.query<{
        id: string;
        code_hash: string;
        attempts: number;
        expires_at: Date;
        consumed_at: Date | null;
      }>(
        `SELECT id, code_hash, attempts, expires_at, consumed_at FROM otp_challenges
         WHERE phone_e164 = $1 AND consumed_at IS NULL
         ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
        [phone],
      );
      const challenge = challengeResult.rows[0];
      if (
        !challenge ||
        !challengeIsActive({
          expiresAt: challenge.expires_at,
          consumedAt: challenge.consumed_at,
          attempts: challenge.attempts,
        })
      ) {
        if (challenge)
          await client.query("UPDATE otp_challenges SET consumed_at = now() WHERE id = $1", [
            challenge.id,
          ]);
        return false;
      }
      if (!constantTimeEqual(challenge.code_hash, otpHash(challenge.id, code))) {
        const failed = nextFailedAttempts(challenge.attempts);
        await client.query(
          `UPDATE otp_challenges SET attempts = $1,
             consumed_at = CASE WHEN $2 THEN now() ELSE consumed_at END
           WHERE id = $3`,
          [failed.attempts, failed.consume, challenge.id],
        );
        return false;
      }
      await client.query("UPDATE otp_challenges SET consumed_at = now() WHERE id = $1", [
        challenge.id,
      ]);
      const userResult = await client.query<{ id: string }>(
        `INSERT INTO users(phone_e164) VALUES ($1)
         ON CONFLICT (phone_e164) DO UPDATE SET phone_e164 = EXCLUDED.phone_e164
         RETURNING id`,
        [phone],
      );
      const userId = userResult.rows[0].id;
      const branch = await client.query<{ id: string }>(
        `SELECT b.id FROM branches b JOIN business_memberships m ON m.business_id = b.business_id
         WHERE m.user_id = $1 AND b.is_primary AND b.is_active
         ORDER BY m.created_at LIMIT 1`,
        [userId],
      );
      await client.query(
        `INSERT INTO sessions(user_id, token_hash, active_branch_id, expires_at)
         VALUES ($1, $2, $3, $4)`,
        [userId, tokenHash, branch.rows[0]?.id ?? null, sessionExpiry()],
      );
      return true;
    });
    if (!valid)
      throw new ApiError(400, "کد ورود معتبر نیست یا زمان آن تمام شده است.", "invalid_code");
    return json({ authenticated: true }, 200, { "Set-Cookie": sessionCookie(token) });
  } catch (error) {
    return fail(error);
  }
}
