import { KNOWN_CATALOGS } from '../data/knownCatalogs'
import { useLandingPrefsStore } from '../store/landingPrefs'

export function StarIcon({ filled, size = 14 }: { filled: boolean; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M12 2.5l2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.3l-5.9 3.3 1.3-6.6L2.5 9.4l6.6-.8z" />
    </svg>
  )
}

/** The star beside the open catalog's name in the explorer header: stars
 *  that catalog (the session root), whatever URL it was opened from, so it
 *  can be found again under the catalog list's Favorites. Stored under the
 *  known list's title when the catalog is a list entry, so the two never
 *  disagree; otherwise under the catalog's own title (`title`, given once
 *  the root has loaded). Unavailable — with the reason, and still
 *  focusable so keyboard users can read it — while the root is loading or
 *  when it failed to load. The accessible name stays fixed and
 *  `aria-pressed` carries the state; only the tooltip names the action. */
export function FavoriteStar({ href, title, failed }: { href: string; title?: string; failed: boolean }) {
  const favorite = useLandingPrefsStore((s) => s.favorites.some((f) => f.href === href))
  const toggleFavorite = useLandingPrefsStore((s) => s.toggleFavorite)
  const name = KNOWN_CATALOGS.find((c) => c.href === href)?.title ?? title
  const tooltip = !name
    ? failed
      ? 'Can’t be added to favorites: the catalog did not load'
      : 'Favorites: available once the catalog has loaded'
    : favorite
      ? 'Remove this catalog from favorites'
      : 'Add this catalog to favorites — find it again in the catalog list'
  return (
    <button
      type="button"
      data-favorite-star
      className="stac-lens-favorite-star"
      aria-label="Favorite this catalog"
      aria-pressed={favorite}
      aria-disabled={!name || undefined}
      title={tooltip}
      onClick={() => name && toggleFavorite({ href, title: name })}
    >
      <StarIcon filled={favorite} size={16} />
    </button>
  )
}
