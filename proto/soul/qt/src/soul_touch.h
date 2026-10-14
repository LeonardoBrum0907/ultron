// The cursor on the avatar (a port of proto/soul/touch.js): its recent path, which the
// shader's stir pushes the particles aside along; the wake closes behind it.
#pragma once

#include "soul_generated.h"

#include <array>
#include <deque>

namespace soul {

// The box the soul is drawn in: CSS (logical) px, and how many per world unit.
struct View {
    float width = 1, height = 1, pxPerUnit = 1, yMid = 0;
};

using TrailSample = std::array<float, 4>; // xy where (world units), zw its velocity faded by age

class Touch {
public:
    void move(float xPx, float yPx, const View &view); // logical px from the box's top left
    void tick(float dt);
    // Newest first, as uTrail: where the cursor is now, then its samples.
    std::array<TrailSample, generated::kTrailN> trail() const;

private:
    struct Sample {
        float x, y, vx, vy, at;
    };
    void easeSpeed(float dt);
    void sample();
    float x_ = 0, y_ = -100, dx_ = 0, dy_ = 0, vx_ = 0, vy_ = 0;
    float clock_ = 0, sampledAt_ = 0;
    bool seen_ = false;
    std::deque<Sample> samples_;
};

} // namespace soul
