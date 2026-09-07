import { freeTextureUnit, getUnusedTextureUnit } from "./gltools";
import type { ProcessingNode } from "./ProcessingNode";
import type { RasterContext } from "./RasterContext";

export type TextureOptions = {
  /**
   * WebGL begin oriented from bottom to top, flipping the texture vertically
   * will have the effect of showing it from its natural orientation.
   * Default: `true`
   */
  verticalFlip?: boolean;

  /**
   * Interpolation of the texture. Bilinear will interpolated the color values in-between the pixel.
   * If not bilinear, then the nearest neighboor pixel lookup will be performed.
   * Default: the RasterContext's bilinear option (true unless configured otherwise).
   */
  bilinear?: boolean;
};

export type UsageRecord = {
  node: ProcessingNode;
  uniformName: string;
};

export async function fetchAsImageBitmap(url: string, abortSignal?: AbortSignal): Promise<ImageBitmap> {
  const response = await fetch(url, { signal: abortSignal });
  if (!response.ok) throw new Error(`Fetch failed: ${response.status}`);
  return createImageBitmap(await response.blob(), { colorSpaceConversion: "none", premultiplyAlpha: "none" });
}

// Uploads must not inherit row strides, premultiplication, or color transforms from earlier calls.
function upload<T>(gl: WebGL2RenderingContext, action: () => T): T {
  const parameters = [
    gl.UNPACK_ALIGNMENT,
    gl.UNPACK_ROW_LENGTH,
    gl.UNPACK_IMAGE_HEIGHT,
    gl.UNPACK_SKIP_PIXELS,
    gl.UNPACK_SKIP_ROWS,
    gl.UNPACK_SKIP_IMAGES,
    gl.UNPACK_FLIP_Y_WEBGL,
    gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,
    gl.UNPACK_COLORSPACE_CONVERSION_WEBGL,
  ];
  const previous = parameters.map((parameter) => gl.getParameter(parameter) as number);
  const binding = gl.getParameter(gl.TEXTURE_BINDING_2D) as WebGLTexture | null;
  const buffer = gl.getParameter(gl.PIXEL_UNPACK_BUFFER_BINDING) as WebGLBuffer | null;
  try {
    gl.bindBuffer(gl.PIXEL_UNPACK_BUFFER, null);
    parameters.forEach((parameter, i) => {
      gl.pixelStorei(parameter, i === 0 ? 1 : 0);
    });
    return action();
  } finally {
    parameters.forEach((parameter, i) => {
      gl.pixelStorei(parameter, previous[i]);
    });
    gl.bindBuffer(gl.PIXEL_UNPACK_BUFFER, buffer);
    gl.bindTexture(gl.TEXTURE_2D, binding);
  }
}

function setFilters(gl: WebGL2RenderingContext, bilinear: boolean) {
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, bilinear ? gl.LINEAR : gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, bilinear ? gl.LINEAR : gl.NEAREST);
}

export class Texture {
  private _width: number;
  private _height: number;
  public readonly bitDepth: number;
  private _textureUnit: number | null = null;
  private _texture: WebGLTexture | null = null;
  private readonly usageRecords: Array<UsageRecord> = [];
  private readonly rasterContext: RasterContext;

