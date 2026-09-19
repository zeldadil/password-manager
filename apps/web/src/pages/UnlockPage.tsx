import { MAIN_CONTENT_ID } from '../a11y/RouteFocusManager'

export default function UnlockPage() {
  return (
    <main id={MAIN_CONTENT_ID} tabIndex={-1}>
      <h1>Unlock</h1>
    </main>
  )
}
