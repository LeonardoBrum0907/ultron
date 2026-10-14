// The avatar's colour and state (ports of proto/soul/tint.js and avatar-states.js): a new
// colour climbs from the heart up through the fire (the shader does that, from the palette
// it was, the one it becomes and uShift), and the fire's energy and pace ease to the state's.
#pragma once

#include "soul_generated.h"

#include <array>
#include <map>
#include <string>

namespace soul {

struct Rgb {
    float r, g, b;
};

struct Palette {
    Rgb hot, mid, cool;
};

// What a project tells the soul it is doing: its colour (a palette name), how high and
// bright the fire burns (0..1) and how fast it moves (1 = the soul page's own pace).
struct AvatarState {
    std::string palette;
    float energy = 0;
    float pace = 1;
};

using AvatarStates = std::map<std::string, AvatarState>;

// The palette by name; throws std::invalid_argument naming the palettes there are.
const Palette &paletteOf(const std::string &name);

// How much of each palette (in generated::kPalettes order) the fire is: uMix and uMixWas.
using Mix = std::array<float, generated::kPaletteCount>;

// All of the palette named, none of the others; throws as paletteOf does.
Mix allOf(const std::string &palette);

// calm, thinking, angry, happy, as on the web avatar.
AvatarStates builtInStates();

// A state by name; throws std::invalid_argument naming the states there are.
const AvatarState &stateOf(const std::string &name, const AvatarStates &states);

class Tint {
public:
    explicit Tint(const std::string &start);
    void pick(const std::string &name); // a palette name; waits if a change is running
    void tick(float dt);
    Mix was() const { return allOf(was_); }
    Mix to() const { return allOf(to_); }
    float since() const { return since_; } // s since the change began: uShift

private:
    void begin();
    std::string was_, to_, next_;
    float since_;
};

struct Drive {
    float energy, pace;
};

// The fire's energy and pace, easing towards a new state's so a change is never a jump.
class Mood {
public:
    explicit Mood(const AvatarState &start) : now_{start.energy, start.pace}, target_{start.energy, start.pace} {}
    void aim(const AvatarState &state) { target_ = {state.energy, state.pace}; }
    Drive tick(float dt);

private:
    Drive now_, target_;
};

} // namespace soul
