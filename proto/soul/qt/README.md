# Soul avatar em Qt (C++)

A alma do `proto/soul/` como um widget nativo do Qt 6: `SoulAvatarWidget`, um
`QOpenGLWidget` que desenha ao vivo, com o mesmo shader de partículas das páginas web,
já montada e com fundo transparente. O estado escolhe a cor (com a troca gradual, subindo do
coração), a altura e o ritmo do fogo.

## Compilar

Precisa de Qt 6 (Widgets, OpenGL, OpenGLWidgets), CMake 3.16+ e OpenGL 3.3.

```sh
cmake -S proto/soul/qt -B build/soul-qt
cmake --build build/soul-qt
build/soul-qt/soul_avatar_demo
```

O demo tem botões de estado, o nível, o flare e um fundo claro para ver a transparência.
`--grab arquivo.png --state angry --seconds 3` salva um quadro e fecha.

## Usar no seu projeto

Copie a pasta `src/` (ou use `add_subdirectory(proto/soul/qt)` e ligue em `soul_avatar`):

```cpp
#include "SoulAvatarWidget.h"

auto *soul = new SoulAvatarWidget({soul::Quality::Full, /*transparent*/ true, /*interactive*/ false, "calm"}, parent);
soul->setState("thinking");   // calm | thinking | angry | happy
soul->setLevel(0.6f);         // 0..1: uma voz ou qualquer sinal levanta o fogo
soul->flare();                // o fogo cresce por um instante

// Estados próprios: nome -> {paleta, energia 0..1, ritmo}
soul->setStates({{"idle", {"blue", 0.0f, 1.0f}}, {"busy", {"red", 0.5f, 1.8f}}});
soul->setState("busy");
```

- Paletas: `blue`, `red`, `purple`, `white`.
- `soul::Quality::Lite` usa um terço das partículas (bom para avatares pequenos ou vários).
- `interactive` deixa o cursor empurrar as partículas.
- Transparente, ele aparece sobre o que estiver atrás (`Qt::WA_AlwaysStackOnTop`). Com
  `transparent = false` desenha sobre preto.

## De onde vem o shader

`src/soul_generated.h` é gerado a partir do JavaScript (`shaders.js`, `palettes.js`,
`avatar-states.js`...). Depois de mudar a alma na web, rode `npm run export:qt` para o
Qt acompanhar; o `npm test` avisa se o arquivo ficou para trás. As partículas saem do mesmo
gerador com a mesma semente, então são as mesmas da web, número por número.

## Qt 5

Dá para usar com poucas mudanças: no CMake, `Qt5` com `Widgets` e `Gui` (o
`QOpenGLWidget` fica no Widgets), e no `mouseMoveEvent` trocar `event->position()` por
`event->pos()`.
