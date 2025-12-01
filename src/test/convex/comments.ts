import { defineReplicate } from '@trestleinc/replicate/server';
import { components } from './_generated/api';

export interface CommentReactions {
  likes: number;
  hearts: number;
  laughs: number;
}

export interface Comment {
  id: string;
  postId: string;
  authorId: string;
  parentId?: string;
  content: string;
  isEdited: boolean;
  editedAt?: number;
  reactions?: CommentReactions;
}

export const { stream, material, insert, update, remove, protocol, compact, prune } =
  defineReplicate<Comment>({
    component: components.replicate,
    collection: 'comments',
  });
