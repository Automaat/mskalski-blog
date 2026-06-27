import { getCollection } from 'astro:content';
import { postExcerpt, postPath, sortPosts } from '../utils/posts';

const escapeXml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

export async function GET({ site }: { site: URL }) {
  const posts = sortPosts(await getCollection('posts', ({ data }) => !data.draft));
  const items = posts
    .map((post) => {
      const url = new URL(postPath(post.id), site);
      return `
        <item>
          <title>${escapeXml(post.data.title)}</title>
          <link>${url}</link>
          <guid>${url}</guid>
          <pubDate>${post.data.date.toUTCString()}</pubDate>
          <description>${escapeXml(postExcerpt(post, 300))}</description>
        </item>`;
    })
    .join('');

  return new Response(
    `<?xml version="1.0" encoding="UTF-8" ?>
      <rss version="2.0">
        <channel>
          <title>Marcin Skalski's Blog</title>
          <link>${site}</link>
          <description>Agentic AI, LLM systems, agent harnesses, and production engineering.</description>
          ${items}
        </channel>
      </rss>`,
    {
      headers: {
        'Content-Type': 'application/rss+xml; charset=utf-8',
      },
    }
  );
}
