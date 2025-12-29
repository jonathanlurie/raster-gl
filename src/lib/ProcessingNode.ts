// Note: if target canvas is resized: https://webglfundamentals.org/webgl/lessons/webgl-resizing-the-canvas.html

import {
  compileShader,
  createProgram,
} from "./gltools";
import { isArrayOfTexture, isTexture, U_TYPE } from "./typetester";
import defaultVertexShader from "./shaders/default.vs.glsl?raw";
import defaultFragmentShader from "./shaders/default.fs.glsl?raw";
import { Texture } from "./Texture";
import type { RasterContext } from "./RasterContext";

// Many uniform functions exist and they have different signature depending on type
// but this kind of covers all the usages
// biome-ignore lint/suspicious/noExplicitAny: any is necessay here
type UniformFunction  = (location: WebGLUniformLocation | null, ...args: any[]) => void;


type UniformData = {
  /**
   * Name of the uniform as used from within the shader code (eg. "u_myNumber")
   */
  name: string;

  /**
   * Track whether or not the uniform was updated and its value needs to be pushed to GPU
   */
  needsUpdate: boolean;

  /**
   * The value of the uniform
   */
  // value: boolean | number | vec2 | vec3 | vec4, // TODO add sampler and matrices

  /**
   * Memory location. Is `null` if not allocated yet.
   */
  location: WebGLUniformLocation | null;

  /**
   * If the value is a number, its particular type could be forced to uint, int or float
   */
  forcedType?: U_TYPE;

  /**
   * Function to use on the gl context to update this uniform (eg. `gl.uniform1f`)
   */
  uniformFunction: UniformFunction | null;

  /**
   * Array of arguments to pass to `uniformFunction`
   */
  uniformFunctionArguments:
    | number[]
    | number[][]
    | Texture[]
    | Texture[][]
    | null;

  /**
   * Tells if this uniform is a texture
   */
  isTexture?: boolean;

  fragmentTexture?: Texture;
};

/**
 * Color channels: R, G, B and A with values in [0, 1]
 */
export type RGBAUnitColor = [number, number, number, number];

export class ProcessingNode {
  private readonly rasterContext: RasterContext;
  private renderToTexture: boolean;
  private outputWidth: number;
  private outputHeight: number;
  private outputNeedUpdate = true;
  private positionAttributeLocation: number | null = null;
  private compiledVertexShader: WebGLShader | null = null;
  private compiledFragmentShader: WebGLShader | null = null;
  private vertexShaderError: string | null = null;
  private fragmentShaderError: string | null = null;
  private shaderProgram: WebGLProgram | null = null;
  private shaderProgramError: string | null = null;
  private uniforms: { [key: string]: UniformData } = {};
  private clearColor: RGBAUnitColor = [0, 0, 0, 1];
  private outputTexture: WebGLTexture | null = null;
  private framebuffer: WebGLFramebuffer | null = null;
  // private isOffscreen: boolean;
  private readonly uint32: boolean = false;

  constructor(
    rasterContext: RasterContext,
    options: {
      renderToTexture?: boolean,
      width?: number;
      height?: number;
      uint32?: boolean;
    } = {}
  ) {
    this.rasterContext = rasterContext;
    const ctxSize = this.rasterContext.getSize();
    this.renderToTexture = options.renderToTexture ?? false;
    this.outputWidth = options.width ?? ctxSize.width;
    this.outputHeight = options.height ?? ctxSize.height;
    this.uint32 = options.uint32 ?? false;
    const gl = this.rasterContext.getGlContext();

    // Regardless of the render target, the canvas size must be adapted
    if (this.renderToTexture) {
      gl.canvas.width = this.outputWidth;
      gl.canvas.height = this.outputHeight;
    } else {

      if (this.uint32) {
        throw new Error(
          "A Node can only output uint32 when rendering to texture."
        );
      }

      // Particularity for hi-DPI screens
      gl.canvas.width = this.outputWidth * devicePixelRatio;
      gl.canvas.height = this.outputHeight * devicePixelRatio;
      
      if ( !(gl.canvas instanceof OffscreenCanvas)) {
        gl.canvas.style.width = `${this.outputWidth}px`;
        gl.canvas.style.height = `${this.outputHeight}px`;
      }
    }
  }

