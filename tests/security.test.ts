import assert from "node:assert/strict";
import test from "node:test";
import { constantTimeEqual, otpHash, sessionCookie, sessionTokenHash } from "@/lib/security";
import { DevelopmentMockOtpProvider, otpProvider, ParsGreenOtpProvider } from "@/lib/otp";

function setEnv(name: string, value: string | undefined) {
  if (value === undefined) Reflect.deleteProperty(process.env, name);
  else process.env[name] = value;
}

test("OTP digests are keyed, deterministic and compared without plain text storage", () => {
  const oldSecret = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = "test-only-session-secret-with-more-than-32-characters";
  try {
    const first = otpHash("challenge-a", "123456");
    assert.equal(first, otpHash("challenge-a", "123456"));
    assert.notEqual(first, otpHash("challenge-b", "123456"));
    assert.notEqual(first, otpHash("challenge-a", "123457"));
    assert.equal(constantTimeEqual(first, first), true);
    assert.equal(constantTimeEqual(first, otpHash("challenge-a", "000000")), false);
  } finally {
    if (oldSecret === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = oldSecret;
  }
});

test("session tokens are stored as keyed digests and cookies are HttpOnly", () => {
  const oldSecret = process.env.SESSION_SECRET;
  const oldNodeEnv = process.env.NODE_ENV;
  process.env.SESSION_SECRET = "test-only-session-secret-with-more-than-32-characters";
  setEnv("NODE_ENV", "production");
  try {
    const digest = sessionTokenHash("random-session-token");
    assert.notEqual(digest, "random-session-token");
    const cookie = sessionCookie("random-session-token");
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Lax/);
    assert.match(cookie, /Secure/);
  } finally {
    if (oldSecret === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = oldSecret;
    setEnv("NODE_ENV", oldNodeEnv);
  }
});

test("development mock produces short-lived numeric codes, production rejects mock", async () => {
  const oldNodeEnv = process.env.NODE_ENV;
  const oldProvider = process.env.OTP_PROVIDER;
  setEnv("NODE_ENV", "development");
  try {
    const sent = await new DevelopmentMockOtpProvider().send();
    assert.match(sent.code, /^\d{6}$/);
    assert.equal(sent.developmentCode, sent.code);
    setEnv("NODE_ENV", "production");
    process.env.OTP_PROVIDER = "mock";
    assert.throws(() => otpProvider(), /در دسترس نیست/);
  } finally {
    setEnv("NODE_ENV", oldNodeEnv);
    if (oldProvider === undefined) delete process.env.OTP_PROVIDER;
    else process.env.OTP_PROVIDER = oldProvider;
  }
});

test("production ParsGreen provider fails closed when its token is absent", async () => {
  const previous = {
    NODE_ENV: process.env.NODE_ENV,
    PARSGREEN_TOKEN: process.env.PARSGREEN_TOKEN,
  };
  setEnv("NODE_ENV", "production");
  for (const key of Object.keys(previous).filter((key) => key.startsWith("PARSGREEN_")))
    delete process.env[key];
  try {
    await assert.rejects(new ParsGreenOtpProvider().send("+989121234567"), /پیکربندی نشده/);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      setEnv(key, value);
    }
  }
});

test("ParsGreen REST OTP uses the account token and documented JSON body", async () => {
  const oldNodeEnv = process.env.NODE_ENV;
  const oldToken = process.env.PARSGREEN_TOKEN;
  const oldFetch = globalThis.fetch;
  let requestedUrl = "";
  let requestedInit: RequestInit | undefined;
  setEnv("NODE_ENV", "production");
  setEnv("PARSGREEN_TOKEN", "test-only-parsgreen-token");
  globalThis.fetch = (async (input, init) => {
    requestedUrl = String(input);
    requestedInit = init;
    return new Response(
      JSON.stringify({ R_Success: true, R_Code: 0, R_Error: "", R_Message: "ok" }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }) as typeof fetch;

  try {
    const delivery = await new ParsGreenOtpProvider().send("+989121234567");
    assert.equal(requestedUrl, "https://login.parsgreen.com/Apiv2/Message/SendOtp");
    assert.equal(
      new Headers(requestedInit?.headers).get("Authorization"),
      "basic apikey:test-only-parsgreen-token",
    );
    const body = JSON.parse(String(requestedInit?.body)) as Record<string, unknown>;
    assert.deepEqual(Object.keys(body).sort(), ["AddName", "Mobile", "SmsCode"]);
    assert.equal(body.Mobile, "09121234567");
    assert.equal(body.SmsCode, delivery.code);
    assert.match(delivery.code, /^\d{6}$/);
    assert.equal(body.AddName, false);
  } finally {
    globalThis.fetch = oldFetch;
    setEnv("NODE_ENV", oldNodeEnv);
    setEnv("PARSGREEN_TOKEN", oldToken);
  }
});
