import { createFileRoute } from '@tanstack/react-router';
import { Delete, Diamond, DiamondPlus } from 'lucide-react';
import { useState } from 'react';
import type { Task } from '../useTasks';
import { useTasks } from '../useTasks';
import { ConvexHttpClient } from 'convex/browser';
import { loadConvexData } from '@convex-rx/core/ssr';
import { api } from '../../convex/_generated/api';

const httpClient = new ConvexHttpClient(import.meta.env.VITE_CONVEX_URL);

export const Route = createFileRoute('/')({
  loader: async () => {
    const tasks = await loadConvexData<Task>(httpClient, api.tasks.pullChanges, {
      limit: 100,
    });
    return { tasks };
  },
  component: HomeComponent,
});

function HomeComponent() {
  const { tasks: initialTasks } = Route.useLoaderData();
  const [newTaskText, setNewTaskText] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');

  const collection = useTasks(initialTasks);

  const handleCreateTask = (e: React.FormEvent) => {
    e.preventDefault();
    if (newTaskText.trim()) {
      const id = crypto.randomUUID();
      collection.insert({ id, text: newTaskText.trim(), isCompleted: false });
      setNewTaskText('');
    }
  };

  const handleToggleComplete = (id: string, isCompleted: boolean) => {
    collection.update(id, (draft) => {
      draft.isCompleted = !isCompleted;
    });
  };

  const handleEditStart = (id: string, text: string) => {
    setEditingId(id);
    setEditText(text);
  };

  const handleEditSave = (id: string) => {
    if (editText.trim()) {
      collection.update(id, (draft) => {
        draft.text = editText.trim();
      });
      setEditingId(null);
    }
  };

  const handleEditCancel = () => {
    setEditingId(null);
    setEditText('');
  };

  const handleDelete = (id: string) => {
    collection.delete(id);
  };

  if (collection.status === 'error') {
    return (
      <div className="p-6 max-w-2xl mx-auto">
        <div className="bg-rose-pine-surface border-2 border-rose-pine-rose text-rose-pine-text px-6 py-4 rounded-lg shadow-md">
          <h2 className="text-lg font-semibold text-rose-pine-rose mb-2">Error</h2>
          <p className="text-rose-pine-muted mb-4">Failed to load tasks. Please try reloading.</p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="px-4 py-2 bg-rose-pine-rose text-rose-pine-base rounded hover:bg-rose-pine-rose/80 transition-colors"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (collection.status === 'loading') {
    return (
      <div className="p-6 max-w-2xl mx-auto">
        <div className="mb-4 text-center">
          <div className="inline-block animate-spin rounded-full h-4 w-4 border-b-2 border-rose-pine-gold"></div>
          <span className="ml-2 text-rose-pine-muted">Loading...</span>
        </div>
      </div>
    );
  }

  const tasks = collection.toArray;

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <form onSubmit={handleCreateTask} className="mb-6">
        <div className="flex gap-2">
          <input
            type="text"
            value={newTaskText}
            onChange={(e) => setNewTaskText(e.target.value)}
            placeholder="Add a new task..."
            className="flex-1 px-3 py-2 border border-rose-pine-muted rounded focus:outline-none focus:border-rose-pine-rose"
          />
          <button
            type="submit"
            disabled={!newTaskText.trim()}
            className="px-4 py-2 border border-rose-pine-rose text-rose-pine-text rounded hover:bg-rose-pine-rose hover:text-rose-pine-base disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            Add
          </button>
        </div>
      </form>

      <div className="space-y-2">
        {tasks.map((task) => (
          <div
            key={task.id}
            className="flex items-center gap-3 p-3 border border-rose-pine-muted rounded"
          >
            <button
              type="button"
              onClick={() => handleDelete(task.id)}
              className="text-rose-pine-rose hover:text-rose-pine-rose/80 transition-colors"
              aria-label="Delete task"
            >
              <Delete className="w-5 h-5" />
            </button>

            <button
              type="button"
              onClick={() => handleToggleComplete(task.id, task.isCompleted)}
              className={`transition-colors ${
                task.isCompleted
                  ? 'text-blue hover:text-rose-pine-gold'
                  : 'text-rose-pine-gold hover:text-blue'
              }`}
              aria-label={task.isCompleted ? 'Mark as incomplete' : 'Mark as complete'}
            >
              {task.isCompleted ? (
                <DiamondPlus className="w-5 h-5" />
              ) : (
                <Diamond className="w-5 h-5" />
              )}
            </button>

            {editingId === task.id ? (
              <div className="flex-1 flex gap-2">
                <input
                  type="text"
                  value={editText}
                  onChange={(e) => setEditText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleEditSave(task.id);
                    if (e.key === 'Escape') handleEditCancel();
                  }}
                  onBlur={() => handleEditSave(task.id)}
                  className="flex-1 px-2 py-1 border border-rose-pine-muted rounded focus:outline-none focus:border-rose-pine-rose"
                />
              </div>
            ) : (
              <button
                type="button"
                onClick={() => handleEditStart(task.id, task.text)}
                className={`flex-1 cursor-pointer hover:bg-rose-pine-surface px-2 py-1 rounded text-left ${
                  task.isCompleted ? 'line-through text-rose-pine-muted' : ''
                }`}
              >
                {task.text}
              </button>
            )}
          </div>
        ))}
      </div>

      {tasks.length === 0 && (
        <p className="text-rose-pine-muted text-center py-8">No tasks yet. Create one above!</p>
      )}
    </div>
  );
}
