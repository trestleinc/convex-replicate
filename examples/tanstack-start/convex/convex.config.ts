import { defineApp } from 'convex/server';
import storage from '@convex-rx/storage/convex.config';

const app = defineApp();
app.use(storage);

export default app;
