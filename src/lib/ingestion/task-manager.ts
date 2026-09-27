import { db } from "@/lib/db";
import { ingestionTasks, documents, chunks } from "@/lib/db/schema";
import { sql, eq, and, or, lt, isNull } from "drizzle-orm";
import { generateEmbeddings, extractKeywords } from "./embedder";
import { chunkDocument } from "./chunker";
import { parseFile } from "./parser";
import { readFile } from "fs/promises";

/**
 * 可靠异步入库任务管理（P0）
 *
 * 设计说明：
 * - 上传接口只创建 queued 任务并立即返回 202；处理在事件循环中异步执行，
 *   不依赖 API 请求生命周期（进程不退出即可跑完）。
 * - 任务进度/心跳/重试次数落 ingestion_tasks 表；进程重启后可由
 *   scanAndRetryTimeoutTasks() 扫描 processing 超时与 failed_retryable 任务恢复。
 * - 阶段：parse -> chunk -> embed -> persist（内存传递中间结果，不建临时表）。
 * - 写入采用“先删旧分块 + 事务插入 + 最后置 done”，保证重试幂等且不会读到半成品。
 */

const PARSER_VERSION = "1.0";
const EMBEDDING_DIMENSIONS = 1024;

type IngestionTaskRow = typeof ingestionTasks.$inferSelect;

/**
 * 创建摄入任务并异步触发执行（不阻塞上传响应）。
 * 同一文档存在未终结任务时复用，避免重复处理。
 */
export async function createIngestionTask(
  docId: string,
  filePath: string,
  fileType: string,
  contentHash: string,
  kbId: string,
  embeddingModel: string,
): Promise<string> {
  const existing = await db
    .select({ id: ingestionTasks.id })
    .from(ingestionTasks)
    .where(
      and(
        eq(ingestionTasks.docId, docId),
        eq(ingestionTasks.contentHash, contentHash),
        or(
          eq(ingestionTasks.status, "queued"),
          eq(ingestionTasks.status, "processing"),
          eq(ingestionTasks.status, "failed_retryable"),
        ),
      ),
    )
    .limit(1);

  if (existing.length > 0) {
    return existing[0]!.id;
  }

  const [task] = await db
    .insert(ingestionTasks)
    .values({
      docId,
      kbId,
      filePath,
      fileType,
      contentHash,
      embeddingModel,
      status: "queued",
      currentStep: "parse",
      maxRetries: parseInt(process.env.INGESTION_MAX_RETRIES || "3", 10),
    })
    .returning({ id: ingestionTasks.id });

  const taskId = task!.id;
  // 异步触发，不 await；异常已在 processIngestionTask 内部落库
  setImmediate(() => {
    void processIngestionTask(taskId);
  });

  return taskId;
}

/**
 * 执行单个摄入任务（含失败重试）。可被创建流程或超时扫描重复调用。
 */
