# The soul avatar as a native Qt 6 widget (SoulAvatarWidget), and a demo window.
#   cmake -S proto/soul/qt -B build/soul-qt && cmake --build build/soul-qt
cmake_minimum_required(VERSION 3.16)
project(soul_avatar LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_AUTOMOC ON)

find_package(Qt6 REQUIRED COMPONENTS Widgets OpenGL OpenGLWidgets)

add_library(soul_avatar STATIC
  src/SoulAvatarWidget.cpp
  src/SoulAvatarWidget.h
  src/soul_swarm.cpp
  src/soul_tint.cpp
  src/soul_touch.cpp
)
target_include_directories(soul_avatar PUBLIC src)
target_link_libraries(soul_avatar PUBLIC Qt6::Widgets Qt6::OpenGL Qt6::OpenGLWidgets)

add_executable(soul_avatar_demo demo/main.cpp)
target_link_libraries(soul_avatar_demo PRIVATE soul_avatar)
