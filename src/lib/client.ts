export class ClientError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

export async function api<T>(url: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(url, { ...init, cache: "no-store", credentials: "same-origin" });
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  if (!response.ok) {
    const message =
      body && typeof body === "object" && "error" in body && typeof body.error === "string"
        ? body.error
        : "درخواست انجام نشد.";
    throw new ClientError(message, response.status);
  }
  return body as T;
}

export function jsonBody(value: unknown): RequestInit {
  return {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(value),
  };
}

export function money(value: string | bigint | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  return new Intl.NumberFormat("fa-IR").format(BigInt(value));
}

export function dateFa(
  value: string | Date | null | undefined,
  style: "short" | "long" = "short",
): string {
  if (!value) return "—";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "—";
  return new Intl.DateTimeFormat(
    "fa-IR-u-ca-persian",
    style === "long" ? { dateStyle: "medium", timeStyle: "short" } : { dateStyle: "medium" },
  ).format(date);
}

export function moneyForCurrency(rial: string | null, currency: "IRR" | "IRT"): string {
  if (rial === null) return "";
  const amount = BigInt(rial);
  return money(currency === "IRT" ? amount / 10n : amount);
}
