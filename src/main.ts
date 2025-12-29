import { ProcessingNode, RasterContext, Texture } from './lib';
import './style.css'


const appDiv = document.getElementById('app') as HTMLDivElement;


function demo1() {
  const rctx = new RasterContext({
    width: 1000,
    height: 800,
  });

  appDiv.append(rctx.getCanvas() as HTMLCanvasElement);

  // The size overwrite will result in a canvas being 200x400
  const n = new ProcessingNode(rctx, {width: 200, height: 400});

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
    fragmentShaderSource: fragmentShader,
  });

  n.setUniformNumber("u_red", 150);
  n.setUniformNumber("u_green", 90);

  let blue = 0;
  const increaseBlue = () => {
    blue = (++blue) % 255;
    
    n.setUniformNumber("u_blue", blue);
    n.render();
    requestAnimationFrame(increaseBlue);
  }

  increaseBlue();
}


async function demo2() {
  const rctx = new RasterContext({
    width: 512,
    height: 512,
  });
  const n = new ProcessingNode(rctx);

  appDiv.append(rctx.getCanvas() as HTMLCanvasElement);

  const tileUrlPattern = "https://tiles.mapterhorn.com/{z}/{x}/{y}.webp";
  const tileUrl = tileUrlPattern
    .replace("{z}", "10")
    .replace("{x}", "532")
    .replace("{y}", "363")

  const tex = await Texture.fromURL(rctx, tileUrl);

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
  const rctx = new RasterContext({
    width: 512,
    height: 512,
    offscreen: true,
  });

  const n = new ProcessingNode(rctx, {renderToTexture: true});

  const tileUrlPattern = "https://tiles.mapterhorn.com/{z}/{x}/{y}.webp";
  const tileUrl = tileUrlPattern
    .replace("{z}", "10")
    .replace("{x}", "532")
    .replace("{y}", "363")

  const tex = await Texture.fromURL(rctx, tileUrl);

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