  setClearColor(color: RGBAUnitColor) {
    this.clearColor[0] = color[0];
    this.clearColor[1] = color[1];
    this.clearColor[2] = color[2];
    this.clearColor[3] = color[3];
  }

  setOutputSize(w: number, h: number) {
    this.outputWidth = w;
    this.outputHeight = h;
    this.outputNeedUpdate = true;
  }

  setRenderToTexture(b: boolean) {
    this.renderToTexture = b;
    this.outputNeedUpdate = true;
  }

  getVertexShaderError(): string | null {
    return this.vertexShaderError;
  }

  getFragmentShaderError(): string | null {
    return this.fragmentShaderError;
  }

  getProgramError(): string | null {
    return this.shaderProgramError;
  }

  private resetProgram() {
    const gl = this.rasterContext.getGlContext();
    gl.deleteProgram(this.shaderProgram);
    this.shaderProgram = null;
    this.shaderProgramError = null;

    gl.deleteShader(this.compiledVertexShader);
    this.compiledVertexShader = null;
    this.vertexShaderError = null;

    gl.deleteShader(this.compiledFragmentShader);
    this.compiledFragmentShader = null;
    this.fragmentShaderError = null;
  }

  setShaderSource(
    options: {
      vertexShaderSource?: string;
      fragmentShaderSource?: string;
      throw?: boolean;
    } = {}
  ) {
    this.resetProgram();

    const shouldThrow = options.throw ?? true;
    const vertexShaderSource =
      options.vertexShaderSource ?? defaultVertexShader;
    const fragmentShaderSource =
      options.fragmentShaderSource ?? defaultFragmentShader;

      const gl = this.rasterContext.getGlContext();
    const vertexShaderData = compileShader(
      gl,
      gl.VERTEX_SHADER,
      vertexShaderSource
    );
    const fragmentShaderData = compileShader(
      gl,
      gl.FRAGMENT_SHADER,
      fragmentShaderSource
    );
    this.compiledVertexShader = vertexShaderData.shader;
    this.compiledFragmentShader = fragmentShaderData.shader;
    this.vertexShaderError = vertexShaderData.error;
    this.fragmentShaderError = fragmentShaderData.error;

    if (shouldThrow && (vertexShaderData.error || fragmentShaderData.error)) {
      if (vertexShaderData.error) {
        throw new Error(vertexShaderData.error);
      }
      if (fragmentShaderData.error) {
        throw new Error(fragmentShaderData.error);
      }
    }

    if (vertexShaderData.shader === null || fragmentShaderData.shader === null)
      return;

    const programData = createProgram(
      gl,
      vertexShaderData.shader,
      fragmentShaderData.shader
    );
    this.shaderProgram = programData.program;
    this.shaderProgramError = programData.error;

    if (shouldThrow && programData.error) {
      throw new Error(programData.error);
    }

    gl.useProgram(this.shaderProgram);
  }

  isProgramValid(): boolean {
    return !!this.shaderProgram;
  }

  /**
   * Add a boolean or an array of boolean a uniform.
   * The type is float by default but can be enforce to a integer
   */
  setUniformBoolean(name: string, value: boolean | boolean[]) {
    const gl = this.rasterContext.getGlContext();
    let u: UniformData;

    if (name in this.uniforms) {
      u = this.uniforms[name];
      u.needsUpdate = true;
    } else {
      u = {
        name,
        needsUpdate: true,
        location: null,
        forcedType: U_TYPE.BOOL,
        uniformFunction: null,
        uniformFunctionArguments: null,
      };
    }

    // If unique boolean, do like a int
    if (typeof value === "boolean") {
      u.uniformFunction = gl.uniform1i;
      u.uniformFunctionArguments = [+value];
      this.uniforms[name] = u;
    }

    // If Array of booleans, do like ints
    else if (
      Array.isArray(value) &&
      value.length > 0 &&
      typeof value[0] === "boolean"
    ) {
      u.uniformFunction = gl.uniform1iv;
      u.uniformFunctionArguments = [value.map((el: boolean) => +el)];
      this.uniforms[name] = u;
    } else {
      console.warn(`Uniform ${name} type mismatch`);
    }
  }

