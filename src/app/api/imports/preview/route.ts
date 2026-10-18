import { ApiError, fail, json, requireSameOrigin, requireBranch, requireUser } from "@/lib/api";
import { query } from "@/lib/db";
import { MAX_UPLOAD_BYTES, parseUpload } from "@/lib/imports";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    const user = await requireUser(request);
    const scope = await requireBranch(request);
    const length = Number(request.headers.get("content-length") ?? 0);
    if (length > MAX_UPLOAD_BYTES + 300_000)
      throw new ApiError(413, "حجم درخواست بیش از حد مجاز است.", "upload_size");
    const form = await request.formData();
    const file = form.get("file");
    const kind = form.get("kind");
    if (!(file instanceof File) || (kind !== "products" && kind !== "price_list")) {
      throw new ApiError(400, "فایل یا نوع ورود معتبر نیست.", "invalid_import");
    }
    const parsed = await parseUpload(file);
    if (kind === "price_list") {
      const duplicate = await query(
        "SELECT 1 FROM price_lists WHERE branch_id = $1 AND source_hash = $2 LIMIT 1",
        [scope.branchId, parsed.fileHash],
      );
      if (duplicate.rowCount)
        throw new ApiError(409, "این فایل قبلاً در همین شعبه وارد شده است.", "duplicate_file");
    }
    await query("DELETE FROM import_drafts WHERE expires_at < now()");
    const count = await query<{ count: string }>(
      "SELECT count(*) FROM import_drafts WHERE user_id = $1 AND branch_id = $2",
      [user.id, scope.branchId],
    );
    if (Number(count.rows[0].count) >= 10)
      throw new ApiError(
        429,
        "۱۰ پیش‌نمایش ناتمام دارید. یکی را تمام کنید و دوباره تلاش کنید.",
        "too_many_drafts",
      );
    const draft = await query<{ id: string }>(
      `INSERT INTO import_drafts(branch_id, business_id, user_id, kind, file_name, file_hash, parsed_rows, headers, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,now() + interval '30 minutes') RETURNING id`,
      [
        scope.branchId,
        scope.businessId,
        user.id,
        kind,
        parsed.fileName,
        parsed.fileHash,
        JSON.stringify(parsed.rows),
        parsed.headers,
      ],
    );
    return json(
      {
        draftId: draft.rows[0].id,
        fileName: parsed.fileName,
        headers: parsed.headers,
        samples: parsed.rows.slice(0, 8),
        rowCount: parsed.rows.length,
        expiresInMinutes: 30,
      },
      201,
    );
  } catch (error) {
    return fail(error);
  }
}
