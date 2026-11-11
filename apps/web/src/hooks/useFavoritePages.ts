import { useState, useCallback } from 'react'

export interface FavoritePage {
  id: string
  displayId: string
  url: string
  pageType: string
}

function storageKey(projectId: string) {
  return `plugo-cloner:favorites:${projectId}`
}

export function useFavoritePages(projectId: string) {
  const key = storageKey(projectId)

  const [favorites, setFavorites] = useState<FavoritePage[]>(() => {
    try { return JSON.parse(localStorage.getItem(key) ?? '[]') } catch { return [] }
  })

  const toggle = useCallback((page: FavoritePage) => {
    setFavorites(prev => {
      const already = prev.some(f => f.id === page.id)
      const next = already ? prev.filter(f => f.id !== page.id) : [...prev, page]
      try { localStorage.setItem(key, JSON.stringify(next)) } catch {}
      return next
    })
  }, [key])

  const isFavorite = useCallback((id: string) => favorites.some(f => f.id === id), [favorites])

  return { favorites, toggle, isFavorite }
}
