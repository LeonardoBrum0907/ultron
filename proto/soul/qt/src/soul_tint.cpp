#include "soul_tint.h"

#include "soul_generated.h"

#include <algorithm>
#include <cmath>
#include <stdexcept>

namespace soul {

namespace gen = generated;

namespace {

constexpr float kMoodEase = 1.5f; // 1/s, avatar-states.js EASE

std::map<std::string, Palette> makePalettes()
{
    std::map<std::string, Palette> palettes;
    for (const gen::PaletteDef &p : gen::kPalettes) {
        palettes[p.name] = {{p.hot[0], p.hot[1], p.hot[2]}, {p.mid[0], p.mid[1], p.mid[2]}, {p.cool[0], p.cool[1], p.cool[2]}};
    }
    return palettes;
}

const std::map<std::string, Palette> &palettes()
{
    static const std::map<std::string, Palette> all = makePalettes();
    return all;
}

template <typename Map>
std::string namesOf(const Map &map)
{
    std::string names;
    for (const auto &entry : map) names += (names.empty() ? "" : ", ") + entry.first;
    return names;
}

} // namespace

const Palette &paletteOf(const std::string &name)
{
    const auto found = palettes().find(name);
    if (found == palettes().end()) {
        throw std::invalid_argument("unknown soul palette \"" + name + "\", expected one of " + namesOf(palettes()));
    }
    return found->second;
}

AvatarStates builtInStates()
{
    AvatarStates states;
    for (const gen::StateDef &s : gen::kStates) states[s.name] = {s.palette, s.energy, s.pace};
    return states;
}

const AvatarState &stateOf(const std::string &name, const AvatarStates &states)
{
    const auto found = states.find(name);
    if (found == states.end()) {
        throw std::invalid_argument("unknown avatar state \"" + name + "\", expected one of " + namesOf(states));
    }
    paletteOf(found->second.palette);
    return found->second;
}

Tint::Tint(const std::string &start) : was_(start), to_(start), since_(gen::kTintSettle)
{
    paletteOf(start);
}

void Tint::pick(const std::string &name)
{
    paletteOf(name);
    next_ = name == to_ ? std::string() : name;
    if (since_ >= gen::kTintSettle) begin();
}

// A change picked while another runs hurries that one on, then begins from where it ended.
void Tint::tick(float dt)
{
    since_ = std::min(gen::kTintSettle, since_ + dt * (next_.empty() ? 1.0f : gen::kTintHurry));
    if (since_ >= gen::kTintSettle) begin();
}

void Tint::begin()
{
    if (next_.empty()) return;
    was_ = to_;
    to_ = next_;
    next_.clear();
    since_ = 0;
}

Drive Mood::tick(float dt)
{
    const float k = 1 - std::exp(-dt * kMoodEase);
    now_.energy += (target_.energy - now_.energy) * k;
    now_.pace += (target_.pace - now_.pace) * k;
    return now_;
}

} // namespace soul
