import { ApiError } from "@/lib/api";
import { newOtpCode } from "@/lib/security";

export type OtpDelivery = { code: string; developmentCode?: string };
export type OtpProvider = { send(phoneE164: string): Promise<OtpDelivery> };

export class DevelopmentMockOtpProvider implements OtpProvider {
  async send(): Promise<OtpDelivery> {
    if (process.env.NODE_ENV === "production")
      throw new Error("Mock OTP is disabled in production");
    const code = newOtpCode();
    return { code, developmentCode: code };
  }
}

export class ParsGreenOtpProvider implements OtpProvider {
  async send(phoneE164: string): Promise<OtpDelivery> {
    const token = process.env.PARSGREEN_TOKEN?.trim();
    if (!token) {
      throw new ApiError(503, "ورود پیامکی هنوز پیکربندی نشده است.", "otp_not_configured");
    }

    const code = newOtpCode();
    const mobile = `0${phoneE164.slice(3)}`;
    let response: Response;
    try {
      response = await fetch("https://login.parsgreen.com/Apiv2/Message/SendOtp", {
        method: "POST",
        headers: {
          Authorization: `basic apikey:${token}`,
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ Mobile: mobile, SmsCode: code, AddName: false }),
        signal: AbortSignal.timeout(8_000),
        cache: "no-store",
      });
    } catch {
      throw new ApiError(
        503,
        "ارسال کد ورود انجام نشد. کمی بعد دوباره تلاش کنید.",
        "otp_provider_error",
      );
    }
    if (!response.ok)
      throw new ApiError(
        503,
        "ارسال کد ورود انجام نشد. کمی بعد دوباره تلاش کنید.",
        "otp_provider_error",
      );
    let result: unknown;
    try {
      result = await response.json();
    } catch {
      throw new ApiError(
        503,
        "ارسال کد ورود انجام نشد. کمی بعد دوباره تلاش کنید.",
        "otp_provider_error",
      );
    }
    if (
      !result ||
      typeof result !== "object" ||
      !("R_Success" in result) ||
      result.R_Success !== true
    )
      throw new ApiError(
        503,
        "ارسال کد ورود انجام نشد. کمی بعد دوباره تلاش کنید.",
        "otp_provider_error",
      );
    return { code };
  }
}

export function otpProvider(): OtpProvider {
  const mode =
    process.env.OTP_PROVIDER ?? (process.env.NODE_ENV === "production" ? "parsgreen" : "mock");
  if (mode === "mock" && process.env.NODE_ENV !== "production")
    return new DevelopmentMockOtpProvider();
  if (mode === "parsgreen") return new ParsGreenOtpProvider();
  throw new ApiError(503, "روش ورود پیامکی در دسترس نیست.", "otp_not_configured");
}
