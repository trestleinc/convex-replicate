<script lang="ts">
import '../app.css';
import favicon from '$lib/assets/favicon.svg';
import { configure, getConsoleSink } from '@logtape/logtape';
import { onMount } from 'svelte';

const { children } = $props();

// Configure LogTape for logging
onMount(async () => {
  try {
    await configure({
      sinks: { console: getConsoleSink() },
      loggers: [{ category: ['convex-replicate'], lowestLevel: 'debug', sinks: ['console'] }],
    });
  } catch {
    // LogTape already configured during HMR - this is expected
  }
});
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<meta charset="utf-8" />
	<meta name="viewport" content="width=device-width, initial-scale=1" />
</svelte:head>

{@render children()}
