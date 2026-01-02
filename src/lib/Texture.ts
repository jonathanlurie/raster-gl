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
   * Default: `true`
   */
  bilinear?: boolean;
};

export type UsageRecord = {
  node: ProcessingNode;
  uniformName: string;
};

const defaultOptionValues: TextureOptions = {
  verticalFlip: true,
  bilinear: true,
};

export async function fetchAsImageBitmap(url: string, abortSignal?: AbortSignal): Promise<ImageBitmap> {
  const response = await fetch(url, { signal: abortSignal });
  if (!response.ok) {
    throw new Error(`Fetch failed: ${response.status}`);
  }

  const blob = await response.blob();
  const imageBitmap = await createImageBitmap(blob);
  return imageBitmap;
}

export class Texture {
  public readonly width: number;
  public readonly height: number;
  public readonly bitDepth: number;
  private _textureUnit: number | null = null;
  private _texture: WebGLTexture | null = null;
  private readonly usageRecords: Array<UsageRecord> = [];
  private readonly rasterContext: RasterContext;

  // TODO: fromFile (with a file picker)

  /**
   * Instanciate a Texture from an ImageBitmap
   */
  static fromImageSource(rasterContext: RasterContext, image: TexImageSource, options: TextureOptions = {}): Texture {
    const gl = rasterContext.getGlContext();

    const optionsWithDefault = {
      ...defaultOptionValues,
      ...options,
    };
    const interpolation = optionsWithDefault.bilinear ? gl.LINEAR : gl.NEAREST;

    const texture = gl.createTexture();

    if (optionsWithDefault.verticalFlip) {
      // Make sure the texture is loaded as flipped to not be upside down
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    }

    gl.bindTexture(gl.TEXTURE_2D, texture);

    // Upload the image data to the texture
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);

    // Set texture parameters (you can adjust these as needed)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, interpolation);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, interpolation);

    // TODO: unbind texture?
    gl.bindTexture(gl.TEXTURE_2D, null);

    if (!texture) {
      throw new Error("Could not load image");
    }

    let width = 0;
    let height = 0;

    if (image instanceof VideoFrame) {
      width = image.codedWidth;
      height = image.codedHeight;
    } else {
      width = image.width;
      height = image.height;
    }

    if (width === 0 || height === 0) {
      throw new Error(`Image dimensions are invalid (${width}, ${height})`);
    }

    return new Texture(rasterContext, texture, width, height, 8);
  }

  /**
   * Create a Texture instance from the URL of an image (png or jpeg)
   */
  static async fromURL(rasterContext: RasterContext, url: string, options: TextureOptions = {}): Promise<Texture> {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Fetch failed: ${response.status}`);
    }

    const blob = await response.blob();
    const imageBitmap = await createImageBitmap(blob);
    return Texture.fromImageSource(rasterContext, imageBitmap, options);
  }

  static fromData(
    rasterContext: RasterContext,
    data: Uint8Array,
    width: number,
    height: number,
    options: TextureOptions = {},
  ): Texture {
    const gl = rasterContext.getGlContext();
    const texture = gl.createTexture();

    const optionsWithDefault = {
      ...defaultOptionValues,
      ...options,
    };
    const interpolation = optionsWithDefault.bilinear ? gl.LINEAR : gl.NEAREST;

    if (!texture) throw new Error("The texture could not be initialized");

    if (optionsWithDefault.verticalFlip) {
      // Make sure the texture is loaded as flipped to not be upside down
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    }

    gl.bindTexture(gl.TEXTURE_2D, texture);

    const numberOfElementPerPixel = data.length / (width * height);

    if (numberOfElementPerPixel === 3) {
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, width, height, 0, gl.RGB, gl.UNSIGNED_BYTE, data);
    } else if (numberOfElementPerPixel === 4) {
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
    } else {
      throw new Error(
        "Invalid number of elements per pixel. The data texture must contain 1, 3 or 4 elements per pixel.",
      );
    }

    // Set texture parameters (you can adjust these as needed)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, interpolation);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, interpolation);

    gl.bindTexture(gl.TEXTURE_2D, null);

    return new Texture(rasterContext, texture, width, height, data.BYTES_PER_ELEMENT * 8);
  }

  constructor(rasterContext: RasterContext, texture: WebGLTexture, width: number, height: number, bitDepth: number) {
    this._texture = texture;
    this.width = width;
    this.height = height;
    this.bitDepth = bitDepth;
    this.rasterContext = rasterContext;
    this.rasterContext.registerTexture(this);
  }

  get textureUnit(): number {
    this._textureUnit ??= getUnusedTextureUnit();

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
      freeTextureUnit(this._textureUnit);
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
