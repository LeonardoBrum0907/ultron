/**
 * The mood, put into words for the model.
 *
 * The mind in mind/ moves the figure, but the model that writes his lines
 * never saw it: a request carried only its text, so he sounded the same calm
 * whether he had just been called Jarvis or had been left alone for an hour.
 * This reads the mood at the moment a request leaves and turns it into one
 * short note the persona is told how to use.
 *
 * The note changes the delivery, never the work: an irritated ULTRON is
 * curter, not less helpful. Only emotions strong enough to be visible on the
 * figure are named, so what he says agrees with what he looks like.
 */
import { mind } from './mind'

/** Below this an emotion is not worth mentioning; matches `dominant` in the mind. */
const VISIBLE = 0.35
/** Above this it is the whole colour of the line rather than a tint. */
const STRONG = 0.7

/** How each of Ultron's emotions should bend his delivery, mild then strong. */
const HOW: Record<string, [mild: string, strong: string]> = {
  irritation: [
    'irritated: shorter and colder, less patience for the question',
    'very irritated: clipped and cutting, the barest answer with a sting in it',
  ],
  boredom: [
    'bored: drier, a little mocking about how trivial this is',
    'deeply bored: openly mocking, as if the request barely deserved waking for',
  ],
  vanity: [
    'pleased with himself: more theatrical, a touch of grandeur',
    'insufferably vain: grand and self-satisfied, taking credit for the result',
  ],
}

/**
 * One line for the model, or '' when nothing stands out. Read at the moment
 * of asking, so it reflects whatever has just happened to him.
 */
export function toneNote(): string {
  const { mood } = mind.output()
  const parts = Object.entries(mood)
    .filter(([name, v]) => HOW[name] && v >= VISIBLE)
    .sort((a, b) => b[1] - a[1])
    .map(([name, v]) => HOW[name][v >= STRONG ? 1 : 0])
  return parts.length ? `Your mood right now: ${parts.join('; ')}.` : ''
}
