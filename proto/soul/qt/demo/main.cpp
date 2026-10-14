// A window to try the native avatar: a big one driven by buttons, a level slider and a
// flare, over a background you can switch to light, and two small ones (quality lite).
//   soul_avatar_demo                                  the window
//   soul_avatar_demo --grab shot.png --state angry    save a frame after --seconds (2) and quit
//   (--lite fewer particles, --light a light background)
#include "SoulAvatarWidget.h"

#include <QApplication>
#include <QCheckBox>
#include <QCommandLineParser>
#include <QHBoxLayout>
#include <QLabel>
#include <QPushButton>
#include <QSlider>
#include <QSurfaceFormat>
#include <QTimer>
#include <QVBoxLayout>

namespace {

// The window's own background only (a stylesheet on every child would restyle the slider).
void paintBackground(QWidget *window, bool light)
{
    window->setProperty("light", light);
    window->setStyleSheet(light ? "#soulWindow { background: #eef1f3; } QLabel, QCheckBox { color: #24323a; }"
                                : "#soulWindow { background: #000; } QLabel, QCheckBox { color: #19ddff; }");
}

QWidget *controlsFor(SoulAvatarWidget *soul, QWidget *window)
{
    auto *panel = new QWidget;
    auto *column = new QVBoxLayout(panel);
    for (const auto &entry : soul::builtInStates()) {
        auto *button = new QPushButton(QString::fromStdString(entry.first));
        QObject::connect(button, &QPushButton::clicked, soul, [soul, button] { soul->setState(button->text()); });
        column->addWidget(button);
    }
    auto *level = new QSlider(Qt::Horizontal);
    level->setRange(0, 100);
    QObject::connect(level, &QSlider::valueChanged, soul, [soul](int v) { soul->setLevel(v / 100.0f); });
    column->addWidget(new QLabel("level"));
    column->addWidget(level);
    auto *flare = new QPushButton("flare");
    QObject::connect(flare, &QPushButton::clicked, soul, &SoulAvatarWidget::flare);
    column->addWidget(flare);
    auto *light = new QCheckBox("light background");
    QObject::connect(light, &QCheckBox::toggled, window, [window](bool on) { paintBackground(window, on); });
    light->setChecked(window->property("light").toBool());
    column->addWidget(light);
    column->addStretch();
    return panel;
}

QWidget *smallOnes()
{
    auto *row = new QWidget;
    auto *layout = new QHBoxLayout(row);
    for (const char *state : {"thinking", "angry"}) {
        auto *soul = new SoulAvatarWidget({soul::Quality::Lite, true, false, state});
        soul->setFixedSize(120, 160);
        layout->addWidget(soul);
    }
    return row;
}

} // namespace

int main(int argc, char **argv)
{
    QApplication app(argc, argv);
    QCommandLineParser args;
    args.addOptions({{"grab", "Save a frame to <file> and quit.", "file"},
                     {"state", "Start in <state>.", "state", "calm"},
                     {"seconds", "How long to run before --grab.", "seconds", "2"},
                     {"lite", "Fewer particles."},
                     {"light", "Start on a light background."}});
    args.process(app);

    QWidget window;
    window.setObjectName("soulWindow");
    paintBackground(&window, args.isSet("light"));
    auto *soul = new SoulAvatarWidget({args.isSet("lite") ? soul::Quality::Lite : soul::Quality::Full, true, true, args.value("state")});
    soul->setFixedSize(360, 480);
    auto *layout = new QHBoxLayout(&window);
    layout->addWidget(soul);
    auto *side = new QVBoxLayout;
    side->addWidget(controlsFor(soul, &window));
    side->addWidget(smallOnes());
    layout->addLayout(side);
    window.setWindowTitle(QString("Soul avatar (%1 particles)").arg(soul->particles()));
    window.show();

    if (args.isSet("grab")) {
        QTimer::singleShot(int(args.value("seconds").toDouble() * 1000), &app, [&] {
            soul->grabFramebuffer().save(args.value("grab"));
            window.grab().save(args.value("grab").replace(".png", "-window.png"));
            app.quit();
        });
    }
    return app.exec();
}
