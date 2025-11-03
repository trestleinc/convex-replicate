<script lang="ts">
import { Delete, Diamond, DiamondPlus } from '@lucide/svelte';
import { useLiveQuery } from '@tanstack/svelte-db';
import { getTasksCollection, type Task } from '$lib/stores/tasks.svelte';
import { browser } from '$app/environment';
import type { PageData } from './$types';

const { data }: { data: PageData } = $props();

let newTaskText = $state('');
let editingId = $state<string | null>(null);
let editText = $state('');

// Get the collection
const collection = getTasksCollection(data.tasks);

// Use TanStack DB's useLiveQuery - pass the collection directly
// Type assertion needed for same contravariance issue as in tasks.svelte.ts
const query = useLiveQuery(collection as any);

// Reactive data from the query
const tasks = $derived((query.data || []) as Task[]);
const isLoading = $derived(query.isLoading ?? false);
const isError = $derived(query.isError ?? false);

function handleCreateTask(e: Event) {
  e.preventDefault();
  if (newTaskText.trim() && browser) {
    const id = crypto.randomUUID();
    collection.insert({ id, text: newTaskText.trim(), isCompleted: false });
    newTaskText = '';
  }
}

function handleToggleComplete(id: string, isCompleted: boolean) {
  if (browser) {
    collection.update(id, (draft: Task) => {
      draft.isCompleted = !isCompleted;
    });
  }
}

function handleEditStart(id: string, text: string) {
  editingId = id;
  editText = text;
}

function handleEditSave(id: string) {
  if (editText.trim() && browser) {
    collection.update(id, (draft: Task) => {
      draft.text = editText.trim();
    });
    editingId = null;
  }
}

function handleEditCancel() {
  editingId = null;
  editText = '';
}

function handleDelete(id: string) {
  if (browser) {
    collection.delete(id);
  }
}

function handleKeyDown(e: KeyboardEvent, id: string) {
  if (e.key === 'Enter') {
    handleEditSave(id);
  } else if (e.key === 'Escape') {
    handleEditCancel();
  }
}
</script>

<svelte:head>
	<title>Convex TanStack DB - Svelte Demo</title>
</svelte:head>

<div class="p-6 max-w-2xl mx-auto">
	{#if isError}
		<div
			class="bg-rose-pine-surface border-2 border-rose-pine-rose text-rose-pine-text px-6 py-4 rounded-lg shadow-md"
		>
			<h2 class="text-lg font-semibold text-rose-pine-rose mb-2">Error</h2>
			<p class="text-rose-pine-muted mb-4">Failed to load tasks. Please try reloading.</p>
			<button
				type="button"
				onclick={() => window.location.reload()}
				class="px-4 py-2 bg-rose-pine-rose text-rose-pine-base rounded hover:bg-rose-pine-rose/80 transition-colors"
			>
				Retry
			</button>
		</div>
	{:else}
		<form onsubmit={handleCreateTask} class="mb-6">
			<div class="flex gap-2">
				<input
					type="text"
					bind:value={newTaskText}
					placeholder="Add a new task..."
					disabled={!browser}
					class="flex-1 px-3 py-2 border border-rose-pine-muted rounded focus:outline-none focus:border-rose-pine-rose disabled:opacity-50"
				/>
				<button
					type="submit"
					disabled={!newTaskText.trim() || !browser}
					class="px-4 py-2 border border-rose-pine-rose text-rose-pine-text rounded hover:bg-rose-pine-rose hover:text-rose-pine-base disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
				>
					Add
				</button>
			</div>
		</form>

		{#if isLoading}
			<div class="mb-4 text-center">
				<div
					class="inline-block animate-spin rounded-full h-4 w-4 border-b-2 border-rose-pine-gold"
				></div>
				<span class="ml-2 text-rose-pine-muted">Loading...</span>
			</div>
		{/if}

		<div class="space-y-2">
			{#each tasks as task (task.id)}
				<div class="flex items-center gap-3 p-3 border border-rose-pine-muted rounded">
					<button
						type="button"
						onclick={() => handleDelete(task.id)}
						disabled={!browser}
						class="text-rose-pine-rose hover:text-rose-pine-rose/80 transition-colors disabled:opacity-50"
						aria-label="Delete task"
					>
						<Delete class="w-5 h-5" />
					</button>

					<button
						type="button"
						onclick={() => handleToggleComplete(task.id, task.isCompleted)}
						disabled={!browser}
						class="transition-colors disabled:opacity-50 {task.isCompleted
							? 'text-blue hover:text-rose-pine-gold'
							: 'text-rose-pine-gold hover:text-blue'}"
						aria-label={task.isCompleted ? 'Mark as incomplete' : 'Mark as complete'}
					>
						{#if task.isCompleted}
							<DiamondPlus class="w-5 h-5" />
						{:else}
							<Diamond class="w-5 h-5" />
						{/if}
					</button>

					{#if editingId === task.id}
						<div class="flex-1 flex gap-2">
							<input
								type="text"
								bind:value={editText}
								onkeydown={(e) => handleKeyDown(e, task.id)}
								onblur={() => handleEditSave(task.id)}
								class="flex-1 px-2 py-1 border border-rose-pine-muted rounded focus:outline-none focus:border-rose-pine-rose"
							/>
						</div>
					{:else}
						<button
							type="button"
							onclick={() => handleEditStart(task.id, task.text)}
							disabled={!browser}
							class="flex-1 cursor-pointer hover:bg-rose-pine-surface px-2 py-1 rounded text-left disabled:opacity-50 {task.isCompleted
								? 'line-through text-rose-pine-muted'
								: ''}"
						>
							{task.text}
						</button>
					{/if}
				</div>
			{/each}
		</div>

		{#if tasks.length === 0 && !isLoading}
			<p class="text-rose-pine-muted text-center py-8">No tasks yet. Create one above!</p>
		{/if}
	{/if}
</div>
