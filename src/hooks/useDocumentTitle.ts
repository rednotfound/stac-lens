import { useEffect } from 'react'

/** Keeps `document.title` in step with what is on screen — the landing
 *  page's own title, or "<catalog or selected object> · STAC Lens" once a
 *  catalog is open — so a shared `#<href>` link has a readable name in a
 *  browser tab, in history, and wherever it is pasted. */
export function useDocumentTitle(title: string) {
  useEffect(() => {
    document.title = title
  }, [title])
}
