import { getCollection } from 'astro:content';
import { postPath, sortPosts } from '../utils/posts';

export async function GET({ site }: { site: URL }) {
  const posts = sortPosts(await getCollection('posts', ({ data }) => !data.draft));
  const urls = [
    '/',
    '/posts/',
    '/about/',
    '/public_speaking/',
    ...posts.map((post) => postPath(post.id)),
  ];

  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls
  .map(
    (path) => `  <url>
    <loc>${new URL(path, site)}</loc>
  </url>`
  )
  .join('\n')}
</urlset>
`;

  return new Response(body, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
    },
  });
}
