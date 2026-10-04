/**
 * Talking to him by typing.
 *
 * The voice is the main way in, but not always the one at hand: a quiet room,
 * a microphone that hears badly, or a voice that costs credits. A typed line
 * goes through exactly the same turn as a spoken one. The switch beside it
 * turns his voice off, so the whole conversation can happen on screen.
 */
import { useState } from 'react'
import { useStore } from '../store'
import { isMuted, setMuted } from '../lib/tts'

type Props = {
  /** A line the user typed and sent. */
  onSend: (text: string) => void
  /** The voice was switched off (true) or back on. */
  onMute: (muted: boolean) => void
}

export function TextBox({ onSend, onMute }: Props) {
  const phase = useStore((s) => s.phase)
  const [text, setText] = useState('')
  const [muted, setMutedState] = useState(isMuted)
  // Until he is powered on there is no turn to start: the click on the dust
  // is also what unlocks audio, so it stays the way in.
  const asleep = phase === 'offline' || phase === 'boot'

  const send = () => {
    const said = text.trim()
    if (!said || asleep) return
    setText('')
    onSend(said)
  }

  const toggle = () => {
    const next = !muted
    setMuted(next)
    setMutedState(next)
    onMute(next)
  }

  return (
    <form
      className="textbox"
      onSubmit={(e) => {
        e.preventDefault()
        send()
      }}
    >
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => e.key === 'Escape' && e.currentTarget.blur()}
        placeholder={asleep ? 'Clique na poeira para ligar' : 'Escreva para o Ultron'}
        aria-label="Mensagem para o Ultron"
        disabled={asleep}
        enterKeyHint="send"
        autoComplete="off"
      />
      <button
        type="button"
        className={`textbox-mute${muted ? ' on' : ''}`}
        onClick={toggle}
        aria-pressed={muted}
        title={muted ? 'Ligar a voz' : 'Desligar a voz'}
      >
        {muted ? 'voz off' : 'voz on'}
      </button>
    </form>
  )
}
