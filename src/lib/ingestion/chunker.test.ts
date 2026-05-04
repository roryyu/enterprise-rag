import { describe, it, expect } from 'vitest';
import { chunkDocument } from './chunker';

describe('chunkDocument', () => {
  it('keeps short pages as single chunks', () => {
    const pages = [{ pageNum: 1, content: 'Short content' }];
    const chunks = chunkDocument(pages, 100, 20);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.content).toBe('Short content');
    expect(chunks[0]!.pageNum).toBe(1);
    expect(chunks[0]!.chunkIndex).toBe(0);
  });

  it('splits long pages with overlap', () => {
    const content = 'a'.repeat(200);
    const pages = [{ pageNum: 1, content }];
    const chunks = chunkDocument(pages, 100, 20);
    expect(chunks.length).toBeGreaterThan(1);
    // First chunk should be 100 chars
    expect(chunks[0]!.content.length).toBe(100);
    // Second chunk should overlap with first
    expect(chunks[1]!.content.startsWith('a')).toBe(true);
  });

  it('throws when overlap >= chunkSize', () => {
    const pages = [{ pageNum: 1, content: 'test' }];
    expect(() => chunkDocument(pages, 100, 100)).toThrow('overlap must be less than chunkSize');
    expect(() => chunkDocument(pages, 100, 101)).toThrow('overlap must be less than chunkSize');
  });

  it('extracts markdown headings as section titles', () => {
    const pages = [{ pageNum: 1, content: '# Introduction\nThis is the intro.' }];
    const chunks = chunkDocument(pages, 500, 100);
    expect(chunks[0]!.sectionTitle).toBe('Introduction');
  });

  it('handles multiple pages', () => {
    const pages = [
      { pageNum: 1, content: 'Page one content' },
      { pageNum: 2, content: 'Page two content' },
    ];
    const chunks = chunkDocument(pages, 100, 20);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]!.pageNum).toBe(1);
    expect(chunks[1]!.pageNum).toBe(2);
    expect(chunks[1]!.chunkIndex).toBe(1);
  });

  it('returns empty array for empty pages', () => {
    const chunks = chunkDocument([], 100, 20);
    expect(chunks).toHaveLength(0);
  });
});
