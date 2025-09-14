import { createFileRoute } from '@tanstack/react-router'
import { useTasks, useCreateTask, useUpdateTask } from "../useTasks";
import { useState, useEffect } from "react";

export const Route = createFileRoute('/')({
  component: HomeComponent,
})

function HomeComponent() {
  const [newTaskText, setNewTaskText] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [isOffline, setIsOffline] = useState(false);

  const { data, collection } = useTasks();
  
  const createTask = useCreateTask();
  const updateTask = useUpdateTask();
  
  // Check connection status on component mount and when offline state changes
  useEffect(() => {
    if (collection?.utils?.isConnected) {
      const connected = collection.utils.isConnected();
      setIsOffline(!connected);
    }
  }, [collection]);
  
  const handleToggleOffline = async () => {
    if (!collection?.utils) return;
    
    try {
      if (isOffline) {
        // Go online
        await collection.utils.goOnline();
        setIsOffline(false);
      } else {
        // Go offline
        await collection.utils.goOffline();
        setIsOffline(true);
      }
    } catch (error) {
      console.error("Failed to toggle connection:", error);
    }
  };

  const handleCreateTask = (e: React.FormEvent) => {
    e.preventDefault();
    if (newTaskText.trim()) {
      createTask({ text: newTaskText.trim() });
      setNewTaskText("");
    }
  };

  const handleToggleComplete = (id: string, isCompleted: boolean) => {
    updateTask(id, { isCompleted: !isCompleted });
  };

  const handleEditStart = (id: string, text: string) => {
    setEditingId(id);
    setEditText(text);
  };

  const handleEditSave = (id: string) => {
    if (editText.trim()) {
      updateTask(id, { text: editText.trim() });
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
          
          {/* Offline/Online Toggle */}
          <button
            type="button"
            onClick={handleToggleOffline}
            className={`px-3 py-2 rounded-md text-sm font-medium transition-colors ${
              isOffline 
                ? "bg-red-500 text-white hover:bg-red-600" 
                : "bg-green-500 text-white hover:bg-green-600"
            }`}
          >
            {isOffline ? "Offline" : "Online"}
          </button>
        </div>
      </form>

      {/* Task List */}
      <div className="space-y-2">
        {data.map((task) => (
          <div key={task.id} className="flex items-center gap-3 p-3 border border-gray-200 rounded-md">
            {/* Toggle Completion Checkbox */}
            <input
              type="checkbox"
              checked={task.isCompleted}
              onChange={() => handleToggleComplete(task.id, task.isCompleted)}
              className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500"
            />
            
            {/* Task Text */}
            {editingId === task.id ? (
              <div className="flex-1 flex gap-2">
                <input
                  type="text"
                  value={editText}
                  onChange={(e) => setEditText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleEditSave(task.id);
                    if (e.key === "Escape") handleEditCancel();
                  }}
                  onBlur={() => handleEditSave(task.id)}
                  className="flex-1 px-2 py-1 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                  autoFocus
                />
              </div>
            ) : (
              <span
                onClick={() => handleEditStart(task.id, task.text)}
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
