/**
 * Static animation thumbnails.
 *
 * Every animation already declares its intended static frame inside its
 * `@media (prefers-reduced-motion: reduce)` block. Those same rules are
 * mirrored onto a `.anim-static` class trigger in each animation's CSS, so
 * a still preview is just the animation rendered with that class applied.
 * The frozen frame therefore matches the authors' reduced-motion picture by
 * construction - there are no hand-picked timestamps to drift out of sync.
 *
 * `AnimationThumbnail` wraps any animation component in an `.anim-static`
 * container, composing with a caller-supplied className.
 */

export interface AnimationThumbnailProps {
  animation: React.ComponentType
  className?: string
}

export function AnimationThumbnail({
  animation: Animation,
  className
}: AnimationThumbnailProps): React.ReactNode {
  return (
    <div className={className ? `anim-static ${className}` : 'anim-static'}>
      <Animation />
    </div>
  )
}
