#include "SoulAvatarWidget.h"

#include "soul_generated.h"

#include <QMouseEvent>
#include <QSurfaceFormat>
#include <QVector3D>
#include <QVector4D>
#include <QtDebug>

#include <algorithm>
#include <cmath>
#include <stdexcept>

#ifndef GL_PROGRAM_POINT_SIZE
#define GL_PROGRAM_POINT_SIZE 0x8642
#endif

namespace gen = soul::generated;

namespace {

constexpr float kFlareFade = 1.4f; // s for a flare to die down (avatar.js FLARE_FADE)
constexpr int kFloatsPerParticle = 12; // aRand, aMeta, aFly

// The state asked for, or calm (with a warning) when it is not one of them.
QString knownState(const QString &name, const soul::AvatarStates &states)
{
    if (states.count(name.toStdString())) return name;
    qWarning("SoulAvatarWidget: unknown state \"%s\", starting in calm", qPrintable(name));
    return QStringLiteral("calm");
}

QVector3D vec(const float (&rgb)[3]) { return {rgb[0], rgb[1], rgb[2]}; }

// The table of palettes the shader mixes from (uPalHot, uPalMid, uPalCool).
void setPaletteTable(QOpenGLShaderProgram &p)
{
    QVector3D hot[gen::kPaletteCount], mid[gen::kPaletteCount], cool[gen::kPaletteCount];
    for (int i = 0; i < gen::kPaletteCount; ++i) {
        hot[i] = vec(gen::kPalettes[i].hot);
        mid[i] = vec(gen::kPalettes[i].mid);
        cool[i] = vec(gen::kPalettes[i].cool);
    }
    p.setUniformValueArray("uPalHot", hot, gen::kPaletteCount);
    p.setUniformValueArray("uPalMid", mid, gen::kPaletteCount);
    p.setUniformValueArray("uPalCool", cool, gen::kPaletteCount);
}

} // namespace

SoulAvatarWidget::SoulAvatarWidget(QWidget *parent) : SoulAvatarWidget(Options{}, parent) {}

SoulAvatarWidget::SoulAvatarWidget(const Options &options, QWidget *parent)
    : QOpenGLWidget(parent),
      options_(options),
      state_(knownState(options.state, states_)),
      swarm_(soul::buildAvatarSwarm(options.quality)),
      tint_(soul::stateOf(state_.toStdString(), states_).palette),
      mood_(soul::stateOf(state_.toStdString(), states_)),
      fire_(gen::kAssemblyEnd) // every particle has landed: the fire is alight from the first frame
{
    QSurfaceFormat format = QSurfaceFormat::defaultFormat();
    format.setVersion(3, 3);
    format.setProfile(QSurfaceFormat::CoreProfile);
    format.setAlphaBufferSize(8);
    setFormat(format);
    if (options_.transparent) setAttribute(Qt::WA_AlwaysStackOnTop);
    setMouseTracking(options_.interactive);
    clock_.start();
    connect(this, &QOpenGLWidget::frameSwapped, this, qOverload<>(&QWidget::update));
}

SoulAvatarWidget::~SoulAvatarWidget()
{
    makeCurrent();
    vbo_.destroy();
    vao_.destroy();
    program_.reset();
    doneCurrent();
}

void SoulAvatarWidget::setState(const QString &name)
{
    try {
        const soul::AvatarState &next = soul::stateOf(name.toStdString(), states_);
        tint_.pick(next.palette);
        mood_.aim(next);
        state_ = name;
    } catch (const std::invalid_argument &err) {
        qWarning("SoulAvatarWidget: %s", err.what());
    }
}

void SoulAvatarWidget::setStates(const soul::AvatarStates &states)
{
    for (const auto &entry : states) soul::stateOf(entry.first, states); // throws on an unknown palette
    states_ = states;
    if (!states_.count(state_.toStdString())) state_ = QString::fromStdString(states_.begin()->first);
    setState(state_);
}

void SoulAvatarWidget::setLevel(float level) { voiceAim_ = std::clamp(level, 0.0f, 1.0f); }

void SoulAvatarWidget::flare() { flare_ = 1; }

void SoulAvatarWidget::initializeGL()
{
    initializeOpenGLFunctions();
    program_ = std::make_unique<QOpenGLShaderProgram>();
    const bool built = program_->addShaderFromSourceCode(QOpenGLShader::Vertex, gen::kVertexShader)
        && program_->addShaderFromSourceCode(QOpenGLShader::Fragment, gen::kFragmentShader)
        && program_->link();
    if (!built) qWarning("SoulAvatarWidget: the shader did not build: %s", qPrintable(program_->log()));
    uploadSwarm();
}

