export const DEFAULT_WIDTH = 512;
export const DEFAULT_HEIGHT = 512;
let defaultGlContext: WebGL2RenderingContext | null = null;
let currentTextureUnit = 0;

// Keeps track of what texture unit is already in use
const textureUnitSlots: Array<boolean> = Array(16).fill(false);

export function getUnusedTextureUnit(): number {
  for (let i = 0; i < textureUnitSlots.length; i += 1) {
    if (!textureUnitSlots[i]) {
      textureUnitSlots[i] = true;
      return i;
    }
  }

  throw new Error("All the texture units are already allocated.");
}

export function freeTextureUnit(i: number) {
  textureUnitSlots[i] = false;
}

export function getCurrentTextureUnit(): number {
  return currentTextureUnit;
}

export function incrementCurrentTextureUnit() {
  currentTextureUnit++;
}

/**
 * Returns a default gl context of the default size (512 x 512)
 * @returns
 */
export function getDefaultGlContext(): WebGL2RenderingContext {
  if (defaultGlContext === null) {
    const gl = prepareGlContext({
      width: DEFAULT_WIDTH,
      height: DEFAULT_HEIGHT,
    });
    defaultGlContext = gl;
  }

  return defaultGlContext;
}

// From Fragment.ink
export function getShaderCompileError(
  gl: WebGL2RenderingContext,
  vertexShaderSource: string,
  fragmentShaderSource: string
) {
  const vertexShader = gl.createShader(gl.VERTEX_SHADER) as WebGLShader;
  gl.shaderSource(vertexShader, vertexShaderSource);
  gl.compileShader(vertexShader);
  const vertexShaderMessages = gl.getShaderInfoLog(vertexShader);

  const fragmentShader = gl.createShader(gl.FRAGMENT_SHADER) as WebGLShader;
  gl.shaderSource(fragmentShader, fragmentShaderSource);
  gl.compileShader(fragmentShader);
  const fragmentShaderMessages = gl.getShaderInfoLog(fragmentShader);

  return {
    vertexShaderMessages,
    fragmentShaderMessages,
  };
}

export function createProgram(
  gl: WebGL2RenderingContext,
  vertexShader: WebGLShader,
  fragmentShader: WebGLShader
): { program: WebGLProgram | null; error: string | null } {
  const program = gl.createProgram() as WebGLProgram;
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    // console.error('Program linking error:', gl.getProgramInfoLog(program));
    const error = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    return { program: null, error };
  }

  return { program, error: null };
}

export function compileShader(
  gl: WebGL2RenderingContext,
  type: number,
  source: string
): { shader: WebGLShader | null; error: string | null } {
  const shader = gl.createShader(type) as WebGLShader;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);

  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const error = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    return { shader: null, error };
  }

  return { shader, error: null };
}

export function prepareGlContext(options: {
  canvasElemId?: string;
  width: number;
  height: number;
}): WebGL2RenderingContext {
  const canvas = (
    options.canvasElemId
      ? document.getElementById(options.canvasElemId)
      : document.createElement("canvas")
  ) as HTMLCanvasElement;
  canvas.width = options.width;
  canvas.height = options.height;
  const gl = canvas.getContext("webgl2") as WebGL2RenderingContext;

  if (!gl) {
    throw new Error("WebGL2 not supported in this browser.");
  }

  return gl;
}

// export function uniformToGlFunction(value: ): string {

// }
