import { defineApp } from 'convex/server';
import storage from '../../src/component/convex.config';

const app = defineApp();
app.use(storage);

export default app;
