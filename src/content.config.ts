import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const posts = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './content/posts' }),
  schema: z.object({
    title: z.string(),
    date: z.coerce.date(),
    draft: z.boolean().default(false),
    author: z.string().optional(),
  }),
});

const pages = defineCollection({
  loader: glob({ pattern: '*.md', base: './content' }),
  schema: z.object({
    title: z.string().optional().nullable(),
    date: z.any().optional(),
    draft: z.boolean().default(false),
    comment: z.boolean().optional(),
  }),
});

export const collections = {
  posts,
  pages,
};
