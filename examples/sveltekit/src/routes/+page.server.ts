import { ConvexHttpClient } from 'convex/browser';
import { PUBLIC_CONVEX_URL } from '$env/static/public';
import { loadCollection } from '@trestleinc/replicate/ssr';
import { api } from '../convex/_generated/api';
import type { PageServerLoad } from './$types';
import type { Task } from '$lib/stores/tasks.svelte';

const httpClient = new ConvexHttpClient(PUBLIC_CONVEX_URL);

export const load: PageServerLoad = async () => {
  const allTasks = await loadCollection<Task>(httpClient, {
    api: api.tasks,
    collection: 'tasks',
    limit: 100,
  });

  // Filter out deleted items for SSR (prevent flash of deleted content)
  const tasks = allTasks.filter((task: any) => !task.deleted);

  return {
    tasks,
  };
};
