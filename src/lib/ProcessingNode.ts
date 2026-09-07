// Note: if target canvas is resized: https://webglfundamentals.org/webgl/lessons/webgl-resizing-the-canvas.html

import { compileShader, createProgram } from "./gltools";
import type { RasterContext } from "./RasterContext";
import defaultFragmentShader from "./shaders/default.fs.glsl?raw";
import defaultVertexShader from "./shaders/default.vs.glsl?raw";
import { Texture } from "./Texture";
import { UNIFORM_TYPE, type Vec2, type Vec3, type Vec4 } from "./typetester";

// Many uniform functions exist and they have different signature depending on type
// but this kind of covers all the usages
type UniformFunction = (location: WebGLUniformLocation | null, ...args: any[]) => void;

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
  forcedType?: UNIFORM_TYPE;

  /**
   * Function to use on the gl context to update this uniform (eg. `gl.uniform1f`)
   */
  uniformFunction: UniformFunction | null;

  /**
   * Array of arguments to pass to `uniformFunction`
   */
  uniformFunctionArguments: number[] | number[][] | Texture[] | Texture[][] | null;

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
  private readonly reuseOutputTexture: boolean;
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
  private outputTexture: Texture | null = null;
  private framebuffer: WebGLFramebuffer | null = null;
  private positionBuffer: WebGLBuffer | null = null;
  private vertexArray: WebGLVertexArrayObject | null = null;
  private readonly bilinear: boolean;
  private readonly uint32: boolean = false;

  constructor(
    rasterContext: RasterContext,
    options: {
      renderToTexture?: boolean;

      /**
       * When true, the same output texture is reused for every render call (convenient for multipass animation)
       * When false, a new texture is created for each render call (convenient to reuse the same node to create different outputs)
       * Used only if renderToTexture is true.
       */
      reuseOutputTexture?: boolean;
      /** Output width in pixels, independent of devicePixelRatio. */
      width?: number;
      /** Output height in pixels, independent of devicePixelRatio. */
      height?: number;
      /** Filter for output textures. Defaults to RasterContext's bilinear option. Integer outputs always use nearest. */
      bilinear?: boolean;
      uint32?: boolean;

      /**
       * The clear color is of form RGBA where each channel is a value in [0, 1].
       * Default: [0, 0, 0, 1]
       */
      clearColor?: [number, number, number, number];
    } = {},
  ) {
    this.rasterContext = rasterContext;
    const ctxSize = this.rasterContext.getSize();
    this.renderToTexture = options.renderToTexture ?? false;
    this.reuseOutputTexture = options.reuseOutputTexture ?? true;
    this.outputWidth = options.width ?? ctxSize.width;
    this.outputHeight = options.height ?? ctxSize.height;
    this.uint32 = options.uint32 ?? false;
    this.bilinear = options.bilinear ?? rasterContext.getDefaultBilinear();
    this.setOutputSize(this.outputWidth, this.outputHeight);
    this.setRenderToTexture(this.renderToTexture);
    this.setClearColor(options.clearColor ?? [0, 0, 0, 1]);
    this.rasterContext.registerProcessingNode(this);
  }

  setClearColor(color: RGBAUnitColor) {
    this.outputNeedUpdate = true;
    this.clearColor[0] = color[0];
    this.clearColor[1] = color[1];
    this.clearColor[2] = color[2];
    this.clearColor[3] = color[3];
  }

  setOutputSize(w: number, h: number) {
    if (!Number.isSafeInteger(w) || !Number.isSafeInteger(h) || w <= 0 || h <= 0) {
      throw new Error("Output dimensions must be positive integers.");
    }
    this.outputWidth = w;
    this.outputHeight = h;
    this.outputNeedUpdate = true;
  }

  setRenderToTexture(b: boolean) {
    if (!b && this.uint32) throw new Error("A Node can only output uint32 when rendering to texture.");
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
    gl.deleteVertexArray(this.vertexArray);
    this.vertexArray = null;
    this.positionAttributeLocation = null;
    for (const uniform of Object.values(this.uniforms)) {
      uniform.location = null;
      uniform.needsUpdate = true;
    }
    this.outputNeedUpdate = true;
  }

  setShaderSource(options: { vertexShaderSource?: string; fragmentShaderSource?: string; throw?: boolean } = {}) {
    this.resetProgram();

    const shouldThrow = options.throw ?? true;
    const vertexShaderSource = options.vertexShaderSource ?? defaultVertexShader;
    const fragmentShaderSource = options.fragmentShaderSource ?? defaultFragmentShader;

    const gl = this.rasterContext.getGlContext();
    const vertexShaderData = compileShader(gl, gl.VERTEX_SHADER, vertexShaderSource);
    const fragmentShaderData = compileShader(gl, gl.FRAGMENT_SHADER, fragmentShaderSource);
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

    if (vertexShaderData.shader === null || fragmentShaderData.shader === null) return;

    const programData = createProgram(gl, vertexShaderData.shader, fragmentShaderData.shader);
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
    this.outputNeedUpdate = true;
    const gl = this.rasterContext.getGlContext();
    let u: UniformData;

    if (name in this.uniforms) {
      u = this.uniforms[name];
      u.fragmentTexture?.removeUsageRecord(this, name);
      u.fragmentTexture = undefined;
      u.isTexture = false;
      u.needsUpdate = true;
    } else {
      u = {
        name,
        needsUpdate: true,
        location: null,
        forcedType: UNIFORM_TYPE.BOOL,
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
    else if (Array.isArray(value) && value.length > 0 && typeof value[0] === "boolean") {
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
  setUniformNumber(name: string, value: number | number[], type: UNIFORM_TYPE = UNIFORM_TYPE.FLOAT) {
    this.outputNeedUpdate = true;
    const gl = this.rasterContext.getGlContext();
    let u: UniformData;

    if (name in this.uniforms) {
      u = this.uniforms[name];
      u.fragmentTexture?.removeUsageRecord(this, name);
      u.fragmentTexture = undefined;
      u.isTexture = false;
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
    if (typeof value === "number" && type === UNIFORM_TYPE.FLOAT) {
      u.uniformFunction = gl.uniform1f;
      u.uniformFunctionArguments = [value];
      this.uniforms[name] = u;
    }

    // If unique int
    else if (typeof value === "number" && type === UNIFORM_TYPE.INT) {
      u.uniformFunction = gl.uniform1i;
      u.uniformFunctionArguments = [value];
      this.uniforms[name] = u;
    }

    // If Array of float
    else if (Array.isArray(value) && value.length > 0 && typeof value[0] === "number" && type === UNIFORM_TYPE.FLOAT) {
      u.uniformFunction = gl.uniform1fv;
      u.uniformFunctionArguments = [value];
      this.uniforms[name] = u;
    }

    // If Array of int
    else if (Array.isArray(value) && value.length > 0 && typeof value[0] === "number" && type === UNIFORM_TYPE.INT) {
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
  setUniformTexture2D(name: string, value: Texture | ProcessingNode) {
    const texture = value instanceof ProcessingNode ? value.getOutputTexture() : value;
    if (!texture.isFromContext(this.rasterContext)) {
      throw new Error("A texture must belong to the same RasterContext as its node.");
    }
    this.uniforms[name]?.fragmentTexture?.removeUsageRecord(this, name);
    texture.addUsageRecord(this, name);
    this.uniforms[name] = {
      name,
      needsUpdate: true,
      location: this.uniforms[name]?.location ?? null,
      uniformFunction: null,
      uniformFunctionArguments: null,
      isTexture: true,
      fragmentTexture: texture,
    };
    this.outputNeedUpdate = true;
  }

  setUniformVector2(name: string, value: Vec2 /*| Array<Vec2>*/, type: UNIFORM_TYPE = UNIFORM_TYPE.FLOAT) {
    this.outputNeedUpdate = true;
    const gl = this.rasterContext.getGlContext();
    let u: UniformData;

    if (name in this.uniforms) {
      u = this.uniforms[name];
      u.fragmentTexture?.removeUsageRecord(this, name);
      u.fragmentTexture = undefined;
      u.isTexture = false;
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

    // If Vec2 of floats
    if (type === UNIFORM_TYPE.FLOAT) {
      u.uniformFunction = gl.uniform2f;
      u.uniformFunctionArguments = [value[0], value[1]];
      this.uniforms[name] = u;
    }

    // If Vec2 of ints
    else if (type === UNIFORM_TYPE.INT) {
      u.uniformFunction = gl.uniform2i;
      u.uniformFunctionArguments = [value[0], value[1]];
      this.uniforms[name] = u;
    } else {
      console.warn(`Uniform ${name} type mismatch`);
    }
  }

  setUniformVector3(name: string, value: Vec3 /*| Array<vec3>*/, type: UNIFORM_TYPE = UNIFORM_TYPE.FLOAT) {
    this.outputNeedUpdate = true;
    const gl = this.rasterContext.getGlContext();
    let u: UniformData;

    if (name in this.uniforms) {
      u = this.uniforms[name];
      u.fragmentTexture?.removeUsageRecord(this, name);
      u.fragmentTexture = undefined;
      u.isTexture = false;
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

    // If Vec2 of floats
    if (type === UNIFORM_TYPE.FLOAT) {
      u.uniformFunction = gl.uniform3f;
      u.uniformFunctionArguments = [value[0], value[1], value[2]];
      this.uniforms[name] = u;
    }

    // If Vec2 of ints
    else if (type === UNIFORM_TYPE.INT) {
      u.uniformFunction = gl.uniform3i;
      u.uniformFunctionArguments = [value[0], value[1], value[2]];
      this.uniforms[name] = u;
    } else {
      console.warn(`Uniform ${name} type mismatch`);
    }
  }

  setUniformVector4(name: string, value: Vec4 /*| Array<vec4>*/, type: UNIFORM_TYPE = UNIFORM_TYPE.FLOAT) {
    this.outputNeedUpdate = true;
    const gl = this.rasterContext.getGlContext();
    let u: UniformData;

    if (name in this.uniforms) {
      u = this.uniforms[name];
      u.fragmentTexture?.removeUsageRecord(this, name);
      u.fragmentTexture = undefined;
      u.isTexture = false;
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

    // If Vec2 of floats
    if (type === UNIFORM_TYPE.FLOAT) {
      u.uniformFunction = gl.uniform4f;
      u.uniformFunctionArguments = [value[0], value[1], value[2], value[3]];
      this.uniforms[name] = u;
    }

    // If Vec2 of ints
    else if (type === UNIFORM_TYPE.INT) {
      u.uniformFunction = gl.uniform4i;
      u.uniformFunctionArguments = [value[0], value[1], value[2], value[3]];
      this.uniforms[name] = u;
    } else {
      console.warn(`Uniform ${name} type mismatch`);
    }
  }

  /**
   * Set a RGB color as uniform, where each color channel is in [0, 255]
   */
  setUniformRGB(name: string, value: Vec3) {
    this.setUniformVector3(name, [value[0] / 255, value[1] / 255, value[2] / 255]);
  }

  /**
   * Set a RGB color as uniform, where each color channel (RGB) is in [0, 255]
   * and transparency is in [0, 1]
   */
  setUniformRGBA(name: string, value: Vec4) {
    this.setUniformVector4(name, [value[0] / 255, value[1] / 255, value[2] / 255, value[3]]);
  }

  private initUniforms() {
    const gl = this.rasterContext.getGlContext();
    const program = this.shaderProgram;

    if (!program) {
      return;
    }

    const uniformArray = Object.keys(this.uniforms).map((k: string) => this.uniforms[k]);
    const textureUniforms = uniformArray.filter((u) => u.isTexture);
    const nonTextureUniforms = uniformArray.filter((u) => !u.isTexture);

    for (const u of nonTextureUniforms) {
      if (!u.needsUpdate) continue;
      if (!u.uniformFunction) continue;
      if (!u.uniformFunctionArguments) continue;

      // If it's the first use of this uniform, we have to find a location for it
      u.location ??= gl.getUniformLocation(program, u.name);

      // Set the value
      u.uniformFunction.apply(gl, [u.location, ...u.uniformFunctionArguments]);

      u.needsUpdate = false;
    }

    // Texture bindings are context state, so restore them on every draw.
    const units = new Map<Texture, number>();
    const maxUnits = gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS) as number;
    for (const u of textureUniforms) {
      if (!u.fragmentTexture) continue;
      u.location ??= gl.getUniformLocation(program, u.name);
      if (u.location === null) continue;
      if (this.renderToTexture && u.fragmentTexture === this.outputTexture) {
        throw new Error("A node cannot sample its own render target. Use two textures for feedback.");
      }
      let unit = units.get(u.fragmentTexture);
      if (unit === undefined) {
        unit = units.size;
        if (unit >= maxUnits) throw new Error(`This draw exceeds the ${maxUnits} texture unit limit.`);
        units.set(u.fragmentTexture, unit);
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindSampler(unit, null);
        gl.bindTexture(gl.TEXTURE_2D, u.fragmentTexture.texture);
      }
      gl.uniform1i(u.location, unit);
      u.needsUpdate = false;
    }
  }

  private initPlane() {
    const gl = this.rasterContext.getGlContext();
    if (!this.shaderProgram) return;
    if (!this.vertexArray) {
      this.vertexArray = gl.createVertexArray();
      if (!this.vertexArray) throw new Error("Could not allocate vertex array.");
      gl.bindVertexArray(this.vertexArray);
      if (!this.positionBuffer) {
        this.positionBuffer = gl.createBuffer();
        if (!this.positionBuffer) throw new Error("Could not allocate vertex buffer.");
        gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
      } else {
        gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
      }
      this.positionAttributeLocation = gl.getAttribLocation(this.shaderProgram, "a_position");
      // Custom vertex shaders may use gl_VertexID instead.
      if (this.positionAttributeLocation >= 0) {
        gl.enableVertexAttribArray(this.positionAttributeLocation);
        gl.vertexAttribPointer(this.positionAttributeLocation, 2, gl.FLOAT, false, 0, 0);
      }
    }
    gl.bindVertexArray(this.vertexArray);
  }

  /**
   * Get the output texture.
   * Canvas outputs are copied through CPU readback; texture outputs stay on the GPU.
   */
  getOutputTexture(): Texture {
    // Force a rendering if necessary
    if (this.outputNeedUpdate) {
      this.render();
    }

    if (!this.renderToTexture || !this.outputTexture) {
      console.warn("[GPU readback necessary] This node is not rendering to a texture.");
      return Texture.fromImageSource(this.rasterContext, this.getNewOffscreenCanvas());
    }

    return this.outputTexture;
  }

  private initRenderToTextureLogic() {
    if (!this.renderToTexture) return;
    const gl = this.rasterContext.getGlContext();
    if (!this.outputTexture || !this.reuseOutputTexture) {
      const texture = gl.createTexture();
      if (!texture) throw new Error("Could not allocate output texture.");
      this.outputTexture = new Texture(
        this.rasterContext,
        texture,
        this.outputWidth,
        this.outputHeight,
        this.uint32 ? 32 : 8,
      );
      this.outputTexture.resize(this.outputWidth, this.outputHeight);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      const filter = this.uint32 || !this.bilinear ? gl.NEAREST : gl.LINEAR;
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    } else if (this.outputTexture.width !== this.outputWidth || this.outputTexture.height !== this.outputHeight) {
      this.outputTexture.resize(this.outputWidth, this.outputHeight);
    }
    this.framebuffer ??= gl.createFramebuffer();
    if (!this.framebuffer) throw new Error("Could not allocate framebuffer.");
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.outputTexture.texture, 0);
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (status !== gl.FRAMEBUFFER_COMPLETE) throw new Error(`Framebuffer is incomplete: 0x${status.toString(16)}.`);
  }

  private updateOutput() {
    const gl = this.rasterContext.getGlContext();
    if (this.renderToTexture) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
      gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
    } else {
      // Computational dimensions never depend on display density, including in workers.
      if (gl.canvas.width !== this.outputWidth) gl.canvas.width = this.outputWidth;
      if (gl.canvas.height !== this.outputHeight) gl.canvas.height = this.outputHeight;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.drawBuffers([gl.BACK]);
    }
    gl.viewport(0, 0, this.outputWidth, this.outputHeight);
  }

  /** Triggers the rendering of this node. Each draw restores all raster state it uses. */
  render() {
    if (!this.shaderProgram) return;
    const gl = this.rasterContext.getGlContext();
    this.initRenderToTextureLogic();
    this.updateOutput();
    gl.useProgram(this.shaderProgram);
    this.initPlane();
    this.initUniforms();
    gl.disable(gl.DITHER);
    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.STENCIL_TEST);
    gl.disable(gl.SCISSOR_TEST);
    gl.disable(gl.CULL_FACE);
    gl.disable(gl.RASTERIZER_DISCARD);
    gl.disable(gl.SAMPLE_ALPHA_TO_COVERAGE);
    gl.disable(gl.SAMPLE_COVERAGE);
    gl.colorMask(true, true, true, true);
    if (this.uint32) {
      gl.clearBufferuiv(gl.COLOR, 0, new Uint32Array(this.clearColor));
    } else {
      gl.clearColor(...this.clearColor);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    this.outputNeedUpdate = false;
  }

  dispose() {
    this.free();
  }

  /**
   * Read this node's output. Raw rows are bottom-to-top, as in WebGL.
   * Dirty texture outputs and canvas outputs are rendered before readback.
   * Canvas outputs must be redrawn because their shared buffer may have been overwritten or discarded.
   *
   * If this node was instantiated with the option `uint32` being `true`, then the JS typed
   * array will be a Uint32Array, unless the option `asFloat` is `true`. In this case, the
   * returned array will be Float32Array.
   *
   * If this node was instanciated with `uint32` being `false` (which is the default), then
   * the returned typed array is a Uint8Array
   */
  getPixelData(options: { asFloat?: boolean; x?: number; y?: number; w?: number; h?: number } = {}): {
    data: Uint8Array | Uint32Array | Float32Array;
    width: number;
    height: number;
  } {
    const gl = this.rasterContext.getGlContext();

    for (const value of [options.x, options.y, options.w, options.h]) {
      if (value !== undefined && !Number.isFinite(value)) throw new Error("Readback bounds must be finite.");
    }
    if (this.outputNeedUpdate || !this.renderToTexture) this.render();
    if (!this.shaderProgram) throw new Error("Cannot read pixels without a valid shader program.");
    const previousFramebuffer = gl.getParameter(gl.READ_FRAMEBUFFER_BINDING) as WebGLFramebuffer | null;
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.renderToTexture ? this.framebuffer : null);
    const previousReadBuffer = gl.getParameter(gl.READ_BUFFER) as number;
    gl.readBuffer(this.renderToTexture ? gl.COLOR_ATTACHMENT0 : gl.BACK);
    const canvasW = this.outputWidth;
    const canvasH = this.outputHeight;

    const asFloat = options.asFloat ?? false;
    const x = typeof options.x === "number" ? Math.max(0, Math.min(canvasW - 1, Math.floor(options.x))) : 0;
    const y = typeof options.y === "number" ? Math.max(0, Math.min(canvasH - 1, Math.floor(options.y))) : 0;
    const w = typeof options.w === "number" ? Math.max(1, Math.min(canvasW - x, Math.floor(options.w))) : canvasW - x;
    const h = typeof options.h === "number" ? Math.max(1, Math.min(canvasH - y, Math.floor(options.h))) : canvasH - y;

    const pixelData = this.uint32 ? new Uint32Array(w * h * 4) : new Uint8Array(w * h * 4);
    const packBuffer = gl.getParameter(gl.PIXEL_PACK_BUFFER_BINDING) as WebGLBuffer | null;
    const packState = [gl.PACK_ALIGNMENT, gl.PACK_ROW_LENGTH, gl.PACK_SKIP_PIXELS, gl.PACK_SKIP_ROWS];
    const previousPackState = packState.map((parameter) => gl.getParameter(parameter) as number);
    try {
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
      packState.forEach((parameter, i) => {
        gl.pixelStorei(parameter, i === 0 ? 1 : 0);
      });
      gl.readPixels(
        x,
        y,
        w,
        h,
        this.uint32 ? gl.RGBA_INTEGER : gl.RGBA,
        this.uint32 ? gl.UNSIGNED_INT : gl.UNSIGNED_BYTE,
        pixelData,
      );
    } finally {
      packState.forEach((parameter, i) => {
        gl.pixelStorei(parameter, previousPackState[i]);
      });
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, packBuffer);
      gl.readBuffer(previousReadBuffer);
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, previousFramebuffer);
    }
    return { data: this.uint32 && asFloat ? new Float32Array(pixelData.buffer) : pixelData, width: w, height: h };
  }

  getImageData(options: { x?: number; y?: number; w?: number; h?: number } = {}): ImageData {
    if (this.uint32) {
      throw new Error("Uint32 image cannot be used to create an RGBA8 image.");
    }

    const pixelData = this.getPixelData(options);
    const imageData = new ImageData(pixelData.width, pixelData.height);
    const stride = pixelData.width * 4;
    for (let y = 0; y < pixelData.height; y++) {
      const source = (pixelData.height - y - 1) * stride;
      imageData.data.set(pixelData.data.subarray(source, source + stride), y * stride);
    }
    return imageData;
  }

  async getImageBitmap(options: { x?: number; y?: number; w?: number; h?: number } = {}): Promise<ImageBitmap> {
    const imageData = this.getImageData(options);
    return createImageBitmap(imageData);
  }

  getNewOffscreenCanvas(options: { x?: number; y?: number; w?: number; h?: number } = {}): OffscreenCanvas {
    const imageData = this.getImageData(options);
    const canvas = new OffscreenCanvas(imageData.width, imageData.height);
    const ctx = canvas.getContext("2d") as OffscreenCanvasRenderingContext2D;
    ctx.putImageData(imageData, 0, 0);
    return canvas;
  }

  async getPNGImageBlob(options: { x?: number; y?: number; w?: number; h?: number } = {}): Promise<Blob | null> {
    const canvas = this.getNewOffscreenCanvas(options);
    const blob = await canvas.convertToBlob();
    return blob;
  }

  async getPNGImageBuffer(
    options: { x?: number; y?: number; w?: number; h?: number } = {},
  ): Promise<ArrayBuffer | null> {
    if (this.uint32) {
      console.warn("Cannot convert uint32 data into PNG.");
      return null;
    }

    const blob = await this.getPNGImageBlob(options);

    if (!blob) {
      console.warn("The PNG blob could not be created.");
      return null;
    }

    const pngBuffer = await blob.arrayBuffer();
    return pngBuffer;
  }

  async getPNGImageObjectURL(options: { x?: number; y?: number; w?: number; h?: number } = {}): Promise<string | null> {
    if (this.uint32) {
      console.warn("Cannot convert uint32 data into PNG.");
      return null;
    }

    const blob = await this.getPNGImageBlob(options);

    if (!blob) {
      console.warn("The PNG blob could not be created.");
      return null;
    }

    return URL.createObjectURL(blob);
  }

  doesOutputNeedUpdate(): boolean {
    return this.outputNeedUpdate;
  }

  /**
   * Freeing element from GPU memory
   */
  free() {
    const gl = this.rasterContext.getGlContext();

    if (this.framebuffer) {
      // Detach any attachment to avoid keeping references alive
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, null, 0);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);

      gl.deleteFramebuffer(this.framebuffer);
      this.framebuffer = null;
    }

    if (this.outputTexture) {
      this.outputTexture.free();
      this.outputTexture = null;
    }
    for (const uniform of Object.values(this.uniforms)) {
      uniform.fragmentTexture?.removeUsageRecord(this, uniform.name);
    }
    this.uniforms = {};

    this.resetProgram();

    if (this.positionBuffer) {
      gl.deleteBuffer(this.positionBuffer);
      this.positionBuffer = null;
    }
  }
}
