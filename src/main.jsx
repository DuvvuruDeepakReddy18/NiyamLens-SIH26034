import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './styles.css'

class AppErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) { return { error } }

  componentDidCatch(error, details) {
    console.error('NiyamLens recovered from a render failure.', error, details)
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <main className="fatal-recovery" role="alert">
        <div>
          <span>RECOVERY MODE</span>
          <h1>The inspection screen hit an unexpected error.</h1>
          <p>Your saved evidence remains in this browser. Reload the workspace; if the problem repeats, export the console error for the development team.</p>
          <button type="button" onClick={() => window.location.reload()}>Reload NiyamLens</button>
          <details><summary>Technical detail</summary><code>{this.state.error.message || String(this.state.error)}</code></details>
        </div>
      </main>
    )
  }
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AppErrorBoundary><App /></AppErrorBoundary>
  </React.StrictMode>,
)

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js'))
}
