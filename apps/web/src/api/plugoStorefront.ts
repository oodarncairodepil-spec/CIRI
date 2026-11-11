// Plugo Storefront API — calls go through the local mock-api proxy at /api/plugo/*
// The proxy injects the store key server-side, avoiding CORS issues in dev.

const BASE = '/api/plugo'

async function get<T>(path: string, params?: Record<string, string | number>): Promise<T> {
  const qs = params ? '?' + new URLSearchParams(
    Object.entries(params).map(([k, v]) => [k, String(v)])
  ).toString() : ''
  const res = await fetch(`${BASE}/${path}${qs}`)
  if (!res.ok) {
    let msg = res.statusText
    try { const b = await res.json(); if (b.error) msg = b.error } catch {}
    throw new Error(msg)
  }
  return res.json()
}

export interface PlugoStoreInfo {
  name: string
  currency: string
  logo?: string
  isClosed: boolean
  checkoutBaseUrl: string
}

export interface PlugoProductSummary {
  id: number
  name: string
  image?: string
  price: number
  compareAtPrice?: number
  soldOut: boolean
}

export interface PlugoVariant {
  id: number
  price: number
  compareAtPrice?: number
  weight?: number
  stock?: number
  options: { name: string; value: string }[]
}

export interface PlugoProductDetail extends PlugoProductSummary {
  description?: string
  shortDescription?: string
  images: string[]
  variants: PlugoVariant[]
}

export interface PlugoCategory {
  id: number
  name: string
  image?: string
}

export const plugoStorefront = {
  getStore(): Promise<PlugoStoreInfo> {
    return get('store')
  },
  getCategories(): Promise<{ items: PlugoCategory[] }> {
    return get('categories')
  },
  getProducts(params?: { limit?: number; offset?: number; q?: string; categoryId?: number }): Promise<{ total: number; items: PlugoProductSummary[] }> {
    return get('products', params as Record<string, string | number>)
  },
  getProduct(id: number): Promise<PlugoProductDetail> {
    return get(`products/${id}`)
  },
  checkoutUrl(checkoutBaseUrl: string, items: { productId: number; variantId: number; quantity: number }[], returnUrl?: string): string {
    const sku = btoa(items.map(i => `${i.productId}:${i.variantId}:${i.quantity}`).join(','))
    const url = new URL(`${checkoutBaseUrl}/buy`)
    url.searchParams.set('sku', sku)
    if (returnUrl) url.searchParams.set('return_url', returnUrl)
    return url.toString()
  },
}
