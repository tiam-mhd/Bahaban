import { fail, getSessionUser, json, safePhone } from "@/lib/api";
import { query } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type BusinessRow = {
  business_id: string;
  business_name: string;
  role: "owner" | "member";
  branches: { id: string; name: string; isPrimary: boolean }[];
};

export async function GET(request: Request) {
  try {
    const user = await getSessionUser(request);
    if (!user) return json({ authenticated: false });
    const result = await query<BusinessRow>(
      `SELECT b.id AS business_id, b.name AS business_name, m.role,
        COALESCE(json_agg(json_build_object('id', br.id, 'name', br.name, 'isPrimary', br.is_primary)
          ORDER BY br.is_primary DESC, br.created_at) FILTER (WHERE br.id IS NOT NULL), '[]'::json) AS branches
       FROM business_memberships m JOIN businesses b ON b.id = m.business_id
       LEFT JOIN branches br ON br.business_id = b.id AND br.is_active
       WHERE m.user_id = $1
       GROUP BY b.id, b.name, m.role ORDER BY b.created_at`,
      [user.id],
    );
    const businesses = result.rows.map((row) => ({
      id: row.business_id,
      name: row.business_name,
      role: row.role,
      branches: row.branches,
    }));
    const active =
      businesses
        .flatMap((business) =>
          business.branches.map((branch) => ({
            ...branch,
            businessId: business.id,
            businessName: business.name,
          })),
        )
        .find((branch) => branch.id === user.branchId) ?? null;
    return json({
      authenticated: true,
      user: { phone: safePhone(user.phone) },
      businesses,
      activeBranch: active,
    });
  } catch (error) {
    return fail(error);
  }
}
