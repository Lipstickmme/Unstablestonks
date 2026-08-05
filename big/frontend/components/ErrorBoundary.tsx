"use client";

import { Component, ReactNode } from "react";
import { sanitizeErrorMessage } from "@/lib/contract";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("Error caught by boundary:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-black text-white flex items-center justify-center">
          <div className="text-center">
            <h2 className="text-2xl font-bold mb-4">Something went wrong</h2>
            <p className="text-neutral-400 mb-4">{this.state.error ? sanitizeErrorMessage(this.state.error) : "An unexpected error occurred"}</p>
            <button
              onClick={() => {
                this.setState({ hasError: false, error: undefined });
                window.location.reload();
              }}
              className="px-5 py-2.5 bg-orange-500 hover:bg-orange-600 text-white font-medium rounded-lg"
            >
              Reload
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

