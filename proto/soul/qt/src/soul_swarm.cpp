#include "soul_swarm.h"

#include "soul_generated.h"

#include <algorithm>
#include <cmath>

namespace soul {

namespace gen = generated;

double SeededRandom::next()
{
    // Unsigned 32-bit arithmetic wraps exactly like Math.imul and JS's int32 operators.
    a_ += 0x6d2b79f5u;
    uint32_t t = (a_ ^ (a_ >> 15)) * (1u | a_);
    t = (t + (t ^ (t >> 7)) * (61u | t)) ^ t;
    return double(t ^ (t >> 14)) / 4294967296.0;
}

namespace {

// swarm.js routeOf: which current carries a particle and its lane (only used in flight,
// which the avatar never shows, but kept so the numbers match the page's).
void route(int part, const double r[4], double &current, double &lane)
{
    if (part == 0) {
        current = 0, lane = r[1];
    } else if (part == 1) {
        current = 0, lane = r[0];
    } else if (part == 2) {
        current = 1 + std::min(2.0, std::floor(r[1] * 3)), lane = std::fmod(r[1] * 3, 1.0);
    } else {
        current = 4, lane = r[1];
    }
}

void fillParticle(Swarm &swarm, int i, int part, SeededRandom &rand)
{
    const double r[4] = {rand.next(), rand.next(), rand.next(), rand.next()};
    double current = 0, lane = 0;
    route(part, r, current, lane);
    const double w = rand.next();
    const gen::FlightDef &f = gen::kFlight[part];
    const double setOff = f.at + rand.next() * f.spread;
    const double flies = f.durMin + rand.next() * (f.durMax - f.durMin);
    const double restA = rand.next(), restB = rand.next();
    const float values[12] = {float(r[0]), float(r[1]), float(r[2]), float(r[3]),
                              float(part), float(w), float(current), float(lane),
                              float(setOff), float(flies), float(restA), float(restB)};
    std::copy(values, values + 4, swarm.rand.begin() + i * 4);
    std::copy(values + 4, values + 8, swarm.meta.begin() + i * 4);
    std::copy(values + 8, values + 12, swarm.fly.begin() + i * 4);
}

} // namespace

Swarm buildAvatarSwarm(Quality quality, uint32_t seed)
{
    const int *budget = quality == Quality::Lite ? gen::kBudgetLite : gen::kBudgetFull;
    Swarm swarm;
    for (int part = 0; part < 5; ++part) swarm.count += budget[part];
    swarm.rand.resize(swarm.count * 4);
    swarm.meta.resize(swarm.count * 4);
    swarm.fly.resize(swarm.count * 4);
    SeededRandom rand(seed);
    int i = 0;
    for (int part = 0; part < 5; ++part) {
        for (int k = 0; k < budget[part]; ++k, ++i) fillParticle(swarm, i, part, rand);
    }
    return swarm;
}

float densityOf(Quality quality)
{
    return quality == Quality::Lite ? gen::kDensityLite : gen::kDensityFull;
}

} // namespace soul
