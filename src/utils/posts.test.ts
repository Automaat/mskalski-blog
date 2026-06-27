import { describe, expect, it } from 'vitest';
import { excerptFromMarkdown, postPath } from './posts';

describe('post helpers', () => {
  it('keeps legacy post paths stable', () => {
    expect(postPath('timeouts')).toBe('/posts/timeouts/');
    expect(postPath('2020/05/xms_good_practice')).toBe('/posts/2020/05/xms_good_practice/');
  });

  it('extracts an excerpt from markdown body text', () => {
    const markdown = '# Heading\n\nThis is **body** text with [a link](https://example.com).\n\n```java\ncode\n```';

    expect(excerptFromMarkdown(markdown)).toBe('This is body text with a link.');
  });
});
