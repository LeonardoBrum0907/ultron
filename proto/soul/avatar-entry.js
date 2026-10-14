// The drop-in build's entry (vite.avatar.config.js): importing the built file registers
// <soul-avatar>, so a page only needs <script type="module" src="soul-avatar.js">.

import { defineSoulAvatar } from './soul-avatar.js'

export { defineSoulAvatar, SoulAvatarElement } from './soul-avatar.js'
export { AVATAR_STATES } from './avatar-states.js'
export { SOUL_PALETTES } from './palettes.js'

defineSoulAvatar()
