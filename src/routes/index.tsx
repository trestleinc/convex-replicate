import { createFileRoute } from '@tanstack/react-router'
import { useSuspenseQuery } from "@tanstack/react-query";
import { convexQuery } from "@convex-dev/react-query";
import { api } from "../../convex/_generated/api";


export const Route = createFileRoute('/')({
  component: HomeComponent,
})

function HomeComponent() {

  const { data } = useSuspenseQuery(convexQuery(api.tasks.get, {}));
  return (
    <div className="p-2">
      <h3>Welcome Home!</h3>
      {data.map((task) => (
        <div key={task._id}>{task.text}</div>
      ))
      }
    </div>
  )
}
