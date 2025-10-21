import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { DatabaseZap, Delete, Diamond, DiamondPlus } from 'lucide-react';
import { useCreateTask, useDeleteTask, useTasks, useUpdateTask } from '../useTasks';

export const Route = createFileRoute('/')({
  component: HomeComponent,
});

function HomeComponent() {
  const [newTaskText, setNewTaskText] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');

  const { data, isLoading, error, purgeStorage } = useTasks();

  const createTask = useCreateTask();
  const updateTask = useUpdateTask();
  const deleteTask = useDeleteTask();

  const handleCreateTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newTaskText.trim()) {
      try {
        await createTask({ text: newTaskText.trim() });
        setNewTaskText('');
      } catch (_error) {}
    }
  };

  const handleToggleComplete = async (id: string, isCompleted: boolean) => {
    try {
      await updateTask(id, { isCompleted: !isCompleted });
    } catch (_error) {}
  };

  const handleEditStart = (id: string, text: string) => {
    setEditingId(id);
    setEditText(text);
  };

  const handleEditSave = async (id: string) => {
    if (editText.trim()) {
      try {
        await updateTask(id, { text: editText.trim() });
        setEditingId(null);
      } catch (_error) {}
    }
  };

  const handleEditCancel = () => {
    setEditingId(null);
    setEditText('');
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteTask(id);
    } catch (_error) {}
  };

  const handlePurgeStorage = async () => {
    if (confirm('Are you sure you want to delete all local data? This will reload the page.')) {
      try {
        await purgeStorage();
      } catch (_error) {}
    }
  };

  if (error) {
    return (
      <div className="p-6 max-w-md mx-auto">
        <div className="bg-rose-pine-surface border border-rose-pine-rose text-rose-pine-text px-4 py-3 rounded">
          Error loading tasks: {String(error)}
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-md mx-auto">
      <h3 className="text-2xl font-bold mb-6">Convex-Rx</h3>

      {isLoading && (
        <div className="mb-4 text-center">
          <div className="inline-block animate-spin rounded-full h-4 w-4 border-b-2 border-rose-pine-gold"></div>
          <span className="ml-2 text-rose-pine-muted">Loading...</span>
        </div>
      )}

      {/* Create Task Form */}
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
            disabled={!newTaskText.trim() || isLoading}
            className="px-4 py-2 border border-rose-pine-rose text-rose-pine-text rounded hover:bg-rose-pine-rose hover:text-rose-pine-base disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            Add
          </button>
          <button
            type="button"
            onClick={handlePurgeStorage}
            disabled={isLoading}
            className="px-4 py-2 border border-rose-pine-rose text-rose-pine-text rounded hover:bg-rose-pine-rose hover:text-rose-pine-base disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            aria-label="Delete all local data"
          >
            <DatabaseZap className="w-5 h-5" />
          </button>
        </div>
      </form>

      {/* Task List */}
      <div className="space-y-2">
        {data
          .filter((task) => !task._deleted)
          .map((task) => (
            <div
              key={task.id}
              className="flex items-center gap-3 p-3 border border-rose-pine-muted rounded"
            >
              {/* Delete Button */}
              <button
                type="button"
                onClick={() => handleDelete(task.id)}
                disabled={isLoading}
                className="text-rose-pine-rose hover:text-rose-pine-rose/80 transition-colors disabled:opacity-50"
                aria-label="Delete task"
              >
                <Delete className="w-5 h-5" />
              </button>

              {/* Toggle Completion Checkbox */}
              <button
                type="button"
                onClick={() => handleToggleComplete(task.id, task.isCompleted)}
                disabled={isLoading}
                className={`transition-colors disabled:opacity-50 ${
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

              {/* Task Text */}
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

      {data.filter((task) => !task._deleted).length === 0 && !isLoading && (
        <p className="text-rose-pine-muted text-center py-8">No tasks yet. Create one above!</p>
      )}
    </div>
  );
}
