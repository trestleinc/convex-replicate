import { defineReplicate } from '@trestleinc/replicate/server';
import { components } from './_generated/api';

export interface UserPreferences {
  theme: 'light' | 'dark' | 'system';
  notifications: boolean;
  language: string;
}

export interface User {
  id: string;
  email: string;
  displayName: string;
  avatarUrl?: string;
  bio?: string;
  isOnline: boolean;
  lastSeenAt?: number;
  preferences?: UserPreferences;
}

export const { stream, material, insert, update, remove, protocol, compact, prune } =
  defineReplicate<User>({
    component: components.replicate,
    collection: 'users',
  });
