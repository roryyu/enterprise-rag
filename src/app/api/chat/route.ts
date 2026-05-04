import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { conversations, messages } from '@/lib/db/schema';
import { hybridSearch } from '@/lib/retrieval/hybrid';
import { streamChat } from '@/lib/llm/client';
import { checkRateLimit } from '@/lib/rate-limit';
import { getDepartmentFromRequest } from '@/lib/auth/permissions';
import { eq, desc } from 'drizzle-orm';

const RATE_LIMIT_MAX = parseInt(process.env.RATE_LIMIT_MAX || '10', 10);
const RATE_LIMIT_WINDOW_MS = parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10);

function getClientIp(request: NextRequest): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0]!.trim();
  return request.headers.get('x-real-ip') || 'unknown';
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { query, conversationId } = body as {
    query?: string;
    conversationId?: string;
  };

  if (!query || typeof query !== 'string' || query.trim().length === 0) {
    return new Response(JSON.stringify({ error: 'query is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const department = getDepartmentFromRequest(request);
  if (!department || department.length === 0 || department.length > 50) {
    return new Response(JSON.stringify({ error: 'department header invalid' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Rate limiting by IP + department (prevents bypass by changing department)
  const clientIp = getClientIp(request);
  const rateLimitKey = `chat:${clientIp}:${department}`;
  const rateLimit = checkRateLimit(rateLimitKey, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS);
  if (!rateLimit.allowed) {
    return new Response(JSON.stringify({ error: 'Rate limit exceeded' }), {
      status: 429,
      headers: {
        'Content-Type': 'application/json',
        'X-RateLimit-Remaining': '0',
        'X-RateLimit-Reset': String(Math.ceil(rateLimit.resetTime / 1000)),
      },
    });
  }

  // Hybrid search with permission filtering
  const { results: searchResults } = await hybridSearch(query, department);

  // Early return if no relevant documents found
  if (searchResults.length === 0) {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ type: 'content', content: '未找到相关资料，请尝试更换关键词或上传相关文档。' }) }\n\n`
          )
        );
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ type: 'done', conversationId: convId }) }\n\n`)
        );
        controller.close();
      },
    });
    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    });
  }

  // Load conversation history
  let convId = conversationId;
  let history: { role: 'user' | 'assistant'; content: string }[] = [];

  if (convId) {
    const dbMessages = await db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, convId))
      .orderBy(desc(messages.createdAt))
      .limit(10);
    history = dbMessages
      .reverse()
      .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));
  } else {
    const [conv] = await db
      .insert(conversations)
      .values({ userId: 'anonymous', department, title: query.slice(0, 50) })
      .returning();
    convId = conv!.id;
  }

  // Save user message
  await db.insert(messages).values({
    conversationId: convId,
    role: 'user',
    content: query,
  });

  // Stream response
  const encoder = new TextEncoder();
  let fullContent = '';

  const stream = new ReadableStream({
    async start(controller) {
      try {
        // Yield search results metadata first
        if (searchResults.length > 0) {
          const sources = searchResults.map((r) => ({
            docName: r.docName,
            page: r.pageNum,
            section: r.sectionTitle,
          }));
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ type: 'sources', sources })}\n\n`)
          );
        }

        // Stream LLM response
        for await (const chunk of streamChat(query, searchResults, history)) {
          fullContent += chunk;
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ type: 'content', content: chunk })}\n\n`)
          );
        }

        // Save assistant message
        await db.insert(messages).values({
          conversationId: convId!,
          role: 'assistant',
          content: fullContent,
          sources: searchResults.map((r) => ({
            chunkId: r.chunkId,
            docName: r.docName,
            page: r.pageNum,
            section: r.sectionTitle,
          })),
        });

        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ type: 'done', conversationId: convId })}\n\n`
          )
        );
        controller.close();
      } catch (error) {
        console.error('Chat stream error:', error);
        controller.error(error);
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
