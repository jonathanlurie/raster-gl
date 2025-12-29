#version 300 es
precision highp float;

in vec2 a_position;
out vec4 position;
out vec2 uv;

void main() {
  position = vec4(a_position, 0.0, 1.0);
  gl_Position = position;
  uv = position.xy / 2. + 0.5;
}