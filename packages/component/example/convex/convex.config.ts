import { defineApp } from 'convex/server';
import replicate from '../../src/component/convex.config';

const app = defineApp();
app.use(replicate);

export default app;
