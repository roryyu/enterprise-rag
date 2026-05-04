import { describe, it, expect } from 'vitest';
import { extractKeywords } from './embedder';

describe('extractKeywords', () => {
  it('extracts Chinese keywords', () => {
    const text = '企业知识库系统是一个智能问答平台';
    const keywords = extractKeywords(text);
    expect(keywords).toContain('企业');
    expect(keywords).toContain('知识库');
    expect(keywords).toContain('系统');
    expect(keywords).toContain('智能');
    expect(keywords).toContain('问答');
    expect(keywords).toContain('平台');
  });

  it('filters out single-character tokens', () => {
    const text = '这是一个测试';
    const keywords = extractKeywords(text);
    expect(keywords).not.toContain('是');
    // Note: simple sliding-window extraction produces all 2-4 char combinations
    // including common ones like "一个". For production, integrate nodejieba.
  });

  it('filters out tokens longer than 20 chars', () => {
    const text = 'a'.repeat(25);
    const keywords = extractKeywords(text);
    expect(keywords).toHaveLength(0);
  });

  it('deduplicates tokens', () => {
    const text = '测试测试测试';
    const keywords = extractKeywords(text);
    expect(keywords.filter((k) => k === '测试')).toHaveLength(1);
  });

  it('handles punctuation correctly', () => {
    const text = '你好，世界！这是测试；来验证：功能。';
    const keywords = extractKeywords(text);
    expect(keywords).toContain('你好');
    expect(keywords).toContain('世界');
    expect(keywords).toContain('测试');
    expect(keywords).toContain('验证');
    expect(keywords).toContain('功能');
  });

  it('returns empty array for empty string', () => {
    expect(extractKeywords('')).toHaveLength(0);
  });
});
