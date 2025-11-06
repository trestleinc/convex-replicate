import { ConvexClient } from 'convex/browser';
import { PUBLIC_CONVEX_URL } from '$env/static/public';

export const convexClient = new ConvexClient(PUBLIC_CONVEX_URL);
