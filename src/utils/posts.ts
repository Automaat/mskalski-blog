import type { CollectionEntry } from 'astro:content';

export type PostEntry = CollectionEntry<'posts'>;

const postImageById: Record<string, string> = {
  timeouts: '/images/2019/12/grafana.png',
  '2020/05/xms_good_practice': '/images/2020/05/typowy_czas_w_gc.png',
};

export function postPath(id: string): string {
  return `/posts/${id}/`;
}

export function postImage(id: string): string {
  return postImageById[id] ?? '/images/avatar.jpg';
}

export function formatDate(date: Date): string {
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

export function sortPosts(posts: PostEntry[]): PostEntry[] {
  return [...posts].sort((a, b) => b.data.date.getTime() - a.data.date.getTime());
}

export function excerptFromMarkdown(markdown: string, maxLength = 190): string {
  const paragraph =
    markdown
      .replace(/```[\s\S]*?```/g, ' ')
      .split(/\n{2,}/)
      .map((part) => part.trim())
      .find((part) => part && !part.startsWith('#') && !part.startsWith('!')) ?? '';

  const text = paragraph
    .replace(/!\[[^\]]*]\([^)]+\)/g, ' ')
    .replace(/\[([^\]]+)]\([^)]+\)/g, '$1')
    .replace(/[`*_>#-]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength).trimEnd()}...`;
}

export function postExcerpt(post: PostEntry, maxLength = 190): string {
  return excerptFromMarkdown(post.body ?? '', maxLength);
}