  /**
   * Upload an image without color conversion or premultiplication.
   * An ImageBitmap's decode-time color/alpha choices cannot be undone here;
   * create it with colorSpaceConversion and premultiplyAlpha set to "none" for data textures.
   */
  static fromImageSource(rasterContext: RasterContext, image: TexImageSource, options: TextureOptions = {}): Texture {
    const gl = rasterContext.getGlContext();
    let width: number;
    let height: number;
    if (typeof VideoFrame !== "undefined" && image instanceof VideoFrame) {
      width = image.displayWidth;
      height = image.displayHeight;
    } else if (typeof HTMLVideoElement !== "undefined" && image instanceof HTMLVideoElement) {
      width = image.videoWidth;
      height = image.videoHeight;
    } else if (typeof HTMLImageElement !== "undefined" && image instanceof HTMLImageElement) {
      width = image.naturalWidth;
      height = image.naturalHeight;
    } else if ("width" in image && "height" in image) {
      width = image.width;
      height = image.height;
    } else {
      throw new Error("Unsupported image source.");
    }
    if (width <= 0 || height <= 0) throw new Error(`Image dimensions are invalid (${width}, ${height}).`);
    const texture = gl.createTexture();
    if (!texture) throw new Error("Could not allocate texture.");
    try {
      upload(gl, () => {
        gl.bindTexture(gl.TEXTURE_2D, texture);
        const isBitmap = typeof ImageBitmap !== "undefined" && image instanceof ImageBitmap;
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, !isBitmap && (options.verticalFlip ?? true));
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, image);
        setFilters(gl, options.bilinear ?? rasterContext.getDefaultBilinear());
        if (isBitmap && (options.verticalFlip ?? true)) {
          // WebGL ignores UNPACK_FLIP_Y_WEBGL for ImageBitmap. A nearest blit
          // flips bytes on the GPU without a 2D canvas color/alpha round trip.
          Texture.flipBitmapUpload(gl, texture, width, height);
        }
      });
    } catch (error) {
      gl.deleteTexture(texture);
      throw error;
    }
    return new Texture(rasterContext, texture, width, height, 8);
  }

  private static flipBitmapUpload(gl: WebGL2RenderingContext, texture: WebGLTexture, width: number, height: number) {
    const read = gl.getParameter(gl.READ_FRAMEBUFFER_BINDING) as WebGLFramebuffer | null;
    const draw = gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING) as WebGLFramebuffer | null;
    const scissor = gl.isEnabled(gl.SCISSOR_TEST);
    const source = gl.createFramebuffer();
    const target = gl.createFramebuffer();
    const temporary = gl.createTexture();
    try {
      if (!source || !target || !temporary) throw new Error("Could not allocate ImageBitmap flip resources.");
      gl.bindTexture(gl.TEXTURE_2D, temporary);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      setFilters(gl, false);
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, source);
      gl.framebufferTexture2D(gl.READ_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, target);
      gl.framebufferTexture2D(gl.DRAW_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, temporary, 0);
      if (
        gl.checkFramebufferStatus(gl.READ_FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE ||
        gl.checkFramebufferStatus(gl.DRAW_FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE
      ) {
        throw new Error("ImageBitmap flip framebuffer is incomplete.");
      }
      gl.disable(gl.SCISSOR_TEST);
      gl.blitFramebuffer(0, 0, width, height, 0, height, width, 0, gl.COLOR_BUFFER_BIT, gl.NEAREST);
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, target);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.copyTexSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 0, 0, width, height);
    } finally {
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, read);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, draw);
      if (scissor) gl.enable(gl.SCISSOR_TEST);
      gl.deleteFramebuffer(source);
      gl.deleteFramebuffer(target);
      gl.deleteTexture(temporary);
    }
  }

  static async fromURL(rasterContext: RasterContext, url: string, options: TextureOptions = {}): Promise<Texture> {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Fetch failed: ${response.status}`);
    const imageBitmap = await createImageBitmap(await response.blob(), {
      imageOrientation: (options.verticalFlip ?? true) ? "flipY" : "from-image",
      colorSpaceConversion: "none",
      premultiplyAlpha: "none",
    });
    try {
      return Texture.fromImageSource(rasterContext, imageBitmap, { ...options, verticalFlip: false });
    } finally {
      imageBitmap.close();
    }
  }

  static fromData(
    rasterContext: RasterContext,
    data: Uint8Array,
    width: number,
    height: number,
    options: TextureOptions = {},
  ): Texture {
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) {
      throw new Error("Texture dimensions must be positive integers.");
    }
    const channels = data.length / (width * height);
    if (channels !== 3 && channels !== 4) throw new Error("Data textures must contain 3 or 4 elements per pixel.");
    const gl = rasterContext.getGlContext();
    const texture = gl.createTexture();
    if (!texture) throw new Error("Could not allocate texture.");
    let pixels = data;
    if (options.verticalFlip ?? true) {
      pixels = new Uint8Array(data.length);
      const stride = width * channels;
      for (let y = 0; y < height; y++) {
        pixels.set(data.subarray(y * stride, (y + 1) * stride), (height - y - 1) * stride);
      }
    }
    try {
      upload(gl, () => {
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texImage2D(
          gl.TEXTURE_2D,
          0,
          channels === 3 ? gl.RGB8 : gl.RGBA8,
          width,
          height,
          0,
          channels === 3 ? gl.RGB : gl.RGBA,
          gl.UNSIGNED_BYTE,
          pixels,
        );
        setFilters(gl, options.bilinear ?? rasterContext.getDefaultBilinear());
      });
    } catch (error) {
      gl.deleteTexture(texture);
      throw error;
    }
    return new Texture(rasterContext, texture, width, height, 8);
  }

  get width(): number {
    return this._width;
  }
  get height(): number {
    return this._height;
  }

  /** Reallocate storage, retaining this texture's identity for existing node inputs. Contents are discarded. */
  resize(width: number, height: number) {
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) {
      throw new Error("Texture dimensions must be positive integers.");
    }
    const gl = this.rasterContext.getGlContext();
    upload(gl, () => {
      gl.bindTexture(gl.TEXTURE_2D, this.texture);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        this.bitDepth === 32 ? gl.RGBA32UI : gl.RGBA8,
        width,
        height,
        0,
        this.bitDepth === 32 ? gl.RGBA_INTEGER : gl.RGBA,
        this.bitDepth === 32 ? gl.UNSIGNED_INT : gl.UNSIGNED_BYTE,
        null,
      );
    });
    this._width = width;
    this._height = height;
  }

  isFromContext(rasterContext: RasterContext): boolean {
    return this.rasterContext === rasterContext;
  }

  constructor(rasterContext: RasterContext, texture: WebGLTexture, width: number, height: number, bitDepth: number) {
    this._texture = texture;
    this._width = width;
    this._height = height;
    this.bitDepth = bitDepth;
    this.rasterContext = rasterContext;
    this.rasterContext.registerTexture(this);
  }

  get textureUnit(): number {
    this._textureUnit ??= getUnusedTextureUnit(this.rasterContext.getGlContext());

    return this._textureUnit;
  }

  get texture(): WebGLTexture {
    if (!this._texture) {
      throw new Error("This texture is not complete or has been disposed.");
    }
    return this._texture;
  }

  /**
   * Dissociates from its texture unit (if previopusly associated)
   */
  rest() {
    if (this._textureUnit !== null) {
      freeTextureUnit(this._textureUnit, this.rasterContext.getGlContext());
      this._textureUnit = null;
    }
  }

  /**
   * Frees the GPU memory for this texture.
   * After this, the texture is no longer usable.
   */
  free() {
    if (!this._texture) {
      return;
    }

    const gl = this.rasterContext.getGlContext();

    // Unbind if this texture is currently bound in this context.
    // WebGL will generally handle delete + existing bindings gracefully, but
    // unbinding avoids "use-after-free" patterns
    const isBound = gl.getParameter(gl.TEXTURE_BINDING_2D) === this._texture;

    if (isBound) {
      gl.bindTexture(gl.TEXTURE_2D, null);
    }

    gl.deleteTexture(this._texture);
    this._texture = null;

    // Release the (client-side) texture unit bookkeeping.
    this.rest();
  }

  private getIndexUsageRecord(node: ProcessingNode, uniformName: string): number {
    for (let i = 0; i < this.usageRecords.length; i += 1) {
      if (this.usageRecords[i].node === node && this.usageRecords[i].uniformName === uniformName) {
        return i;
      }
    }
    return -1;
  }

  /**
   * Adds a usage record corresponding to a node + uniform
   */
  addUsageRecord(node: ProcessingNode, uniformName: string) {
    const indexExisting = this.getIndexUsageRecord(node, uniformName);
    if (indexExisting >= 0) return;
    this.usageRecords.push({ node, uniformName });
  }

  /**
   * Removes a usage record corresponding to a node + uniform.
   * Puts the texture unit at rest if this texture is no longer in use by
   * any node.
   */
  removeUsageRecord(node: ProcessingNode, uniformName: string) {
    const indexExisting = this.getIndexUsageRecord(node, uniformName);
    if (indexExisting === -1) return;
    this.usageRecords.splice(indexExisting, 1);

    if (this.usageRecords.length === 0) {
      this.rest();
    }
  }
}
