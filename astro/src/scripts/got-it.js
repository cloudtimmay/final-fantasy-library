// Shared "Got it" handler: flips a wishlist item to owned and swaps the badge.
// Used on albums, games, books and figures list pages.
export function initGotIt() {
  document.querySelectorAll('.got-btn').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.preventDefault()
      const id = btn.dataset.id
      btn.disabled = true
      const original = btn.textContent
      btn.textContent = '…'
      try {
        const res = await fetch('/api/item-status', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id, status: 'owned' }),
        })
        if (!res.ok) {
          btn.disabled = false
          btn.textContent = 'Retry'
          return
        }
        // Swap the wishlist badge to OWNED and remove the button.
        const wrap = btn.closest('[data-wishlist="yes"]')
        if (wrap) {
          wrap.dataset.wishlist = 'no'
          const badge = wrap.querySelector('.wishlist-tag')
          if (badge) {
            badge.textContent = 'OWNED'
            badge.classList.remove('wishlist-tag')
            badge.classList.add('owned-tag')
          }
        }
        btn.remove()
      } catch {
        btn.disabled = false
        btn.textContent = original
      }
    })
  })
}