// One buffer, twelve floats a particle: aRand, aMeta, aFly.
void SoulAvatarWidget::uploadSwarm()
{
    std::vector<float> packed(size_t(swarm_.count) * kFloatsPerParticle);
    for (int i = 0; i < swarm_.count; ++i) {
        float *p = packed.data() + size_t(i) * kFloatsPerParticle;
        std::copy_n(swarm_.rand.data() + i * 4, 4, p);
        std::copy_n(swarm_.meta.data() + i * 4, 4, p + 4);
        std::copy_n(swarm_.fly.data() + i * 4, 4, p + 8);
    }
    vao_.create();
    vao_.bind();
    vbo_.create();
    vbo_.bind();
    vbo_.allocate(packed.data(), int(packed.size() * sizeof(float)));
    const char *names[3] = {"aRand", "aMeta", "aFly"};
    for (int k = 0; k < 3; ++k) {
        program_->enableAttributeArray(names[k]);
        program_->setAttributeBuffer(names[k], GL_FLOAT, int(k * 4 * sizeof(float)), 4, int(kFloatsPerParticle * sizeof(float)));
    }
    vao_.release();
}

// The soul fits the box as large as its frame allows (stage.js fitSoul).
void SoulAvatarWidget::resizeGL(int width, int height)
{
    view_.width = float(std::max(width, 1));
    view_.height = float(std::max(height, 1));
    view_.pxPerUnit = std::min(view_.height / (gen::kFrameTop - gen::kFrameBottom), view_.width / gen::kFrameMinWidth);
    view_.yMid = (gen::kFrameTop + gen::kFrameBottom) / 2;
}

void SoulAvatarWidget::paintGL()
{
    step(frameDt());
    glClearColor(0, 0, 0, options_.transparent ? 0 : 1);
    glClear(GL_COLOR_BUFFER_BIT);
    glDisable(GL_DEPTH_TEST);
    glEnable(GL_PROGRAM_POINT_SIZE);
    glEnable(GL_BLEND);
    // Light adds up, and so does opacity: the box holds premultiplied light (stage.js).
    glBlendFuncSeparate(GL_SRC_ALPHA, GL_ONE, GL_ONE, GL_ONE);
    program_->bind();
    setUniforms();
    vao_.bind();
    glDrawArrays(GL_POINTS, 0, swarm_.count);
    vao_.release();
    program_->release();
}

void SoulAvatarWidget::mouseMoveEvent(QMouseEvent *event)
{
    touch_.move(float(event->position().x()), float(event->position().y()), view_);
    QOpenGLWidget::mouseMoveEvent(event);
}

float SoulAvatarWidget::frameDt()
{
    const qint64 ns = clock_.nsecsElapsed();
    const float dt = lastNs_ < 0 ? 0.0f : float(ns - lastNs_) / 1e9f;
    lastNs_ = ns;
    return std::min(0.1f, dt);
}

// The clocks move on (avatar.js step): the voice lifts the fire quickly and lets it settle
// slowly, and the fire runs faster with the state's pace, a flare and the level.
void SoulAvatarWidget::step(float dt)
{
    const soul::Drive drive = mood_.tick(dt);
    now_ += dt;
    flare_ *= std::exp(-dt / (kFlareFade / 3));
    voice_ += (voiceAim_ - voice_) * std::min(1.0f, dt * (voiceAim_ > voice_ ? 12.0f : 3.0f));
    level_ = std::min(1.0f, drive.energy + voice_);
    fire_ += dt * drive.pace * (1 + 0.4f * flare_ + 0.3f * level_);
    tint_.tick(dt);
    touch_.tick(dt);
}

void SoulAvatarWidget::setUniforms()
{
    QOpenGLShaderProgram &p = *program_;
    p.setUniformValue("uTime", now_);
    p.setUniformValue("uFire", fire_);
    p.setUniformValue("uAsm", 1e4f); // formed for good
    p.setUniformValue("uBootAt", 0.0f);
    p.setUniformValue("uLive", 0.0f);
    p.setUniformValue("uFlare", flare_);
    p.setUniformValue("uLevel", level_);
    setPaletteTable(p);
    const soul::Mix was = tint_.was(), to = tint_.to();
    p.setUniformValueArray("uMixWas", was.data(), gen::kPaletteCount, 1);
    p.setUniformValueArray("uMix", to.data(), gen::kPaletteCount, 1);
    p.setUniformValue("uShift", tint_.since());
    p.setUniformValue("uView", 2 * view_.pxPerUnit / view_.width, 2 * view_.pxPerUnit / view_.height);
    p.setUniformValue("uYMid", view_.yMid);
    p.setUniformValue("uPx", view_.pxPerUnit * float(devicePixelRatioF()));
    p.setUniformValue("uDensity", soul::densityOf(options_.quality));
    QVector4D trail[gen::kTrailN];
    const auto samples = touch_.trail();
    for (int i = 0; i < gen::kTrailN; ++i) trail[i] = {samples[i][0], samples[i][1], samples[i][2], samples[i][3]};
    p.setUniformValueArray("uTrail", trail, gen::kTrailN);
}
