import { db } from '@/lib/db';
import { kbPermissions } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';

export async function checkPermission(
  kbId: string,
  department: string,
  access: 'read' | 'write'
): Promise<boolean> {
  const field = access === 'read' ? kbPermissions.canRead : kbPermissions.canWrite;
  const result = await db
    .select()
    .from(kbPermissions)
    .where(
      and(
        eq(kbPermissions.kbId, kbId),
        eq(kbPermissions.department, department),
        eq(field, true)
      )
    )
    .limit(1);

  return result.length > 0;
}

export function getDepartmentFromRequest(request: Request): string {
  return request.headers.get('x-user-department') || 'default';
}
