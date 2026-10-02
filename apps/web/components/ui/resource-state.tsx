import type { ReactNode } from 'react';
import { ResourceSkeleton } from './skeleton';

export function ResourceState({
  loading,
  error,
  empty,
  onRetry,
  children,
}: {
  loading: boolean;
  error?: string;
  empty?: boolean;
  onRetry: () => void;
  children?: ReactNode;
}) {
  if (loading) return <ResourceSkeleton />;
  if (error)
    return (
      <div className="resource-state">
        <p className="error-banner" role="alert">
          {error}
        </p>
        <button className="secondary-button" onClick={onRetry}>
          Try again
        </button>
      </div>
    );
  if (empty) return <div className="resource-state">{children}</div>;
  return null;
}