  /**
   * Add a number or an array of numbers a uniform.
   * The type is float by default but can be enforce to a integer
   */
  setUniformNumber(
    name: string,
    value: number | number[],
    type: U_TYPE = U_TYPE.FLOAT
  ) {
    const gl = this.rasterContext.getGlContext();
    let u: UniformData;

    if (name in this.uniforms) {
      u = this.uniforms[name];
      u.needsUpdate = true;
    } else {
      u = {
        name,
        needsUpdate: true,
        location: null,
        forcedType: type,
        uniformFunction: null,
        uniformFunctionArguments: null,
      };
    }

    // If unique float
    if (typeof value === "number" && type === U_TYPE.FLOAT) {
      u.uniformFunction = gl.uniform1f;
      u.uniformFunctionArguments = [value];
      this.uniforms[name] = u;
    }

    // If unique int
    else if (typeof value === "number" && type === U_TYPE.INT) {
      u.uniformFunction = gl.uniform1i;
      u.uniformFunctionArguments = [value];
      this.uniforms[name] = u;
    }

    // If Array of float
    else if (
      Array.isArray(value) &&
      value.length > 0 &&
      typeof value[0] === "number" &&
      type === U_TYPE.FLOAT
    ) {
      u.uniformFunction = gl.uniform1fv;
      u.uniformFunctionArguments = [value];
      this.uniforms[name] = u;
    }

    // If Array of int
    else if (
      Array.isArray(value) &&
      value.length > 0 &&
      typeof value[0] === "number" &&
      type === U_TYPE.INT
    ) {
      u.uniformFunction = gl.uniform1iv;
      u.uniformFunctionArguments = [value];
      this.uniforms[name] = u;
    } else {
      console.warn(`Uniform ${name} type mismatch`);
    }
  }

  /**
   * Add a texture as uniform
   */
  setUniformTexture2D(
    name: string,
    value: Texture /* | Texture[]*/
  ) {
    let u: UniformData;
    const gl = this.rasterContext.getGlContext();

    if (name in this.uniforms) {
      u = this.uniforms[name];
      u.needsUpdate = true;
      u.fragmentTexture?.removeUsageRecord(this, name);
    } else {
      u = {
        name,
        needsUpdate: true,
        location: null,
        uniformFunction: null,
        uniformFunctionArguments: null,
        isTexture: true,
      };
    }

    // A texture
    if (isTexture(value)) {
      u.uniformFunction = gl.uniform1i;
      u.fragmentTexture = value;
      u.fragmentTexture?.addUsageRecord(this, name);
      u.uniformFunctionArguments = [u.fragmentTexture.textureUnit];
      this.uniforms[name] = u;
    }

    // An array of texture
    else if (isArrayOfTexture(value)) {
      // u.uniformFunction = this.gl.uniform1iv;
      // u.uniformFunctionArguments = [value];
      // this.uniforms[name] = u;
      console.warn("Fragment does not support arrays of textures yet.");
    } else {
      console.warn(`Uniform ${name} type mismatch`);
    }
  }

  // setUniformVector2(name: string, value: vec2 | Array<vec2>) {

  // }

  // setUniformVector3(name: string, value: vec3 | Array<vec3>) {

  // }

  // setUniformVector4(name: string, value: vec4 | Array<vec4>) {

  // }

  private initUniforms() {
    const gl = this.rasterContext.getGlContext();
    const program = this.shaderProgram;

    if (!program) {
      return;
    }

    const uniformArray = Object.keys(this.uniforms).map(
      (k: string) => this.uniforms[k]
    );
    const textureUniforms = uniformArray.filter((u) => u.isTexture);
    const nonTextureUniforms = uniformArray.filter((u) => !u.isTexture);

    // biome-ignore lint/complexity/noForEach: <explanation>
    nonTextureUniforms.forEach((u) => {
      if (!u.needsUpdate) return;
      if (!u.uniformFunction) return;
      if (!u.uniformFunctionArguments) return;

      // If it's the first use of this uniform, we have to find a location for it
      u.location ??= gl.getUniformLocation(program, u.name);

      // Set the value
      u.uniformFunction.apply(gl, [
        u.location,
        ...u.uniformFunctionArguments,
      ]);
    });

    // The case of texture uniforms is handled separately.
    // More info: See: https://webglfundamentals.org/webgl/lessons/webgl-2-textures.html
    // biome-ignore lint/complexity/noForEach: <explanation>
    textureUniforms.forEach((u) => {
      if (!u.needsUpdate) return;
      if (!u.uniformFunction) return;
      if (!u.uniformFunctionArguments) return;
      if (!u.fragmentTexture) return;

      // If it's the first use of this uniform, we have to find a location for it
      u.location ??= gl.getUniformLocation(program, u.name);

      const textureUnit = u.fragmentTexture.textureUnit;

      gl.activeTexture(gl.TEXTURE0 + textureUnit);
      gl.bindTexture(gl.TEXTURE_2D, u.fragmentTexture.texture);

      // Set the value
      u.uniformFunction.apply(gl, [u.location, textureUnit]);
    });
  }

