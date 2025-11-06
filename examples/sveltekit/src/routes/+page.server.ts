import { ConvexHttpClient } from 'convex/browser';
import { PUBLIC_CONVEX_URL } from '$env/static/public';
import { api } from '../convex/_generated/api';
import type { PageServerLoad } from './$types';

const httpClient = new ConvexHttpClient(PUBLIC_CONVEX_URL);

export const load: PageServerLoad = async () => {
  // Use simple query - returns materialized documents (hard deletes are already removed)
  const tasks = await httpClient.query(api.tasks.stream);

  return {
    tasks,
  };
};
