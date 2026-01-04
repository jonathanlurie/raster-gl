import { ProcessingNode, RasterContext, Texture, UNIFORM_TYPE } from "../lib";
import { buildGaussianKernelFromRadius } from "./common";

const appDiv = document.getElementById("app") as HTMLDivElement;

const terrariumToElevation = `
// Decoding Terrarium encoding
float terrariumToElevation(vec4 color) {
  return (color.r * 255.0 * 256.0 + color.g * 255.0 + color.b * 255.0 / 256.0) - 32768.0;
}
`.trim();

const elevationToTerrarium = `
// Encoding elevation to Terrarium
vec4 elevationToTerrarium(float elevation) {
  float e = elevation + 32768.0;
  float r = floor(e / 256.0);
  float g = floor(e - r * 256.0);
  float b = (e - r * 256.0 - g) * 256.0;
  return vec4(r / 255.0, g / 255.0, b / 255.0, 1.0);
}
`.trim();

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

${terrariumToElevation}

${elevationToTerrarium}

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

const fragmentShaderCombine = `
#version 300 es
precision highp float;

#define PI 3.141592653589793

in vec2 uv;
out vec4 fragColor;

uniform vec3 u_tint;

uniform float u_weightLowPass_3;
uniform float u_weightLowPass_7;
uniform float u_weightLowPass_15;
uniform float u_weightLowPass_30;
uniform float u_weightLowPass_60;

uniform sampler2D u_tile;
uniform sampler2D u_tileLowPass_3;
uniform sampler2D u_tileLowPass_7;
uniform sampler2D u_tileLowPass_15;
uniform sampler2D u_tileLowPass_30;
uniform sampler2D u_tileLowPass_60;

${terrariumToElevation}


float easeOutSine(float value, float maxValue, float scale) {
  return sin(((min(value, maxValue) / maxValue) * PI) / 2.) * scale;
}


void main() {
  float eleTile = terrariumToElevation(texture(u_tile, uv));
  float eleTileLowPass3 = terrariumToElevation(texture(u_tileLowPass_3, uv));
  float eleTileLowPass7 = terrariumToElevation(texture(u_tileLowPass_7, uv));
  float eleTileLowPass15 = terrariumToElevation(texture(u_tileLowPass_15, uv));
  float eleTileLowPass30 = terrariumToElevation(texture(u_tileLowPass_30, uv));
  float eleTileLowPass60 = terrariumToElevation(texture(u_tileLowPass_60, uv));

  float eleDeltaLowPass3 = max(0., eleTileLowPass3 - eleTile);
  float eleDeltaLowPass7 = max(0., eleTileLowPass7 - eleTile);
  float eleDeltaLowPass15 = max(0., eleTileLowPass15 - eleTile);
  float eleDeltaLowPass30 = max(0., eleTileLowPass30 - eleTile);
  float eleDeltaLowPass60 = max(0., eleTileLowPass60 - eleTile);

  float multiresWeightedDelta = (eleDeltaLowPass3 * u_weightLowPass_3)
    + (eleDeltaLowPass7 * u_weightLowPass_7)
    + (eleDeltaLowPass15 * u_weightLowPass_15)
    + (eleDeltaLowPass30 * u_weightLowPass_30)
    + (eleDeltaLowPass60 * u_weightLowPass_60);

  float easedValue = easeOutSine(multiresWeightedDelta, 2000., 1.);

  fragColor = vec4(u_tint.r, u_tint.g, u_tint.b, easedValue);
}

`.trim();

