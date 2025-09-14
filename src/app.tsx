import { RouterProvider } from '@tanstack/react-router'
import {createRouter} from './router'
import './styles.css'

// Set up a Router instance
const router = createRouter()

// Register things for typesafety
const App = () => {
  return <RouterProvider router={router} />
}

export default App
