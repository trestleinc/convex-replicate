import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { useCreateTask, useTasks, useUpdateTask } from '../useTasks';

export const Route = createFileRoute('/')({
  component: HomeComponent,
});

function HomeComponent() {
  const [newTaskText, setNewTaskText] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');

  const { data, isLoading, error } = useTasks();

  const createTask = useCreateTask();
  const updateTask = useUpdateTask();

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

  if (error) {
    return (
      <div className="p-6 max-w-md mx-auto">
        <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded">
          Error loading tasks: {String(error)}
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-md mx-auto">
      <h3 className="text-2xl font-bold mb-6">Task Manager (RxDB)</h3>

      {isLoading && (
        <div className="mb-4 text-center">
          <div className="inline-block animate-spin rounded-full h-4 w-4 border-b-2 border-blue-500"></div>
          <span className="ml-2 text-gray-600">Loading...</span>
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
            className="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            type="submit"
            disabled={!newTaskText.trim() || isLoading}
            className="px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Add
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
              className="flex items-center gap-3 p-3 border border-gray-200 rounded-md"
            >
              {/* Toggle Completion Checkbox */}
              <input
                type="checkbox"
                checked={task.isCompleted}
                onChange={() => handleToggleComplete(task.id, task.isCompleted)}
                className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500"
                disabled={isLoading}
              />

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
                    className="flex-1 px-2 py-1 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => handleEditStart(task.id, task.text)}
                  className={`flex-1 cursor-pointer hover:bg-gray-100 px-2 py-1 rounded text-left ${
                    task.isCompleted ? 'line-through text-gray-500' : ''
                  }`}
                >
                  {task.text}
                </button>
              )}
            </div>
          ))}
      </div>

      {data.filter((task) => !task._deleted).length === 0 && !isLoading && (
        <p className="text-gray-500 text-center py-8">No tasks yet. Create one above!</p>
      )}
    </div>
  );
}
