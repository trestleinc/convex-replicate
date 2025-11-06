import { ConvexHttpClient } from 'convex/browser';
import { PUBLIC_CONVEX_URL } from '$env/static/public';
import { api } from '../convex/_generated/api';
import type { PageServerLoad } from './$types';
import type { Task } from '$lib/stores/tasks.svelte';

const httpClient = new ConvexHttpClient(PUBLIC_CONVEX_URL);

export const load: PageServerLoad = async () => {
  // Use simple query - returns materialized documents (hard deletes are already removed)
  const rawTasks = await httpClient.query(api.tasks.stream);

  // Convex documents have extra fields (_id, _creationTime, version, timestamp)
  // Cast to Task type for client consumption
  const tasks: Task[] = rawTasks as any;

  return {
    tasks,
  };
};
