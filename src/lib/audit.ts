import type { PoolClient } from "pg";

export async function recordAudit(
  client: PoolClient,
  event: {
    businessId: string;
    branchId: string;
    actorId: string;
    eventType: string;
    entityType: string;
    entityId?: string | null;
    details?: Record<string, unknown>;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO audit_events(business_id, branch_id, actor_id, event_type, entity_type, entity_id, details)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
    [
      event.businessId,
      event.branchId,
      event.actorId,
      event.eventType,
      event.entityType,
      event.entityId ?? null,
      JSON.stringify(event.details ?? {}),
    ],
  );
}
