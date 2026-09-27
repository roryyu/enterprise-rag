import jwt from "jsonwebtoken";
import { NextRequest, NextResponse } from "next/server";

const JWT_SECRET = process.env.JWT_SECRET || "your-secret-key-change-in-production";
const JWT_ALGORITHM = "HS256";
const JWT_EXPIRES_IN = "24h";

export interface JWTPayload {
  userId: string;
  department: string;
  roles: string[];
  permissions: Record<string, boolean>;
  iat?: number;
  exp?: number;
}

/**
 * 生成 JWT token
 */
export function generateJWT(payload: Omit<JWTPayload, "iat" | "exp">): string {
  return jwt.sign(payload, JWT_SECRET, {
    algorithm: JWT_ALGORITHM,
    expiresIn: JWT_EXPIRES_IN,
  });
}

/**
 * 验证 JWT token
 */
export function verifyJWT(token: string): JWTPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET, {
      algorithms: [JWT_ALGORITHM],
    }) as JWTPayload;
  } catch (error) {
    console.error("JWT verification failed:", error);
    return null;
  }
}

/**
 * 从请求中提取 JWT token
 */
export function getJWTFromRequest(request: NextRequest): string | null {
  const authHeader = request.headers.get("authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return null;
  }
  return authHeader.substring(7);
}

/**
 * 从请求中获取用户身份信息
 */
export function getUserFromRequest(request: NextRequest): JWTPayload | null {
  const token = getJWTFromRequest(request);
  if (!token) {
    return null;
  }
  
  const payload = verifyJWT(token);
  if (!payload) {
    return null;
  }
  
  return payload;
}

/**
 * 创建认证中间件
 */
export function withAuth(handler: (request: NextRequest, user: JWTPayload) => Promise<NextResponse>) {
  return async (request: NextRequest): Promise<NextResponse> => {
    const user = getUserFromRequest(request);
    if (!user) {
      return NextResponse.json(
        { error: "Unauthorized: Invalid or missing token" },
        { status: 401 }
      );
    }
    
    return handler(request, user);
  };
}

/**
 * 创建权限检查中间件
 */
export function withPermission(
  requiredPermission: string,
  handler: (request: NextRequest, user: JWTPayload) => Promise<NextResponse>
) {
  return withAuth(async (request, user) => {
    // 检查用户是否有所需权限
    const hasPermission = user.permissions[requiredPermission] || false;
    
    if (!hasPermission) {
      return NextResponse.json(
        { error: "Forbidden: Insufficient permissions" },
        { status: 403 }
      );
    }
    
    return handler(request, user);
  });
}

/**
 * 创建部门权限检查中间件
 */
export function withDepartmentAccess(
  handler: (request: NextRequest, user: JWTPayload) => Promise<NextResponse>
) {
  return withAuth(async (request, user) => {
    // 从请求头获取目标部门（用于创建知识库等操作）
    const targetDepartment = request.headers.get("x-target-department");
    
    // 如果请求指定了目标部门，检查用户是否有权限访问该部门
    if (targetDepartment && targetDepartment !== user.department) {
      // 检查用户是否有跨部门权限
      if (!user.permissions["cross_department"]) {
        return NextResponse.json(
          { error: "Forbidden: Cannot access other department resources" },
          { status: 403 }
        );
      }
    }
    
    return handler(request, user);
  });
}

/**
 * 解析 JWT token 并返回用户信息
 */
export async function parseUserFromToken(token: string): Promise<JWTPayload | null> {
  try {
    return jwt.verify(token, JWT_SECRET, {
      algorithms: [JWT_ALGORITHM],
    }) as JWTPayload;
  } catch (error) {
    console.error("Token parsing failed:", error);
    return null;
  }
}

/**
 * 刷新 JWT token
 */
export function refreshJWT(token: string): string | null {
  try {
    const payload = jwt.verify(token, JWT_SECRET, {
      algorithms: [JWT_ALGORITHM],
    }) as JWTPayload;
    
    // 检查 token 是否即将过期（剩余时间少于1小时）
    const now = Math.floor(Date.now() / 1000);
    const timeUntilExpiry = (payload.exp || 0) - now;
    
    if (timeUntilExpiry < 3600) {
      // 生成新的 token，保持原有用户信息
      const newPayload = {
        userId: payload.userId,
        department: payload.department,
        roles: payload.roles,
        permissions: payload.permissions,
      };
      
      return generateJWT(newPayload);
    }
    
    return null; // token 仍然有效，不需要刷新
  } catch (error) {
    console.error("Token refresh failed:", error);
    return null;
  }
}