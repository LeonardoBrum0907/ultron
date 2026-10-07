/**
 * Talking to him by typing.
 *
 * The voice is the main way in, but not always the one at hand: a quiet room,
 * a microphone that hears badly, or a voice that costs credits. A typed line
 * goes through exactly the same turn as a spoken one. The two switches beside
 * it are independent: the mic one stops him listening, so you type and he can
 * still answer aloud; the voice one turns his voice off, so he answers on
 * screen. Both off, the whole conversation happens in text.
 */
import { useState } from 'react'
import { useStore } from '../store'
import { isMuted, setMuted } from '../lib/tts'
import { isMicOn } from '../lib/audio'

type Props = {
  /** A line the user typed and sent. */
  onSend: (text: string) => void
  /** The voice was switched off (true) or back on. */
  onMute: (muted: boolean) => void
  /** The microphone was switched on (true) or off. */
  onMic: (on: boolean) => void
}

export function TextBox({ onSend, onMute, onMic }: Props) {
  const phase = useStore((s) => s.phase)
  const [text, setText] = useState('')
  const [muted, setMutedState] = useState(isMuted)
  const [mic, setMic] = useState(isMicOn)
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

  const toggleMic = () => {
    const next = !mic
    setMic(next)
    onMic(next)
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
        className={`textbox-mute${mic ? '' : ' on'}`}
        onClick={toggleMic}
        aria-pressed={!mic}
        title={mic ? 'Desligar o microfone' : 'Ligar o microfone'}
      >
        {mic ? 'mic on' : 'mic off'}
      </button>
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
