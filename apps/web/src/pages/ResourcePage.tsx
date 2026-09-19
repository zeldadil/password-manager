import { useParams } from 'react-router-dom'

export default function ResourcePage() {
  const { id } = useParams<'id'>()
  return (
    <>
      <h1>Resource</h1>
      <p>{id}</p>
    </>
  )
}
