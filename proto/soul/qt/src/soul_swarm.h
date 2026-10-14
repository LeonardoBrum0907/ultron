// The avatar's particles, made once, as the shader reads them (a port of proto/soul/swarm.js:
// the same seed gives the same numbers, so the native avatar is the same soul).
#pragma once

#include <cstdint>
#include <vector>

namespace soul {

enum class Quality { Full, Lite };

// Four numbers per particle in each of aRand, aMeta and aFly (see shaders.js).
struct Swarm {
    std::vector<float> rand;
    std::vector<float> meta;
    std::vector<float> fly;
    int count = 0;
};

// swarm.js seededRandom (mulberry32): the next number in [0, 1).
class SeededRandom {
public:
    explicit SeededRandom(uint32_t seed) : a_(seed) {}
    double next();

private:
    uint32_t a_;
};

// The formed soul's particles (no dust), part by part: core, halo, flame, smoke, ember.
Swarm buildAvatarSwarm(Quality quality, uint32_t seed = 1);

// How much brighter each particle is drawn, to make up for fewer of them.
float densityOf(Quality quality);

} // namespace soul
