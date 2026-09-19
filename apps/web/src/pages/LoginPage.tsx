import { MAIN_CONTENT_ID } from '../a11y/RouteFocusManager'

export default function LoginPage() {
  return (
    <main id={MAIN_CONTENT_ID} tabIndex={-1}>
      <h1>Login</h1>
    </main>
  )
}
