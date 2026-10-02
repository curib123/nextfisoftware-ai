import type { CSSProperties } from 'react';

export function Skeleton({
  className = '',
  width,
  height,
}: {
  className?: string;
  width?: CSSProperties['width'];
  height?: CSSProperties['height'];
}) {
  return (
    <span
      aria-hidden="true"
      className={`skeleton-shimmer ${className}`.trim()}
      style={{ width, height }}
    />
  );
}

export function ResourceSkeleton({
  rows = 4,
}: {
  rows?: number;
}) {
  return (
    <div
      className="resource-skeleton"
      role="status"
      aria-label="Loading content"
    >
      {Array.from({ length: rows }, (_, index) => (
        <div className="resource-skeleton-row" key={index}>
          <Skeleton className="resource-skeleton-icon" />
          <div>
            <Skeleton width={`${Math.max(42, 78 - index * 7)}%`} height={14} />
            <Skeleton width={`${Math.max(56, 92 - index * 6)}%`} height={10} />
          </div>
        </div>
      ))}
    </div>
  );
}

export function CardSkeletons({
  count = 3,
  className = '',
}: {
  count?: number;
  className?: string;
}) {
  return (
    <div
      className={`card-skeleton-grid ${className}`.trim()}
      role="status"
      aria-label="Loading content"
    >
      {Array.from({ length: count }, (_, index) => (
        <article className="card-skeleton" key={index}>
          <div className="card-skeleton-heading">
            <Skeleton className="resource-skeleton-icon" />
            <Skeleton width="38%" height={12} />
          </div>
          <Skeleton width="68%" height={22} />
          <Skeleton width="100%" height={10} />
          <Skeleton width="88%" height={10} />
          <div className="card-skeleton-actions">
            <Skeleton width={82} height={30} />
            <Skeleton width={94} height={30} />
          </div>
        </article>
      ))}
    </div>
  );
}
