import { defineApp } from 'convex/server';
import replicate from '@convex-replicate/component/convex.config';

const app = defineApp();
app.use(replicate);

export default app;
