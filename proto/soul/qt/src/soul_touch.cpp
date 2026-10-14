#include "soul_touch.h"

#include <algorithm>
#include <cmath>

namespace soul {

namespace {
// touch.js
constexpr float kSpeedEase = 10; // how quickly the cursor's measured speed follows it, 1/s
constexpr float kSpeedMax = 8;   // world units/s the wake takes from the cursor at most
constexpr float kTrailStep = 0.06f; // s between the path's samples
constexpr float kTrailFade = 0.45f; // s for a sample's wake to close
} // namespace

void Touch::move(float xPx, float yPx, const View &view)
{
    // Screen y runs down; the soul's runs up.
    const float x = (xPx - view.width / 2) / view.pxPerUnit;
    const float y = view.yMid - (yPx - view.height / 2) / view.pxPerUnit;
    if (seen_) {
        dx_ += x - x_;
        dy_ += y - y_;
    }
    x_ = x, y_ = y, seen_ = true;
}

void Touch::tick(float dt)
{
    clock_ += dt;
    easeSpeed(dt);
    sample();
}

void Touch::easeSpeed(float dt)
{
    const float k = std::min(1.0f, dt * kSpeedEase);
    const float step = std::max(dt, 1e-3f);
    vx_ += (dx_ / step - vx_) * k;
    vy_ += (dy_ / step - vy_) * k;
    dx_ = dy_ = 0;
}

// Every kTrailStep the cursor leaves a sample of where it is and how fast it goes.
void Touch::sample()
{
    if (clock_ - sampledAt_ < kTrailStep) return;
    sampledAt_ = clock_;
    const float speed = std::hypot(vx_, vy_);
    const float k = speed > kSpeedMax ? kSpeedMax / speed : 1;
    samples_.push_front({x_, y_, vx_ * k, vy_ * k, clock_});
    while (int(samples_.size()) > generated::kTrailN - 1) samples_.pop_back();
}

std::array<TrailSample, generated::kTrailN> Touch::trail() const
{
    std::array<TrailSample, generated::kTrailN> out;
    out[0] = {x_, y_, vx_, vy_};
    for (int i = 1; i < generated::kTrailN; ++i) {
        if (i - 1 >= int(samples_.size())) {
            out[i] = {0, -100, 0, 0};
            continue;
        }
        const Sample &s = samples_[i - 1];
        const float fade = std::exp(-(clock_ - s.at) / kTrailFade);
        out[i] = {s.x, s.y, s.vx * fade, s.vy * fade};
    }
    return out;
}

} // namespace soul
