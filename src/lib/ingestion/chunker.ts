export interface ChunkInput {
  content: string;
  pageNum: number;
  sectionTitle?: string;
}

export interface Chunk {
  content: string;
  pageNum: number;
  sectionTitle: string;
  chunkIndex: number;
}

const DEFAULT_CHUNK_SIZE = 500;
const DEFAULT_OVERLAP = 100;

export function chunkDocument(
  pages: { pageNum: number; content: string }[],
  chunkSize: number = DEFAULT_CHUNK_SIZE,
  overlap: number = DEFAULT_OVERLAP
): Chunk[] {
  if (overlap >= chunkSize) {
    throw new Error('overlap must be less than chunkSize');
  }
  const chunks: Chunk[] = [];
  let chunkIndex = 0;

  for (const page of pages) {
    // If page content fits in one chunk, keep it whole
    if (page.content.length <= chunkSize) {
      chunks.push({
        content: page.content,
        pageNum: page.pageNum,
        sectionTitle: extractSectionTitle(page.content),
        chunkIndex: chunkIndex++,
      });
      continue;
    }

    // Split long pages with overlap
    let start = 0;
    while (start < page.content.length) {
      const end = Math.min(start + chunkSize, page.content.length);
      const content = page.content.slice(start, end);
      chunks.push({
        content,
        pageNum: page.pageNum,
        sectionTitle: start === 0 ? extractSectionTitle(page.content) : '',
        chunkIndex: chunkIndex++,
      });
      start += chunkSize - overlap;
      if (start >= page.content.length) break;
      // Avoid infinite loop when overlap >= chunkSize
      if (start <= end - chunkSize + overlap) {
        start = end;
      }
    }
  }

  return chunks;
}

function extractSectionTitle(content: string): string {
  // Match markdown heading
  const headingMatch = content.match(/^#{1,6}\s+(.+)/);
  if (headingMatch) return headingMatch[1]!.trim();

  // Use first line if short enough
  const firstLine = content.split('\n')[0]?.trim() || '';
  return firstLine.length <= 50 ? firstLine : '';
}
