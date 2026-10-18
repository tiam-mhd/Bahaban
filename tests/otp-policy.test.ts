import assert from "node:assert/strict";
import test from "node:test";
import {
  canResend,
  challengeIsActive,
  nextFailedAttempts,
  OTP_MAX_ATTEMPTS,
  OTP_RESEND_COOLDOWN_MS,
  OTP_TTL_MS,
} from "@/lib/otp-policy";

test("OTP expires after five minutes and a consumed code cannot be reused", () => {
  const now = Date.UTC(2026, 0, 1);
  const base = { expiresAt: new Date(now + OTP_TTL_MS), consumedAt: null, attempts: 0 };
  assert.equal(challengeIsActive(base, now), true);
  assert.equal(challengeIsActive(base, now + OTP_TTL_MS), false);
  assert.equal(challengeIsActive({ ...base, consumedAt: new Date(now) }, now), false);
});

test("OTP locks after five wrong attempts", () => {
  assert.deepEqual(nextFailedAttempts(0), { attempts: 1, consume: false });
  assert.deepEqual(nextFailedAttempts(OTP_MAX_ATTEMPTS - 1), {
    attempts: OTP_MAX_ATTEMPTS,
    consume: true,
  });
  assert.equal(
    challengeIsActive(
      { expiresAt: new Date(Date.now() + 60_000), consumedAt: null, attempts: OTP_MAX_ATTEMPTS },
      Date.now(),
    ),
    false,
  );
});

test("OTP resend cooldown is one minute", () => {
  const now = Date.UTC(2026, 0, 1);
  assert.equal(canResend(null, now), true);
  assert.equal(canResend(new Date(now - OTP_RESEND_COOLDOWN_MS + 1), now), false);
  assert.equal(canResend(new Date(now - OTP_RESEND_COOLDOWN_MS), now), true);
});
