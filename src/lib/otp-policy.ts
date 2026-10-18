export const OTP_TTL_MS = 5 * 60 * 1000;
export const OTP_RESEND_COOLDOWN_MS = 60 * 1000;
export const OTP_MAX_ATTEMPTS = 5;

export type ChallengeState = {
  expiresAt: Date | string;
  consumedAt: Date | string | null;
  attempts: number;
};

export function canResend(lastCreatedAt: Date | string | null, now = Date.now()): boolean {
  if (!lastCreatedAt) return true;
  return now - new Date(lastCreatedAt).getTime() >= OTP_RESEND_COOLDOWN_MS;
}

export function challengeIsActive(challenge: ChallengeState, now = Date.now()): boolean {
  return (
    challenge.consumedAt === null &&
    challenge.attempts < OTP_MAX_ATTEMPTS &&
    new Date(challenge.expiresAt).getTime() > now
  );
}

export function nextFailedAttempts(attempts: number): { attempts: number; consume: boolean } {
  const next = Math.min(OTP_MAX_ATTEMPTS, Math.max(0, attempts) + 1);
  return { attempts: next, consume: next >= OTP_MAX_ATTEMPTS };
}