export async function cavityShading() {
  const rctx = new RasterContext({
    width: 512,
    height: 512,
    offscreen: true,
  });

  console.log("rctx", rctx);

  

  const tileUrlPattern = "https://tiles.mapterhorn.com/{z}/{x}/{y}.webp";
  const tileUrl = tileUrlPattern.replace("{z}", "10").replace("{x}", "532").replace("{y}", "363");

  const tex = await Texture.fromURL(rctx, tileUrl, { bilinear: false });

  console.time("compute");
  const lowPassTextures: Record<number, Texture | null> = {
    3: null,
    7: null,
    15: null,
    30: null,
    60: null,
  } as const;

  const gaussianScaleSpaceWeightsZ10 = {
    3: 4,
    7: 3,
    15: 3,
    30: 1,
    60: 1,
  } as const;

  const kernelRadii = Object.keys(lowPassTextures).map((r) => Number.parseInt(r, 10));

  const lowPassHorizontalNode = new ProcessingNode(rctx, {
    renderToTexture: true,
    reuseOutputTexture: false,
  });

  lowPassHorizontalNode.setShaderSource({
    fragmentShaderSource: fragmentShaderBlurPass,
  });

  const lowPassVerticalNode = new ProcessingNode(rctx, {
    renderToTexture: true,
    reuseOutputTexture: false,
  });

  lowPassVerticalNode.setShaderSource({
    fragmentShaderSource: fragmentShaderBlurPass,
  });

  for (const radius of kernelRadii) {
    // console.log("radius... ", radius);

    const kernel = Array.from(buildGaussianKernelFromRadius(radius));

    lowPassHorizontalNode.setUniformNumber("u_kernel", kernel);
    lowPassHorizontalNode.setUniformNumber("u_kernelSize", kernel.length, UNIFORM_TYPE.INT);
    lowPassHorizontalNode.setUniformBoolean("u_isHorizontalPass", true);
    lowPassHorizontalNode.setUniformTexture2D("u_tile", tex);
    lowPassHorizontalNode.render();

    lowPassVerticalNode.setUniformNumber("u_kernel", kernel);
    lowPassVerticalNode.setUniformNumber("u_kernelSize", kernel.length, UNIFORM_TYPE.INT);
    lowPassVerticalNode.setUniformBoolean("u_isHorizontalPass", false);
    lowPassVerticalNode.setUniformTexture2D("u_tile", lowPassHorizontalNode);
    lowPassVerticalNode.render();

    lowPassTextures[radius] = lowPassVerticalNode.getOutputTexture();
  }

  const combineNode = new ProcessingNode(rctx, { renderToTexture: false });

  combineNode.setShaderSource({
    fragmentShaderSource: fragmentShaderCombine,
  });

  combineNode.setUniformRGB("u_tint", [0, 0, 100]);

  combineNode.setUniformTexture2D("u_tile", tex);

  combineNode.setUniformNumber("u_weightLowPass_3", gaussianScaleSpaceWeightsZ10[3]);
  combineNode.setUniformNumber("u_weightLowPass_7", gaussianScaleSpaceWeightsZ10[7]);
  combineNode.setUniformNumber("u_weightLowPass_15", gaussianScaleSpaceWeightsZ10[15]);
  combineNode.setUniformNumber("u_weightLowPass_30", gaussianScaleSpaceWeightsZ10[30]);
  combineNode.setUniformNumber("u_weightLowPass_60", gaussianScaleSpaceWeightsZ10[60]);

  combineNode.setUniformTexture2D("u_tileLowPass_3", lowPassTextures[3] as Texture);
  combineNode.setUniformTexture2D("u_tileLowPass_7", lowPassTextures[7] as Texture);
  combineNode.setUniformTexture2D("u_tileLowPass_15", lowPassTextures[15] as Texture);
  combineNode.setUniformTexture2D("u_tileLowPass_30", lowPassTextures[30] as Texture);
  combineNode.setUniformTexture2D("u_tileLowPass_60", lowPassTextures[60] as Texture);

  combineNode.render();

  const pixelData = combineNode.getPixelData();
  console.timeEnd("compute");

  const imageUrl = await combineNode.getPNGImageObjectURL({
    x: 100,
    y: 100,
    w: 512 - 200,
    h: 512 - 200,
  });

  if (!imageUrl) {
    console.warn("invalid img url");
    return;
  }

  const imgElement = document.createElement("img");
  imgElement.src = imageUrl;

  appDiv.append(imgElement);

  console.log(pixelData);
}
