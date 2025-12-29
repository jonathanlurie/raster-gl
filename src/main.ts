import { ProcessingNode, Texture } from './lib';
import './style.css'


const appDiv = document.getElementById('app') as HTMLDivElement;


function demo1() {
  const n = new ProcessingNode({container: appDiv, width: 200, height: 200});

  
  const vertexShader = `
  #version 300 es

  in vec2 a_position;
  out vec4 position;
  out vec2 uv;

  void main() {
    position = vec4(a_position, 0.0, 1.0);
    gl_Position = position;
    uv = position.xy / 2. + 0.5;
  }
  `.trim();

  const fragmentShader = `
  #version 300 es

  precision highp float;

  in vec2 uv;
  out vec4 fragColor;

  uniform float u_red;
  uniform float u_green;
  uniform float u_blue;

  void main() {
    fragColor = vec4(u_red / 255., u_green / 255., u_blue / 255., 1.);
  }
  `.trim();

  n.setShaderSource({
    // vertexShaderSource: vertexShader,
    fragmentShaderSource: fragmentShader,
  });

  n.setUniformNumber("u_red", 150);
  n.setUniformNumber("u_green", 90);
  // n.setUniformNumber("u_blue", 180);


  let blue = 0;
  const increaseBlue = () => {
    blue = (++blue) % 255;
    console.log(blue);
    
    n.setUniformNumber("u_blue", blue);
    n.render();
    requestAnimationFrame(increaseBlue);
  }

  increaseBlue();
}


async function demo2() {
  const n = new ProcessingNode({container: appDiv, width: 512, height: 512});

  const tileUrlPattern = "https://tiles.mapterhorn.com/{z}/{x}/{y}.webp";
  const tileUrl = tileUrlPattern
    .replace("{z}", "10")
    .replace("{x}", "532")
    .replace("{y}", "363")

  const tex = await Texture.fromURL(tileUrl);

  const fragmentShader = `
  #version 300 es

  precision highp float;

  in vec2 uv;
  out vec4 fragColor;

  uniform sampler2D u_tile;

  // Decoding Terrarium encoding
  float terrariumToElevation(vec4 color) {
    return (color.r * 255.0 * 256.0 + color.g * 255.0 + color.b * 255.0 / 256.0) - 32768.0;
  }

  void main() {
    vec4 color = texture(u_tile, uv);
    float elevation = terrariumToElevation(color);
    float grayElevation = (elevation - 250.) / 3000.;
    fragColor = vec4(grayElevation, grayElevation, grayElevation, 1.);
  }
  `.trim();

  n.setShaderSource({
    fragmentShaderSource: fragmentShader,
  });

  n.setUniformTexture2D("u_tile", tex)

  // console.log(n.getVertexShaderError());
  // console.log(n.getFragmentShaderError());

  n.render();

  console.log(n.getPixelData());
}



async function demo3() {
  const n = new ProcessingNode({width: 512, height: 512});

  const tileUrlPattern = "https://tiles.mapterhorn.com/{z}/{x}/{y}.webp";
  const tileUrl = tileUrlPattern
    .replace("{z}", "10")
    .replace("{x}", "532")
    .replace("{y}", "363")

  const tex = await Texture.fromURL(tileUrl);

  const fragmentShader = `
  #version 300 es

  precision highp float;

  in vec2 uv;
  out vec4 fragColor;

  uniform sampler2D u_tile;

  // Decoding Terrarium encoding
  float terrariumToElevation(vec4 color) {
    return (color.r * 255.0 * 256.0 + color.g * 255.0 + color.b * 255.0 / 256.0) - 32768.0;
  }

  void main() {
    vec4 color = texture(u_tile, uv);
    float elevation = terrariumToElevation(color);
    float grayElevation = (elevation - 250.) / 3000.;
    fragColor = vec4(grayElevation, grayElevation, grayElevation, 1.);
  }
  `.trim();

  n.setShaderSource({
    fragmentShaderSource: fragmentShader,
  });

  n.setUniformTexture2D("u_tile", tex)

  console.log(n.getVertexShaderError());
  console.log(n.getFragmentShaderError());

  n.render();

  console.log(n.getPixelData());
}


demo3()