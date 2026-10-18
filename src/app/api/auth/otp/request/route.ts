import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { ApiError, clientIpKey, fail, json, readJson, requireSameOrigin } from "@/lib/api";
import { query, transaction } from "@/lib/db";
import { normalizeIranianMobile } from "@/lib/domain";
import { canResend } from "@/lib/otp-policy";
import { otpProvider } from "@/lib/otp";
import { otpHash, requestKeyHash } from "@/lib/security";

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
    throw new ApiError(429, "تعداد درخواست‌ها زیاد است. کمی بعد دوباره تلاش کنید.", "rate_limited");
}

export async function POST(request: NextRequest) {
  try {
    requireSameOrigin(request);
    const body = await readJson<{ phone?: unknown }>(request);
    if (typeof body.phone !== "string")
      throw new ApiError(400, "شمارهٔ موبایل را وارد کنید.", "invalid_phone");
    let phone: string;
    try {
      phone = normalizeIranianMobile(body.phone);
    } catch {
      throw new ApiError(400, "شمارهٔ موبایل ایران معتبر نیست.", "invalid_phone");
    }
    const ip = clientIpKey(request);
    await rateLimit("otp_request_phone", phone, 5, 15 * 60);
    await rateLimit("otp_request_ip", ip, 20, 15 * 60);
    await rateLimit("otp_send_cooldown", phone, 1, 60);
    const lastChallenge = await query<{ created_at: Date }>(
      `SELECT created_at FROM otp_challenges WHERE phone_e164 = $1 AND created_at > now() - interval '60 seconds'
       ORDER BY created_at DESC LIMIT 1`,
      [phone],
    );
    if (lastChallenge.rowCount && !canResend(lastChallenge.rows[0].created_at)) {
      throw new ApiError(429, "برای ارسال دوبارهٔ کد، یک دقیقه صبر کنید.", "resend_cooldown");
    }

    const delivery = await otpProvider().send(phone);
    const id = randomUUID();
    await transaction(async (client) => {
      await client.query(
        "UPDATE otp_challenges SET consumed_at = now() WHERE phone_e164 = $1 AND consumed_at IS NULL",
        [phone],
      );
      await client.query(
        `INSERT INTO otp_challenges(id, phone_e164, code_hash, expires_at)
         VALUES ($1, $2, $3, now() + interval '5 minutes')`,
        [id, phone, otpHash(id, delivery.code)],
      );
    });
    return json(
      {
        message: "اگر شماره معتبر باشد، کد ورود ارسال می‌شود.",
        ...(process.env.NODE_ENV !== "production" && delivery.developmentCode
          ? { developmentCode: delivery.developmentCode }
          : {}),
      },
      202,
    );
  } catch (error) {
    return fail(error);
  }
}
