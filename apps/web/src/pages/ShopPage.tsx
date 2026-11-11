import { useState, useMemo } from 'react'
import { useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Spinner } from '@/components/common/Spinner'
import { plugoStorefront } from '@/api/plugoStorefront'
import type { PlugoProductSummary, PlugoStoreInfo } from '@/api/plugoStorefront'

// ── Design tokens (From This Island — Dawn theme) ────────────────────────────
const BRAND = '#3b492c'
const BRAND_LIGHT = '#446246'
const BG_CARD = '#f3f3f3'
const TEXT = 'rgba(18,18,18,0.75)'
const TEXT_DARK = 'rgb(18,18,18)'
const FONT = '"Assistant", sans-serif'

// ── Cart ─────────────────────────────────────────────────────────────────────
interface CartItem { productId: number; variantId: number; name: string; price: number; qty: number }

function formatIDR(amount: number) {
  return 'IDR ' + amount.toLocaleString('id-ID')
}

// ── Product card ─────────────────────────────────────────────────────────────
function ProductCard({ product, onClick }: { product: PlugoProductSummary; onClick: (p: PlugoProductSummary) => void }) {
  const isOnSale = !!product.compareAtPrice
  const [hovered, setHovered] = useState(false)

  return (
    <div
      style={{ fontFamily: FONT, cursor: 'pointer' }}
      onClick={() => onClick(product)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Image area */}
      <div style={{
        position: 'relative',
        background: BG_CARD,
        borderRadius: '1.4rem',
        overflow: 'hidden',
        aspectRatio: '2/3',
        marginBottom: '1.2rem',
      }}>
        {product.image ? (
          <img
            src={product.image}
            alt={product.name}
            loading="lazy"
            style={{
              width: '100%', height: '100%', objectFit: 'cover', display: 'block',
              transform: hovered ? 'scale(1.05)' : 'scale(1)',
              transition: 'transform 0.4s ease',
            }}
          />
        ) : (
          <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="48" height="48" fill="none" viewBox="0 0 24 24" stroke={BRAND} strokeWidth={0.5} opacity={0.3}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          </div>
        )}

        {/* Badges bottom-left */}
        {product.soldOut && (
          <span style={{
            position: 'absolute', bottom: '1rem', left: '1rem',
            background: TEXT_DARK, color: '#fff',
            fontSize: '1.1rem', fontWeight: 400, letterSpacing: '0.08em',
            padding: '0.3rem 1rem', borderRadius: '4rem',
          }}>Sold out</span>
        )}
        {isOnSale && !product.soldOut && (
          <span style={{
            position: 'absolute', bottom: '1rem', left: '1rem',
            background: BRAND, color: '#fff',
            fontSize: '1.1rem', fontWeight: 400, letterSpacing: '0.08em',
            padding: '0.3rem 1rem', borderRadius: '4rem',
          }}>Sale</span>
        )}

        {/* Quick-add overlay on hover */}
        {!product.soldOut && (
          <div style={{
            position: 'absolute', bottom: 0, left: 0, right: 0,
            background: 'rgba(255,255,255,0.95)',
            padding: '1.2rem',
            transform: hovered ? 'translateY(0)' : 'translateY(100%)',
            transition: 'transform 0.3s ease',
            textAlign: 'center',
            fontSize: '1.3rem',
            fontWeight: 400,
            letterSpacing: '0.08em',
            color: TEXT_DARK,
          }}>
            Add to cart
          </div>
        )}
      </div>

      {/* Card info */}
      <div>
        <h3 style={{
          margin: '0 0 0.3rem',
          fontSize: '1.4rem',
          fontWeight: 200,
          color: TEXT_DARK,
          lineHeight: 1.3,
          letterSpacing: '0.03em',
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
        }}>
          {product.name}
        </h3>

        <div style={{ marginTop: '0.4rem', fontSize: '1.4rem', color: TEXT }}>
          {isOnSale ? (
            <>
              <s style={{ color: TEXT, opacity: 0.6, marginRight: '0.6rem' }}>{formatIDR(product.compareAtPrice!)}</s>
              <span style={{ color: BRAND, fontWeight: 200 }}>{formatIDR(product.price)}</span>
            </>
          ) : (
            <span>{formatIDR(product.price)}</span>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Cart drawer ───────────────────────────────────────────────────────────────
const qtyBtnStyle: React.CSSProperties = {
  width: '2.8rem', height: '2.8rem', border: '1px solid rgba(18,18,18,0.2)',
  background: '#fff', cursor: 'pointer', fontSize: '1.4rem',
  display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 0,
}

function CartDrawer({ items, store, onClose, onQtyChange, onRemove }: {
  items: CartItem[]
  store: PlugoStoreInfo
  onClose: () => void
  onQtyChange: (productId: number, qty: number) => void
  onRemove: (productId: number) => void
}) {
  const total = items.reduce((s, i) => s + i.price * i.qty, 0)
  const checkoutUrl = items.length > 0
    ? plugoStorefront.checkoutUrl(store.checkoutBaseUrl, items.map(i => ({ productId: i.productId, variantId: i.variantId, quantity: i.qty })))
    : '#'

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 100, display: 'flex', justifyContent: 'flex-end', fontFamily: FONT }}>
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(18,18,18,0.3)' }} onClick={onClose} />
      <div style={{
        position: 'relative', zIndex: 1, background: '#fff', width: '100%', maxWidth: 420,
        display: 'flex', flexDirection: 'column', height: '100%',
        borderLeft: '1px solid rgba(18,18,18,0.1)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '2rem 2.4rem', borderBottom: '1px solid rgba(18,18,18,0.1)' }}>
          <span style={{ fontSize: '1.6rem', fontWeight: 200, color: TEXT_DARK, letterSpacing: '0.06em' }}>
            Your cart ({items.reduce((s, i) => s + i.qty, 0)})
          </span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '2rem', color: TEXT, lineHeight: 1 }}>✕</button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '2rem 2.4rem' }}>
          {items.length === 0 ? (
            <p style={{ color: TEXT, fontSize: '1.4rem', textAlign: 'center', marginTop: '4rem' }}>Your cart is empty.</p>
          ) : items.map(item => (
            <div key={item.productId} style={{ display: 'flex', gap: '1.6rem', marginBottom: '2.4rem', alignItems: 'flex-start' }}>
              <div style={{ flex: 1 }}>
                <p style={{ margin: '0 0 0.4rem', fontSize: '1.4rem', fontWeight: 200, color: TEXT_DARK, lineHeight: 1.3 }}>{item.name}</p>
                <p style={{ margin: 0, fontSize: '1.3rem', color: TEXT }}>{formatIDR(item.price)}</p>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.8rem', flexShrink: 0 }}>
                <button onClick={() => onQtyChange(item.productId, item.qty - 1)} style={qtyBtnStyle}>−</button>
                <span style={{ fontSize: '1.4rem', minWidth: '1.6rem', textAlign: 'center' }}>{item.qty}</span>
                <button onClick={() => onQtyChange(item.productId, item.qty + 1)} style={qtyBtnStyle}>+</button>
                <button onClick={() => onRemove(item.productId)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.2rem', color: TEXT, opacity: 0.4, marginLeft: '0.4rem' }}>✕</button>
              </div>
            </div>
          ))}
        </div>

        <div style={{ padding: '2rem 2.4rem', borderTop: '1px solid rgba(18,18,18,0.1)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1.6rem', fontSize: '1.4rem', color: TEXT_DARK }}>
            <span style={{ fontWeight: 200 }}>Subtotal (estimated)</span>
            <span style={{ fontWeight: 200 }}>{formatIDR(total)}</span>
          </div>
          <a
            href={store.isClosed ? undefined : checkoutUrl}
            style={{
              display: 'block', width: '100%', padding: '1.6rem',
              background: store.isClosed ? '#aaa' : BRAND,
              color: '#fff', textAlign: 'center',
              fontSize: '1.3rem', fontFamily: FONT, fontWeight: 200,
              letterSpacing: '0.08em', textDecoration: 'none',
              pointerEvents: store.isClosed ? 'none' : 'auto',
            }}
            onMouseEnter={e => { if (!store.isClosed) (e.currentTarget as HTMLAnchorElement).style.background = BRAND_LIGHT }}
            onMouseLeave={e => { if (!store.isClosed) (e.currentTarget as HTMLAnchorElement).style.background = BRAND }}
          >
            {store.isClosed ? 'Store closed' : 'Checkout'}
          </a>
          <p style={{ fontSize: '1.1rem', color: TEXT, textAlign: 'center', marginTop: '1.2rem', letterSpacing: '0.04em' }}>
            Shipping &amp; taxes calculated at checkout
          </p>
        </div>
      </div>
    </div>
  )
}

