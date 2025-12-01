import { defineReplicate } from '@trestleinc/replicate/server';
import { components } from './_generated/api';

export interface PostMetadata {
  readingTime: number;
  wordCount: number;
  featuredImage?: string;
}

export interface Post {
  id: string;
  authorId: string;
  title: string;
  content: string;
  excerpt?: string;
  publishedAt?: number;
  status: 'draft' | 'published' | 'archived';
  tags: string[];
  viewCount: number;
  likeCount: number;
  metadata?: PostMetadata;
}

export const { stream, material, insert, update, remove, protocol, compact, prune } =
  defineReplicate<Post>({
    component: components.replicate,
    collection: 'posts',
  });
