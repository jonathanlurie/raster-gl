export type RasterContextOptions = {
  /**
   * Width of the canvas.
   * Note that each ProcessingNode can have a width different from the RasterContext
   * it is bound to.
   */
  width: number,

  /**
   * Height of the canvas.
   * Note that each ProcessingNode can have a height different from the RasterContext
   * it is bound to.
   */
  height: number,

  /**
   * If true, internally instantiates an OffscreenCanvas instead of an HTML Canvas Element.
   * This is particularly handy for web workers.
   * Default: false
   */
  offscreen?: boolean
}


export class RasterContext {
  private readonly canvas: HTMLCanvasElement | OffscreenCanvas;
  private readonly width: number;
  private readonly height: number;
  private readonly offscreen: boolean;
  private readonly gl: WebGL2RenderingContext;

  constructor(options: RasterContextOptions) {
    this.offscreen = options.offscreen ?? false;
    this.width = options.width;
    this.height = options.height;

    if (this.offscreen) {
      this.canvas = new OffscreenCanvas(this.width, this.height);
    } else {
      this.canvas = document.createElement("canvas");
      this.canvas.width = this.width;
      this.canvas.height = this.width;
    }

    const gl = this.canvas.getContext("webgl2") as WebGL2RenderingContext;

    if (!gl) {
      throw new Error("This device is not compatible with WebGL2");
    }

    this.gl = gl;
  }

  getCanvas(): HTMLCanvasElement | OffscreenCanvas {
    return this.canvas;
  }

  getGlContext(): WebGL2RenderingContext {
    return this.gl;
  }

  getSize(): {width: number, height: number} {
    return {
      width: this.width,
      height: this.height,
    }
  }

  isOffscreen(): boolean {
    return this.offscreen;
  }


}