// ── Sort options ──────────────────────────────────────────────────────────────
type SortKey = 'alpha-asc' | 'alpha-desc' | 'price-asc' | 'price-desc'
const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'alpha-asc', label: 'Alphabetically, A-Z' },
  { value: 'alpha-desc', label: 'Alphabetically, Z-A' },
  { value: 'price-asc', label: 'Price, low to high' },
  { value: 'price-desc', label: 'Price, high to low' },
]

// ── Main page ─────────────────────────────────────────────────────────────────
const PAGE_SIZE = 24
const NAV_LINKS = ['Shop', 'Our Story', 'Ingredients', 'Impact', 'LUMERA™', 'Blog', 'Press']

export function ShopPage() {
  const { id = '' } = useParams<{ id: string }>()

  const [cart, setCart] = useState<CartItem[]>([])
  const [cartOpen, setCartOpen] = useState(false)
  const [page, setPage] = useState(0)
  const [sortBy, setSortBy] = useState<SortKey>('alpha-asc')

  const { data: storeData, isLoading: storeLoading, error: storeError } = useQuery({
    queryKey: ['plugo-store'],
    queryFn: () => plugoStorefront.getStore(),
    retry: 1,
  })

  const { data: productsData, isLoading: productsLoading } = useQuery({
    queryKey: ['plugo-products', page],
    queryFn: () => plugoStorefront.getProducts({ limit: PAGE_SIZE, offset: page * PAGE_SIZE }),
    enabled: !!storeData,
    retry: 1,
  })

  const products = useMemo(() => {
    const items = productsData?.items ?? []
    return [...items].sort((a, b) => {
      if (sortBy === 'alpha-asc') return a.name.localeCompare(b.name)
      if (sortBy === 'alpha-desc') return b.name.localeCompare(a.name)
      if (sortBy === 'price-asc') return a.price - b.price
      return b.price - a.price
    })
  }, [productsData, sortBy])

  function addToCart(product: PlugoProductSummary) {
    setCart(prev => {
      const existing = prev.find(i => i.productId === product.id)
      if (existing) return prev.map(i => i.productId === product.id ? { ...i, qty: i.qty + 1 } : i)
      return [...prev, { productId: product.id, variantId: product.id, name: product.name, price: product.price, qty: 1 }]
    })
    setCartOpen(true)
  }

  function changeQty(productId: number, qty: number) {
    if (qty <= 0) setCart(prev => prev.filter(i => i.productId !== productId))
    else setCart(prev => prev.map(i => i.productId === productId ? { ...i, qty } : i))
  }

  const totalItems = cart.reduce((s, i) => s + i.qty, 0)
  const totalProducts = productsData?.total ?? 0
  const totalPages = Math.ceil(totalProducts / PAGE_SIZE)

  if (storeLoading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', gap: 16, fontFamily: FONT }}>
        <Spinner size="lg" />
        <p style={{ fontSize: '1.4rem', color: TEXT }}>Loading store…</p>
      </div>
    )
  }

  if (storeError || !storeData) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', gap: 12, fontFamily: FONT, padding: '0 2rem', textAlign: 'center' }}>
        <p style={{ fontSize: '1.6rem', color: '#c0392b', fontWeight: 200 }}>Could not connect to Plugo store</p>
        <p style={{ fontSize: '1.3rem', color: TEXT, maxWidth: 400 }}>
          {(storeError as Error)?.message ?? 'Unknown error'}<br />
          Make sure your Plugo Store Key is set in Settings.
        </p>
        <a href={`/projects/${id}`} style={{ fontSize: '1.3rem', color: BRAND, textDecoration: 'underline' }}>← Back to project</a>
      </div>
    )
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', background: '#fff', color: TEXT, fontFamily: FONT, fontSize: '1.6rem', fontWeight: 200 }}>

      {/* Google Font - Assistant */}
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Assistant:wght@200;400;500;700&display=swap');
        * { box-sizing: border-box; }
        body { margin: 0; }
      `}</style>

      {/* Announcement bar */}
      <div style={{ background: BRAND, color: 'rgba(255,255,255,0.75)', textAlign: 'center', padding: '1rem 2rem', fontSize: '1.3rem', letterSpacing: '0.06em', fontWeight: 200 }}>
        Get FREE SHIPPING on orders over 200k up to 15k
      </div>

      {/* Header */}
      <header style={{ background: '#fff', borderBottom: '1px solid rgba(18,18,18,0.08)', padding: '0 4rem' }}>
        <div style={{ maxWidth: '130rem', margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: '8rem' }}>
          {/* Logo */}
          <a href="/" style={{ display: 'flex', alignItems: 'center', textDecoration: 'none', flexShrink: 0 }}>
            <img
              src="https://fromthisisland.com/cdn/shop/files/Logo-fti.png?v=1697782683&width=120"
              alt="From This Island"
              style={{ height: '3rem', width: 'auto', objectFit: 'contain' }}
            />
          </a>

          {/* Nav */}
          <nav style={{ display: 'flex', gap: '2.8rem' }}>
            {NAV_LINKS.map(link => (
              <span key={link} style={{ fontSize: '1.4rem', fontWeight: 200, color: TEXT, letterSpacing: '0.06em', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                {link}
              </span>
            ))}
          </nav>

          {/* Account + Cart */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '2rem', flexShrink: 0 }}>
            <span style={{ fontSize: '1.4rem', color: TEXT, letterSpacing: '0.06em', cursor: 'pointer' }}>Account</span>
            <button
              onClick={() => setCartOpen(true)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.4rem', color: TEXT, letterSpacing: '0.06em', fontFamily: FONT, fontWeight: 200, padding: 0 }}
            >
              Bag ({totalItems})
            </button>
          </div>
        </div>
      </header>

      {/* Page content */}
      <main style={{ flex: 1, maxWidth: '130rem', margin: '0 auto', padding: '4rem 4rem 8rem', width: '100%' }}>

        {/* Page heading */}
        <h1 style={{ margin: '0 0 3rem', fontSize: '2.4rem', fontWeight: 200, color: TEXT_DARK, letterSpacing: '0.03em' }}>
          Products
        </h1>

        {/* Sort / filter toolbar */}
        {!productsLoading && totalProducts > 0 && (
          <div style={{
            display: 'flex',
            justifyContent: 'flex-end',
            alignItems: 'center',
            gap: '2rem',
            marginBottom: '2rem',
            paddingBottom: '1.2rem',
            borderBottom: '1px solid rgba(18,18,18,0.08)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.8rem' }}>
              <label style={{ fontSize: '1.3rem', color: TEXT, letterSpacing: '0.04em', whiteSpace: 'nowrap' }}>Sort by:</label>
              <select
                value={sortBy}
                onChange={e => setSortBy(e.target.value as SortKey)}
                style={{
                  fontSize: '1.3rem',
                  fontFamily: FONT,
                  fontWeight: 200,
                  color: TEXT_DARK,
                  background: 'transparent',
                  border: 'none',
                  borderBottom: '1px solid rgba(18,18,18,0.3)',
                  cursor: 'pointer',
                  padding: '0.2rem 2rem 0.2rem 0',
                  outline: 'none',
                  letterSpacing: '0.03em',
                  appearance: 'none',
                  backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'%3E%3Cpath d='M1 1l5 5 5-5' stroke='%23121212' stroke-width='1.5' fill='none' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E")`,
                  backgroundRepeat: 'no-repeat',
                  backgroundPosition: 'right 0 center',
                }}
              >
                {SORT_OPTIONS.map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>
            <span style={{ fontSize: '1.3rem', color: TEXT, letterSpacing: '0.04em', whiteSpace: 'nowrap' }}>
              {totalProducts} products
            </span>
          </div>
        )}

        {/* Product grid */}
        {productsLoading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '8rem 0' }}><Spinner size="lg" /></div>
        ) : products.length === 0 ? (
          <p style={{ textAlign: 'center', padding: '8rem 0', color: TEXT, fontSize: '1.5rem' }}>No products found.</p>
        ) : (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px 20px' }}>
              {products.map(p => (
                <ProductCard key={p.id} product={p} onClick={addToCart} />
              ))}
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <nav style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '0.8rem', marginTop: '6rem' }}>
                {page > 0 && (
                  <button
                    onClick={() => { setPage(p => p - 1); window.scrollTo(0, 0) }}
                    style={{ padding: '0.8rem 1.6rem', fontSize: '1.3rem', fontFamily: FONT, fontWeight: 200, color: TEXT, background: 'transparent', border: '1px solid rgba(18,18,18,0.2)', cursor: 'pointer', letterSpacing: '0.04em', borderRadius: 0 }}
                  >← Previous</button>
                )}
                {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => (
                  <button key={i} onClick={() => { setPage(i); window.scrollTo(0, 0) }} style={{
                    padding: '0.8rem 1.6rem', fontSize: '1.3rem', fontFamily: FONT, fontWeight: 200,
                    color: i === page ? '#fff' : TEXT,
                    background: i === page ? BRAND : 'transparent',
                    border: `1px solid ${i === page ? BRAND : 'rgba(18,18,18,0.2)'}`,
                    cursor: 'pointer', letterSpacing: '0.04em', borderRadius: 0,
                  }}>
                    {i + 1}
                  </button>
                ))}
                {page < totalPages - 1 && (
                  <button
                    onClick={() => { setPage(p => p + 1); window.scrollTo(0, 0) }}
                    style={{ padding: '0.8rem 1.6rem', fontSize: '1.3rem', fontFamily: FONT, fontWeight: 200, color: TEXT, background: 'transparent', border: '1px solid rgba(18,18,18,0.2)', cursor: 'pointer', letterSpacing: '0.04em', borderRadius: 0 }}
                  >Next →</button>
                )}
              </nav>
            )}
          </>
        )}
      </main>

      {/* Footer */}
      <footer style={{ background: BRAND, color: 'rgba(255,255,255,0.75)', padding: '4.8rem 4rem', fontFamily: FONT }}>
        <div style={{ maxWidth: '130rem', margin: '0 auto' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '3.2rem' }}>
            <div>
              <img
                src="https://fromthisisland.com/cdn/shop/files/Logo-fti.png?v=1697782683&width=120"
                alt="From This Island"
                style={{ height: '2.4rem', width: 'auto', objectFit: 'contain', filter: 'brightness(0) invert(1)', marginBottom: '1.6rem', display: 'block' }}
              />
              <p style={{ fontSize: '1.3rem', lineHeight: 1.6, letterSpacing: '0.04em', margin: 0 }}>
                Official online store of From This Island — a whole new skincare experience, rooted in our homeland.
              </p>
            </div>
            <div>
              <h4 style={{ margin: '0 0 1.6rem', fontWeight: 200, fontSize: '1.4rem', color: '#fff', letterSpacing: '0.08em' }}>Quick Links</h4>
              {['Shop', 'Our Story', 'Ingredients', 'Press'].map(l => (
                <p key={l} style={{ margin: '0 0 0.8rem', fontSize: '1.3rem', letterSpacing: '0.04em', cursor: 'pointer' }}>{l}</p>
              ))}
            </div>
            <div>
              <h4 style={{ margin: '0 0 1.6rem', fontWeight: 200, fontSize: '1.4rem', color: '#fff', letterSpacing: '0.08em' }}>Help</h4>
              {['Shipping Info', 'Returns', 'FAQ', 'Contact'].map(l => (
                <p key={l} style={{ margin: '0 0 0.8rem', fontSize: '1.3rem', letterSpacing: '0.04em', cursor: 'pointer' }}>{l}</p>
              ))}
            </div>
            <div>
              <h4 style={{ margin: '0 0 1.6rem', fontWeight: 200, fontSize: '1.4rem', color: '#fff', letterSpacing: '0.08em' }}>Follow Us</h4>
              {['Instagram', 'TikTok', 'Facebook', 'YouTube'].map(l => (
                <p key={l} style={{ margin: '0 0 0.8rem', fontSize: '1.3rem', letterSpacing: '0.04em', cursor: 'pointer' }}>{l}</p>
              ))}
            </div>
          </div>
          <div style={{ borderTop: '1px solid rgba(255,255,255,0.1)', marginTop: '4rem', paddingTop: '2.4rem', display: 'flex', justifyContent: 'space-between', fontSize: '1.1rem', letterSpacing: '0.04em' }}>
            <span>© {new Date().getFullYear()} From This Island</span>
            <span>Cloned with Plugo Cloner · Powered by Plugo</span>
          </div>
        </div>
      </footer>

      {/* Cart drawer */}
      {cartOpen && storeData && (
        <CartDrawer
          items={cart}
          store={storeData}
          onClose={() => setCartOpen(false)}
          onQtyChange={changeQty}
          onRemove={id => setCart(prev => prev.filter(i => i.productId !== id))}
        />
      )}
    </div>
  )
}
