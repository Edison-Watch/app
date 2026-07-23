/** Skeleton loading placeholders with shimmer animation. */

interface SkeletonBaseProps {
  className?: string
}

/** Single-line text placeholder. */
export function SkeletonText({ className = '' }: SkeletonBaseProps) {
  return (
    <div
      className={`h-4 rounded bg-[var(--bg-overlay)] skeleton-shimmer ${className}`}
      role="status"
      aria-label="Loading"
    />
  )
}

/** Rectangular card/block placeholder. */
export function SkeletonRect({ className = '' }: SkeletonBaseProps) {
  return (
    <div
      className={`rounded-lg bg-[var(--bg-overlay)] skeleton-shimmer ${className}`}
      role="status"
      aria-label="Loading"
    />
  )
}

/** Circular avatar placeholder. */
export function SkeletonCircle({ className = '' }: SkeletonBaseProps) {
  return (
    <div
      className={`rounded-full bg-[var(--bg-overlay)] skeleton-shimmer ${className}`}
      role="status"
      aria-label="Loading"
    />
  )
}

/** Composite page skeleton: header area + content rows. */
export function PageSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      {/* Header */}
      <div className="space-y-2">
        <SkeletonText className="h-6 w-48" />
        <SkeletonText className="h-4 w-72" />
      </div>

      {/* Content cards */}
      <div className="space-y-4">
        <SkeletonRect className="h-32" />
        <SkeletonRect className="h-32" />
        <SkeletonRect className="h-20" />
      </div>
    </div>
  )
}
