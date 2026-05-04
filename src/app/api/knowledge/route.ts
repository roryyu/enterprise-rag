import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { knowledgeBases, kbPermissions } from '@/lib/db/schema';
import { getDepartmentFromRequest } from '@/lib/auth/permissions';
import { eq } from 'drizzle-orm';

// GET: list knowledge bases accessible to the requesting department
export async function GET(request: NextRequest) {
  const department = getDepartmentFromRequest(request);

  const accessibleKbs = await db
    .select({
      id: knowledgeBases.id,
      name: knowledgeBases.name,
      department: knowledgeBases.department,
      canRead: kbPermissions.canRead,
      canWrite: kbPermissions.canWrite,
    })
    .from(knowledgeBases)
    .innerJoin(kbPermissions, eq(knowledgeBases.id, kbPermissions.kbId))
    .where(eq(kbPermissions.department, department));

  return NextResponse.json({ knowledgeBases: accessibleKbs });
}

// POST: create a new knowledge base
export async function POST(request: NextRequest) {
  const body = await request.json();
  const { name } = body as { name?: string };
  const department = getDepartmentFromRequest(request);

  if (!name || !department) {
    return NextResponse.json({ error: 'name and department are required' }, { status: 400 });
  }

  const [kb] = await db.insert(knowledgeBases).values({ name, department }).returning();

  // Grant full permissions to the creating department
  await db.insert(kbPermissions).values({
    kbId: kb!.id,
    department,
    canRead: true,
    canWrite: true,
  });

  return NextResponse.json(kb, { status: 201 });
}