export async function processIngestionTask(taskId: string): Promise<void> {
  const task = await getTask(taskId);
  if (!task) {
    console.error(`[TaskManager] task ${taskId} not found`);
    return;
  }
  if (task.status === "ready") return;

  try {
    await db
      .update(ingestionTasks)
      .set({
        status: "processing",
        startedAt: new Date(),
        lastHeartbeat: new Date(),
        lastError: null,
      })
      .where(eq(ingestionTasks.id, taskId));

    // 1) parse：读取并解析原文件
    await updateStep(taskId, "parse");
    const buffer = await readFile(task.filePath);
    const parsed = await parseFile(task.filePath, buffer, task.fileType);

    // 2) chunk：结构化为分块
    await updateStep(taskId, "chunk");
    const chunked = chunkDocument(parsed.pages).filter(
      (c) => c.content.trim().length > 0,
    );
    if (chunked.length === 0) {
      throw new Error("文档解析后没有可用文本内容（可能是扫描件或空文档）");
    }

    // 3) embed：批量生成向量与关键词
    await updateStep(taskId, "embed");
    const texts = chunked.map((c) => c.content);
    const embeddings = await generateEmbeddings(texts);
    const keywordLists = chunked.map((c) => extractKeywords(c.content));

    // 4) persist：事务替换旧分块，完成后文档才可见
    await updateStep(taskId, "persist");
    await db.transaction(async (tx) => {
      await tx.delete(chunks).where(eq(chunks.docId, task.docId));
      await tx.insert(chunks).values(
        chunked.map((chunk, i) => ({
          docId: task.docId,
          kbId: task.kbId,
          content: chunk.content,
          pageNum: chunk.pageNum,
          sectionTitle: chunk.sectionTitle || null,
          chunkIndex: chunk.chunkIndex,
          embedding: embeddings[i]!,
          keywords: keywordLists[i]!,
          embeddingModel: task.embeddingModel,
          embeddingVersion: 1,
          blockType: "paragraph",
        })),
      );
      // 全文检索向量（simple 配置，中文按词项切分，后续可接 zhparser）
      await tx.execute(
        sql`UPDATE chunks SET search_tsvector = to_tsvector('simple', content) WHERE doc_id = ${task.docId}`,
      );
      await tx
        .update(documents)
        .set({
          status: "done",
          updatedAt: new Date(),
          parserVersion: PARSER_VERSION,
          embeddingModel: task.embeddingModel,
          embeddingDimension: EMBEDDING_DIMENSIONS,
        })
        .where(eq(documents.id, task.docId));
    });

    await db
      .update(ingestionTasks)
      .set({
        status: "ready",
        currentStep: "publish",
        completedAt: new Date(),
        lastHeartbeat: new Date(),
      })
      .where(eq(ingestionTasks.id, taskId));

    console.log(
      `[TaskManager] document ${task.docId} indexed: ${chunked.length} chunks`,
    );
  } catch (error) {
    await handleFailure(taskId, error);
  }
}

async function getTask(taskId: string): Promise<IngestionTaskRow | null> {
  const rows = await db
    .select()
    .from(ingestionTasks)
    .where(eq(ingestionTasks.id, taskId))
    .limit(1);
  return rows[0] ?? null;
}

async function updateStep(taskId: string, step: string): Promise<void> {
  await db
    .update(ingestionTasks)
    .set({ currentStep: step, lastHeartbeat: new Date() })
    .where(eq(ingestionTasks.id, taskId));
}

async function handleFailure(taskId: string, error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[TaskManager] task ${taskId} failed:`, message);

  const task = await getTask(taskId);
  if (!task) return;

  const retryCount = (task.retryCount ?? 0) + 1;
  const maxRetries = task.maxRetries ?? 3;

  if (retryCount >= maxRetries) {
    await db
      .update(ingestionTasks)
      .set({
        status: "failed_permanent",
        retryCount,
        lastError: message,
        lastHeartbeat: new Date(),
      })
      .where(eq(ingestionTasks.id, taskId));
    await db
      .update(documents)
      .set({ status: "failed", updatedAt: new Date() })
      .where(eq(documents.id, task.docId));
    return;
  }

  await db
    .update(ingestionTasks)
    .set({
      status: "failed_retryable",
      retryCount,
      lastError: message,
      lastHeartbeat: new Date(),
    })
    .where(eq(ingestionTasks.id, taskId));

  // 指数退避后重试（1s, 2s, 4s ...）
  const delayMs = Math.pow(2, retryCount) * 1000;
  setTimeout(() => {
    void processIngestionTask(taskId);
  }, delayMs);
}

/**
 * 恢复机制：扫描 processing 心跳超时和 failed_retryable 任务重新执行。
 * 可由独立 worker / 定时任务 / 进程启动钩子调用。
 */
export async function scanAndRetryTimeoutTasks(): Promise<number> {
  const timeoutMs = parseInt(
    process.env.INGESTION_TASK_TIMEOUT_MS || "300000",
    10,
  );
  const cutoff = new Date(Date.now() - timeoutMs);

  const stale = await db
    .select({ id: ingestionTasks.id })
    .from(ingestionTasks)
    .where(
      or(
        and(
          eq(ingestionTasks.status, "processing"),
          lt(ingestionTasks.lastHeartbeat, cutoff),
          isNull(ingestionTasks.completedAt),
        ),
        eq(ingestionTasks.status, "failed_retryable"),
      ),
    );

  for (const row of stale) {
    void processIngestionTask(row.id);
  }
  return stale.length;
}
