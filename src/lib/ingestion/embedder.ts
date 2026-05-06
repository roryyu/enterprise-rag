import OpenAI from "openai";

let openai: OpenAI | null = null;
function getOpenAI(): OpenAI {
  if (!openai) {
    openai = new OpenAI({
      apiKey:
        process.env.OPENAI_EMBEDDING_API_KEY || process.env.OPENAI_API_KEY,
      baseURL:
        process.env.OPENAI_EMBEDDING_BASEURL ||
        process.env.OPENAI_BASEURL ||
        undefined,
    });
  }
  return openai;
}

const EMBEDDING_MODEL =
  process.env.OPENAI_EMBEDDING_MODEL || "text-embedding-3-small";
const BATCH_SIZE = 10;

export async function generateEmbedding(text: string): Promise<number[]> {
  const response = await getOpenAI().embeddings.create({
    model: EMBEDDING_MODEL,
    input: text,
  });
  return response.data[0]!.embedding;
}

export async function generateEmbeddings(texts: string[]): Promise<number[][]> {
  const embeddings: number[][] = [];
  console.log("Generating embeddings for", texts.length, "texts");
  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    const response = await getOpenAI().embeddings.create({
      model: EMBEDDING_MODEL,
      input: batch,
      dimensions: 1024,
    });
    for (const item of response.data) {
      embeddings.push(item.embedding);
    }
    console.log("finished:" + i + "/" + texts.length);
  }

  return embeddings;
}

export function extractKeywords(text: string): string[] {
  const tokens: string[] = [];
  const cleaned = text.replace(
    /[，。！？、；：""''【】《》（）\[\]{},.!?;:'"()]/g,
    " ",
  );
  const rawTokens = cleaned.split(/\s+/).filter(Boolean);

  for (const token of rawTokens) {
    const hasChinese = /[\u4e00-\u9fff]/.test(token);
    // For Chinese text (no spaces), extract 2-4 character sliding windows
    if (hasChinese) {
      for (let i = 0; i < token.length - 1; i++) {
        for (let len = 2; len <= 4 && i + len <= token.length; len++) {
          const sub = token.slice(i, i + len);
          if (/[\u4e00-\u9fff]/.test(sub)) {
            tokens.push(sub);
          }
        }
      }
      continue;
    }
    // For non-Chinese tokens, use original logic
    if (token.length >= 2 && token.length <= 20) {
      tokens.push(token);
    }
  }

  // Deduplicate and limit
  const unique = [...new Set(tokens)];
  return unique.slice(0, 50);
}
