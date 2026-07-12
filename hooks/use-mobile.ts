import * as React from "react"

const MOBILE_BREAKPOINT = 768

// Subscribe to viewport-width changes via matchMedia. Implemented with
// useSyncExternalStore — the correct primitive for external state —
// instead of a setState-in-effect (react-hooks/set-state-in-effect).
function subscribe(callback: () => void) {
  const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
  mql.addEventListener("change", callback)
  return () => mql.removeEventListener("change", callback)
}

export function useIsMobile() {
  return React.useSyncExternalStore(
    subscribe,
    () => window.innerWidth < MOBILE_BREAKPOINT,
    // Server snapshot: desktop-first, same as the old `undefined → false`.
    () => false
  )
}
