import { db } from '@/lib/db';
import { kbPermissions, conversations } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { verifyJWT } from './jwt';

/** JWT 认证身份信息 */
export interface AuthIdentity {
  userId: string;
  department: string;
  roles: string[];
  authMode: "jwt" | "dev-header";
}

/**
 * 从请求中提取身份信息
 * - AUTH_MODE=dev：允许从 x-user-department / x-user-id / x-user-roles 头读取（仅限开发）
 * - 默认（生产）：必须携带有效的 Authorization: Bearer <token>
 */
export async function getIdentityFromRequest(
  request: Request,
): Promise<AuthIdentity> {
  const authMode = process.env.AUTH_MODE || "production";

  if (authMode === "dev") {
    return {
      userId: request.headers.get("x-user-id") || "dev-user",
      department: request.headers.get("x-user-department") || "default",
      roles: (request.headers.get("x-user-roles") || "user")
        .split(",")
        .map((r) => r.trim())
        .filter(Boolean),
      authMode: "dev-header",
    };
  }

  const authHeader = request.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    throw new Error(
      "未提供有效的身份凭证，请携带 Authorization: Bearer <token> 头",
    );
  }

  const payload = verifyJWT(authHeader.slice(7).trim());
  if (!payload) {
    throw new Error("JWT 验证失败：token 无效或已过期");
  }

  return {
    userId: payload.userId,
    department: payload.department,
    roles: payload.roles ?? [],
    authMode: "jwt",
  };
}

/**
 * 向后兼容：从请求中获取部门
 */
export async function getDepartmentFromRequest(request: Request): Promise<string> {
  const identity = await getIdentityFromRequest(request);
  return identity.department;
}

/**
 * 检查部门是否拥有知识库的读/写权限（资源级鉴权）
 */
export async function checkPermission(
  kbId: string,
  department: string,
  access: "read" | "write",
): Promise<boolean> {
  const field =
    access === "read" ? kbPermissions.canRead : kbPermissions.canWrite;
  const result = await db
    .select({ id: kbPermissions.kbId })
    .from(kbPermissions)
    .where(
      and(
        eq(kbPermissions.kbId, kbId),
        eq(kbPermissions.department, department),
        eq(field, true),
      ),
    )
    .limit(1);

  return result.length > 0;
}

/**
 * 校验对话归属权：对话必须属于该用户
 */
export async function checkConversationOwnership(
  conversationId: string,
  userId: string,
): Promise<boolean> {
  const result = await db
    .select({ userId: conversations.userId })
    .from(conversations)
    .where(eq(conversations.id, conversationId))
    .limit(1);

  if (result.length === 0) return false;
  return result[0]!.userId === userId;
}
