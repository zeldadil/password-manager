import { useEffect, useState } from 'react'

/**
 * Returns `value`, updated only after it has stopped changing for `delayMs`.
 * Used by VaultPage's search bar (FE-003c) to avoid firing a network request
 * on every keystroke.
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value)

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs)
    return () => clearTimeout(timer)
  }, [value, delayMs])

  return debounced
}
