import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
  /** Returns the app to its usual state, without the failed feature. */
  onDismiss: () => void
}

interface State {
  failed: boolean
  message: string
}

/**
 * Keeps a failure inside an optional, lazily-loaded feature from taking the
 * rest of the app with it.
 *
 * Without this, one thrown error anywhere in the loaded chunk unmounts the
 * whole tree and leaves a blank page — the budget included. The budget is the
 * part the user depends on, and it must survive anything an add-on does.
 */
export default class OptionalFeatureBoundary extends Component<Props, State> {
  state: State = { failed: false, message: '' }

  static getDerivedStateFromError(error: unknown): State {
    return {
      failed: true,
      message: error instanceof Error ? error.message : String(error),
    }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('An optional feature failed to load.', error, info.componentStack)
  }

  render() {
    if (!this.state.failed) return this.props.children

    return (
      <div className="fixed inset-0 z-40 flex items-center justify-center bg-sand-50 px-6">
        <div className="max-w-md space-y-3 text-center">
          <p className="text-base font-semibold text-ink-900">
            That part could not be opened
          </p>
          <p className="text-sm text-ink-500">
            Nothing has been lost, and your budget is untouched. Reloading the
            page usually clears it.
          </p>
          <p className="break-words text-xs text-ink-400">{this.state.message}</p>
          <div className="flex justify-center gap-2 pt-1">
            <button
              onClick={() => {
                this.setState({ failed: false, message: '' })
                this.props.onDismiss()
              }}
              className="btn-ghost text-xs"
            >
              Go back
            </button>
            <button onClick={() => window.location.reload()} className="btn-primary text-xs">
              Reload
            </button>
          </div>
        </div>
      </div>
    )
  }
}
