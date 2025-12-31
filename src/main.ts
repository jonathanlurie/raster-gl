import { ProcessingNode, RasterContext, Texture, U_TYPE } from './lib';
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
    offscreen: false,
  });

  appDiv.append(rctx.getCanvas() as HTMLCanvasElement);

  const n1 = new ProcessingNode(rctx, {renderToTexture: true});

  const tileUrlPattern = "https://tiles.mapterhorn.com/{z}/{x}/{y}.webp";
  const tileUrl = tileUrlPattern
    .replace("{z}", "10")
    .replace("{x}", "532")
    .replace("{y}", "363")

  const tex = await Texture.fromURL(rctx, tileUrl);

  const fragmentShader1 = `
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

  

  n1.setShaderSource({
    fragmentShaderSource: fragmentShader1,
  });

  
  n1.setUniformTexture2D("u_tile", tex)

  console.log(n1.getVertexShaderError());
  console.log(n1.getFragmentShaderError());

  // Can be ommited because getting the output texture out of it
  // will force a render
  // n1.render();

  // console.log(n1.getPixelData());

  const n2 = new ProcessingNode(rctx, {renderToTexture: false});

  const fragmentShader2 = `
  #version 300 es

  precision highp float;

  in vec2 uv;
  out vec4 fragColor;

  uniform sampler2D u_tileElevation;

  void main() {
    vec4 color = texture(u_tileElevation, uv);
    fragColor = vec4(1., color.r, 0., 1.);
  }
  `.trim();

  n2.setShaderSource({
    fragmentShaderSource: fragmentShader2,
  });

  


  console.time("render");
  n2.setUniformTexture2D("u_tileElevation", n1);
  n2.render();
  console.timeEnd("render");

  console.log(n2.getPixelData());
}



const Z_FOR_CENTRAL_MASS: Record<number, number> = {
  0.90: 1.644854,
  0.95: 1.959964,
  0.98: 2.326348,
  0.99: 2.575829,
  0.995: 2.807034,
  0.997: 3.0,      // common rule-of-thumb (≈ 99.73%)
  0.999: 3.290527
};

export function sigmaFromRadius(
  radius: number,
  centralMass: 0.90 | 0.95 | 0.98 | 0.99 | 0.995 | 0.997 | 0.999 = 0.99
): number {
  if (radius <= 0) return 1e-6;
  const z = Z_FOR_CENTRAL_MASS[centralMass];
  return radius / z;
}

export function buildGaussianKernelFromRadius(
  radius: number,
  centralMass: 0.90 | 0.95 | 0.98 | 0.99 | 0.995 | 0.997 | 0.999 = 0.95
): Float32Array {
  const sigma = sigmaFromRadius(radius, centralMass);
  return buildGaussianKernel(radius, sigma);
}


export function buildGaussianKernel(radius: number, sigma: number): Float32Array {
  const size = radius * 2 + 1;
  const kernel = new Float32Array(size);
  const sigma2 = sigma * sigma * 2;
  let sum = 0;

  for (let i = -radius; i <= radius; i++) {
    const value = Math.exp(-(i * i) / sigma2);
    kernel[i + radius] = value;
    sum += value;
  }

  // Normalize kernel
  for (let i = 0; i < size; i++) {
    kernel[i] /= sum;
  }

  return kernel;
}


async function demo4() {

  const kernel = Array.from(buildGaussianKernelFromRadius(60));
  console.log("kernel", kernel);
  


  const rctx = new RasterContext({
    width: 512,
    height: 512,
    offscreen: false,
  });

  appDiv.append(rctx.getCanvas() as HTMLCanvasElement);

  const n1 = new ProcessingNode(rctx, {renderToTexture: true});

  const tileUrlPattern = "https://tiles.mapterhorn.com/{z}/{x}/{y}.webp";
  const tileUrl = tileUrlPattern
    .replace("{z}", "10")
    .replace("{x}", "532")
    .replace("{y}", "363")

  console.log(tileUrl);
  

  const tex = await Texture.fromURL(rctx, tileUrl);

  const fragmentShaderBlurPass = `
  #version 300 es
  precision highp float;

  const int MAX_KERNEL_SIZE = 121;

  in vec2 uv;
  out vec4 fragColor;

  uniform float u_kernel[MAX_KERNEL_SIZE];
  uniform int u_kernelSize;
  uniform sampler2D u_tile;
  uniform bool u_isHorizontalPass;

  // Decoding Terrarium encoding
  float terrariumToElevation(vec4 color) {
    return (color.r * 255.0 * 256.0 + color.g * 255.0 + color.b * 255.0 / 256.0) - 32768.0;
  }

  vec4 elevationToTerrarium(float elevation) {
    float e = elevation + 32768.0;
    float r = floor(e / 256.0);
    float g = floor(e - r * 256.0);
    float b = (e - r * 256.0 - g) * 256.0;
    return vec4(r / 255.0, g / 255.0, b / 255.0, 1.0);
  }

  void main() {
    // Getting texture coordinate in integer
    // ivec2 pixelCoord = ivec2(gl_FragCoord.xy);
    // vec4 color = texelFetch(u_tile, pixelCoord, 0);  // 0 = mip level

    // Size of the texture in number of pixels
    vec2 textureSize = vec2(textureSize(u_tile, 0));

    float unitHorizontalStep = 1. / textureSize.x;
    float unitVerticalStep = 1. / textureSize.y;

    float sum = 0.0;
    vec2 neighborPosition = vec2(uv);
    int halfKernelSize = u_kernelSize / 2;

    for (int i = 0; i < u_kernelSize; i++) {
      if(u_isHorizontalPass) {
        neighborPosition.x = uv.x + float(i - halfKernelSize) * unitHorizontalStep;
      } else {
        neighborPosition.y = uv.y + float(i - halfKernelSize) * unitVerticalStep; 
      }
       

      vec4 color = texture(u_tile, neighborPosition);
      float elevation = terrariumToElevation(color);
      sum += u_kernel[i] * elevation;
    }



    fragColor = elevationToTerrarium(sum);
  }
  `.trim();

  console.time("compute")
  n1.setShaderSource({
    fragmentShaderSource: fragmentShaderBlurPass,
  });

  
  n1.setUniformNumber("u_kernel", kernel);
  n1.setUniformNumber("u_kernelSize", kernel.length, U_TYPE.INT);
  n1.setUniformBoolean("u_isHorizontalPass", true);
  n1.setUniformTexture2D("u_tile", tex)

  // console.log(n1.getVertexShaderError());
  // console.log(n1.getFragmentShaderError());

  // Can be ommited because getting the output texture out of it
  // will force a render
  n1.render();

  // console.log(n1.getPixelData());

  const n2 = new ProcessingNode(rctx, {renderToTexture: false});

  n2.setShaderSource({
    fragmentShaderSource: fragmentShaderBlurPass,
  });

  n2.setUniformNumber("u_kernel", kernel);
  n2.setUniformNumber("u_kernelSize", kernel.length, U_TYPE.INT);
  n2.setUniformBoolean("u_isHorizontalPass", false);
  n2.setUniformTexture2D("u_tile", n1)
  n2.render();


  console.timeEnd("compute")

  console.log(n2.getPixelData());
}


demo4()