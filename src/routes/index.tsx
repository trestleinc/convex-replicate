import { createFileRoute } from '@tanstack/react-router'
import { useSuspenseQuery } from "@tanstack/react-query";
import { convexQuery, useConvexMutation } from "@convex-dev/react-query";
import { api } from "../../convex/_generated/api";
import { Id } from "../../convex/_generated/dataModel";
import { useState } from "react";

export const Route = createFileRoute('/')({
  component: HomeComponent,
})

function HomeComponent() {
  const [newTaskText, setNewTaskText] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");

  const { data } = useSuspenseQuery(convexQuery(api.tasks.get, {}));
  
  const createTask = useConvexMutation(api.tasks.create);
  const updateTask = useConvexMutation(api.tasks.update);

  const handleCreateTask = (e: React.FormEvent) => {
    e.preventDefault();
    if (newTaskText.trim()) {
      createTask({ text: newTaskText.trim() });
      setNewTaskText("");
    }
  };

  const handleToggleComplete = (id: string, isCompleted: boolean) => {
    updateTask({ id: id as Id<"tasks">, isCompleted: !isCompleted });
  };

  const handleEditStart = (id: string, text: string) => {
    setEditingId(id);
    setEditText(text);
  };

  const handleEditSave = (id: string) => {
    if (editText.trim()) {
      updateTask({ id: id as Id<"tasks">, text: editText.trim() });
      setEditingId(null);
    }
  };

  const handleEditCancel = () => {
    setEditingId(null);
    setEditText("");
  };

  return (
    <div className="p-6 max-w-md mx-auto">
      <h3 className="text-2xl font-bold mb-6">Task Manager</h3>
      
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
            disabled={!newTaskText.trim()}
            className="px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Add
          </button>
        </div>
      </form>

      {/* Task List */}
      <div className="space-y-2">
        {data.map((task) => (
          <div key={task._id} className="flex items-center gap-3 p-3 border border-gray-200 rounded-md">
            {/* Toggle Completion Checkbox */}
            <input
              type="checkbox"
              checked={task.isCompleted}
              onChange={() => handleToggleComplete(task._id, task.isCompleted)}
              className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500"
            />
            
            {/* Task Text */}
            {editingId === task._id ? (
              <div className="flex-1 flex gap-2">
                <input
                  type="text"
                  value={editText}
                  onChange={(e) => setEditText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleEditSave(task._id);
                    if (e.key === "Escape") handleEditCancel();
                  }}
                  onBlur={() => handleEditSave(task._id)}
                  className="flex-1 px-2 py-1 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                  autoFocus
                />
              </div>
            ) : (
              <span
                onClick={() => handleEditStart(task._id, task.text)}
                className={`flex-1 cursor-pointer hover:bg-pink-700 px-2 py-1 rounded ${
                  task.isCompleted ? "line-through text-gray-500" : ""
                }`}
              >
                {task.text}
              </span>
            )}
          </div>
        ))}
      </div>

      {data.length === 0 && (
        <p className="text-gray-500 text-center py-8">No tasks yet. Create one above!</p>
      )}
    </div>
  )
}
