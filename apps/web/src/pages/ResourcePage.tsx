import { useParams } from 'react-router-dom'

export default function ResourcePage() {
  const { id } = useParams<'id'>()
  return (
    <main>
      <h1>Resource</h1>
      <p>{id}</p>
    </main>
  )
}
