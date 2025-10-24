import React from 'react';
import { getLogger } from '../lib/logger';

const logger = getLogger('error-boundary');

interface Props {
  children: React.ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

/**
 * Error Boundary component for catching React errors in ConvexRx
 * Prevents the entire app from crashing when sync or rendering errors occur
 */
export class ConvexRxErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    logger.error('Error Boundary caught error', { error, errorInfo });
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
    // Reload the page to reset state
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div
          style={{
            padding: '2rem',
            maxWidth: '600px',
            margin: '2rem auto',
            border: '1px solid #ef4444',
            borderRadius: '8px',
            backgroundColor: '#fef2f2',
          }}
        >
          <h1 style={{ color: '#dc2626', marginBottom: '1rem' }}>Something went wrong</h1>
          <p style={{ marginBottom: '1rem', color: '#991b1b' }}>
            An error occurred while syncing data:
          </p>
          <pre
            style={{
              padding: '1rem',
              backgroundColor: '#fee2e2',
              borderRadius: '4px',
              overflow: 'auto',
              fontSize: '0.875rem',
              color: '#7f1d1d',
            }}
          >
            {this.state.error?.message || 'Unknown error'}
          </pre>
          {this.state.error?.stack && (
            <details style={{ marginTop: '1rem' }}>
              <summary style={{ cursor: 'pointer', color: '#991b1b' }}>Stack trace</summary>
              <pre
                style={{
                  marginTop: '0.5rem',
                  padding: '1rem',
                  backgroundColor: '#fee2e2',
                  borderRadius: '4px',
                  overflow: 'auto',
                  fontSize: '0.75rem',
                  color: '#7f1d1d',
                }}
              >
                {this.state.error.stack}
              </pre>
            </details>
          )}
          <button
            type="button"
            onClick={this.handleReset}
            style={{
              marginTop: '1rem',
              padding: '0.5rem 1rem',
              backgroundColor: '#dc2626',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '1rem',
            }}
          >
            Reload Page
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
