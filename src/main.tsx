import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import MiniApp from './MiniApp'
import './styles.css'

// 完整面板和迷你面板共用这一份产物，靠 ?mode=mini 区分
const mini = new URLSearchParams(location.search).get('mode') === 'mini'

createRoot(document.getElementById('root')!).render(
  <StrictMode>{mini ? <MiniApp /> : <App />}</StrictMode>,
)
