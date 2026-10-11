/**
 * The password, on a device that is not the PC.
 *
 * Shown in place of the text box when the bridge says this page has to log in
 * (docs/remote.md). One field, the same look as the text box, nothing else on
 * screen: it disappears for good once the bridge has set its cookie.
 */
import { useState } from 'react'
import { login } from '../lib/brain'

type Props = {
  /** Remote access is switched off on the PC, so there is nothing to log in to. */
  off: boolean
  onDone: () => void
}

export function Login({ off, onDone }: Props) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    if (!password || busy) return
    setBusy(true)
    const err = await login(password)
    setBusy(false)
    if (err) {
      setError(err === 'wrong password' ? 'Senha errada' : err)
      setPassword('')
      return
    }
    onDone()
  }

  return (
    <form
      className="textbox"
      onSubmit={(e) => {
        e.preventDefault()
        void submit()
      }}
    >
      <input
        type="password"
        value={password}
        onChange={(e) => {
          setPassword(e.target.value)
          setError('')
        }}
        placeholder={
          off ? 'Acesso remoto desligado no PC' : error || 'Senha do Ultron'
        }
        aria-label="Senha do Ultron"
        disabled={off || busy}
        autoComplete="current-password"
        enterKeyHint="go"
        autoFocus
      />
    </form>
  )
}
