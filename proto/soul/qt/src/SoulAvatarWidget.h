// The soul as a native Qt widget: already formed, drawn live by the same particle shader as
// the web pages (generated into soul_generated.h), on a see-through background.
//
//   auto *soul = new SoulAvatarWidget(parent);   // 240x320 unless laid out otherwise
//   soul->setState("thinking");                   // calm | thinking | angry | happy, or your own
//   soul->setLevel(0.6f);                          // 0..1, a voice or any signal
//   soul->flare();
#pragma once

#include "soul_swarm.h"
#include "soul_tint.h"
#include "soul_touch.h"

#include <QElapsedTimer>
#include <QOpenGLBuffer>
#include <QOpenGLExtraFunctions>
#include <QOpenGLShaderProgram>
#include <QOpenGLVertexArrayObject>
#include <QOpenGLWidget>

#include <memory>

class SoulAvatarWidget : public QOpenGLWidget, protected QOpenGLExtraFunctions {
    Q_OBJECT

public:
    struct Options {
        soul::Quality quality = soul::Quality::Full;
        bool transparent = true;  // over the widgets behind it; false draws on black
        bool interactive = false; // the cursor pushes its particles aside
        QString state = QStringLiteral("calm");
    };

    explicit SoulAvatarWidget(QWidget *parent = nullptr);
    SoulAvatarWidget(const Options &options, QWidget *parent = nullptr);
    ~SoulAvatarWidget() override;

    // One of its states; the colour, energy and pace follow gradually. Unknown names are
    // refused with a warning that names the states there are.
    void setState(const QString &name);
    QString state() const { return state_; }
    // Its own states, replacing the built-in ones (calm, thinking, angry, happy).
    void setStates(const soul::AvatarStates &states);
    void setLevel(float level);
    void flare();
    int particles() const { return swarm_.count; }

    QSize sizeHint() const override { return {240, 320}; }

protected:
    void initializeGL() override;
    void resizeGL(int width, int height) override;
    void paintGL() override;
    void mouseMoveEvent(QMouseEvent *event) override;

private:
    void step(float dt);
    void setUniforms();
    void uploadSwarm();
    float frameDt();

    Options options_;
    soul::AvatarStates states_ = soul::builtInStates();
    QString state_;
    soul::Swarm swarm_;
    soul::Tint tint_;
    soul::Mood mood_;
    soul::Touch touch_;
    soul::View view_;
    float now_ = 0, fire_, flare_ = 0, level_ = 0, voice_ = 0, voiceAim_ = 0;
    QElapsedTimer clock_;
    qint64 lastNs_ = -1;
    std::unique_ptr<QOpenGLShaderProgram> program_;
    QOpenGLVertexArrayObject vao_;
    QOpenGLBuffer vbo_{QOpenGLBuffer::VertexBuffer};
};
