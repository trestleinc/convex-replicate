import { defineComponent } from 'convex/server';
import crons from '@convex-dev/crons/convex.config';

const component = defineComponent('replicate');
component.use(crons);

export default component;