  private initPlane() {
    const gl = this.rasterContext.getGlContext();
    if (this.positionAttributeLocation) return;

    const program = this.shaderProgram;

    if (!program) return;
    // gl.bindBuffer(gl.ARRAY_BUFFER, null);

    this.positionAttributeLocation = gl.getAttribLocation(
      program,
      "a_position"
    );

    const positionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);

    // Define the vertices of the rectangle
    const vertices = [-1.0, -1.0, 1.0, -1.0, -1.0, 1.0, 1.0, 1.0];

    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STATIC_DRAW);

    gl.enableVertexAttribArray(this.positionAttributeLocation);
    gl.vertexAttribPointer(
      this.positionAttributeLocation,
      2,
      gl.FLOAT,
      false,
      0,
      0
    );
  }

  /**
   * Get the output texture.
   * Will be `null` if this node was set to render to a canvas.
   * Will be a valid `FragmentTexture` if this node was set to render to texture.
   */
  getOutput(): Texture | null {
    if (!this.outputTexture) return null;

    return new Texture(
      this.outputTexture,
      this.outputWidth,
      this.outputHeight,
      this.uint32 ? 32 : 8
    );
  }

  private initRenderToTextureLogic() {
    // init only if the node renders to texture and the framebuffer and texture are not initialized
    if (!this.renderToTexture || this.outputTexture || this.framebuffer) return;
    
    const gl = this.rasterContext.getGlContext();

    this.outputTexture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.outputTexture);

    // Set the texture parameters
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

    // Define the the texture
    if (this.uint32) {
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA32UI,
        this.outputWidth,
        this.outputHeight,
        0,
        gl.RGBA_INTEGER,
        gl.UNSIGNED_INT,
        null
      );
    } else {
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        this.outputWidth,
        this.outputHeight,
        0,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        null
      );
    }

    // Create a framebuffer object (FBO)
    this.framebuffer = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);

    // Attach the texture as a color attachment to the FBO
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D,
      this.outputTexture,
      0
    );

    // Check if the FBO is complete and properly set up
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      console.error(
        "Framebuffer is not complete.",
        gl.checkFramebufferStatus(gl.FRAMEBUFFER)
      );
    }
  }

  private updateOutput() {
    if (!this.outputNeedUpdate) return;

    const gl = this.rasterContext.getGlContext();

    if (this.renderToTexture && this.outputTexture && this.framebuffer) {
      gl.bindTexture(gl.TEXTURE_2D, this.outputTexture);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
      gl.bindTexture(gl.TEXTURE_2D, null);
    } else {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.canvas.width = this.outputWidth * devicePixelRatio;
      gl.canvas.height = this.outputHeight * devicePixelRatio;

      if (!(gl.canvas instanceof OffscreenCanvas)) {
        gl.canvas.style.width = `${this.outputWidth}px`;
        gl.canvas.style.height = `${this.outputHeight}px`;
      }

      // Set the viewport size to match the canvas size
      // gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
      gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
    }

    this.outputNeedUpdate = false;
  }
/*
  testVertexBuffer() {
    if (!this.shaderProgram) return;

    const gl = this.rasterContext.getGlContext();

    // const bufferAttributeLocation = gl.getAttribLocation(this.shaderProgram, 'a_color');

    // const vertexBuffer = gl.createBuffer();
    // gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);

    // // Define the vertices of the rectangle
    // const verticeData = [
    //   1.0, 0.0, 0.0, 1.0,
    //   0.0, 1.0, 0.0, 1.0,
    //   0.0, 0.0, 1.0, 1.0,
    //   1.0, 1.0, 1.0, 1.0,
    // ];

    // gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(verticeData), gl.STATIC_DRAW);

    // gl.enableVertexAttribArray(bufferAttributeLocation);
    // gl.vertexAttribPointer(bufferAttributeLocation, 4, gl.FLOAT, false, 0, 0);

    const colors = new Float32Array([
      1.0,
      0.0,
      0.0,
      1.0, // Red
      0.0,
      1.0,
      0.0,
      1.0, // Green
      0.0,
      0.0,
      1.0,
      1.0, // Blue
      1.0,
      1.0,
      0.0,
      1.0, // Yellow
    ]);

    const colorBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, colorBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, colors, gl.STATIC_DRAW);

    const colorAttributeLocation = gl.getAttribLocation(
      this.shaderProgram,
      "aColor"
    );

    gl.enableVertexAttribArray(colorAttributeLocation);
    gl.bindBuffer(gl.ARRAY_BUFFER, colorBuffer);
    gl.vertexAttribPointer(colorAttributeLocation, 4, gl.FLOAT, false, 0, 0);
  }
*/

  /**
   * Triggers the rendering of this node.
   */
  render() {
    if (!this.shaderProgram) return;

    const gl = this.rasterContext.getGlContext();
    this.initPlane();
    this.initRenderToTextureLogic();
    this.updateOutput();
    this.initUniforms();

    // this.testVertexBuffer();

    // For some reasons clearing does not work if output is uint32
    if (!this.uint32) {
      gl.clearColor(
        this.clearColor[0],
        this.clearColor[1],
        this.clearColor[2],
        this.clearColor[3]
      );
      gl.clear(gl.COLOR_BUFFER_BIT);
    }

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  dispose() {
    // TODO
  }

  /**
   * Get the pixel data from GPU as a JS typed array. This requires this node to just rendered.
   * Note: if another Node has been redered after this one, then this method will nor work or
   * will retrieve the data from the last rendered node.
   *
   * If this node was instantiated with the option `uint32` being `true`, then the JS typed
   * array will be a Uint32Array, unless the option `asFloat` is `true`. In this case, the
   * returned array will be Float32Array.
   *
   * If this node was instanciated with `uint32` being `false` (which is the default), then
   * the returned typed array is a Uint8Array
   */
  getPixelData(
    asFloat = false
  ): Uint8Array | Uint32Array | Float32Array {
    const gl = this.rasterContext.getGlContext();
    const w = gl.canvas.width;
    const h = gl.canvas.height;

    if (this.uint32 && asFloat) {
      const pixelData = new Uint32Array(w * h * 4);
      gl.readPixels(0, 0, w, h, gl.RGBA_INTEGER, gl.UNSIGNED_INT, pixelData);
      return new Float32Array(pixelData.buffer);
    }

    if (this.uint32 && !asFloat) {
      const pixelData = new Uint32Array(w * h * 4);
      gl.readPixels(0, 0, w, h, gl.RGBA_INTEGER, gl.UNSIGNED_INT, pixelData);
      return pixelData;
    }

    const pixelData = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pixelData);
    return pixelData;
  }

  async getPNGImageBlob(): Promise<Blob | null> {
    if (this.uint32) {
      console.warn("Cannot convert uint32 data into PNG.");
      return null;
    }

    const gl = this.rasterContext.getGlContext();
    const w = gl.canvas.width;
    const h = gl.canvas.height;
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext("2d");

    if (!ctx) {
      console.warn("The ceonxt of the offscreen canvas is null.");
      return null;
    }

    const imageData = new ImageData(w, h);
    const pixelData = this.getPixelData();
    imageData.data.set(pixelData);
    ctx.putImageData(imageData, 0, 0);

    const blob = await canvas.convertToBlob();
    return blob;
  }

  async getPNGImageBuffer(): Promise<ArrayBuffer | null> {
    if (this.uint32) {
      console.warn("Cannot convert uint32 data into PNG.");
      return null;
    }

    const blob = await this.getPNGImageBlob();

    if (!blob) {
      console.warn("The PNG blob could not be created.");
      return null;
    }

    const pngBuffer = await blob.arrayBuffer();
    return pngBuffer;
  }

  async getPNGImageObjectURL(): Promise<string | null> {
    if (this.uint32) {
      console.warn("Cannot convert uint32 data into PNG.");
      return null;
    }

    const blob = await this.getPNGImageBlob();

    if (!blob) {
      console.warn("The PNG blob could not be created.");
      return null;
    }

    return URL.createObjectURL(blob);
  }
}
