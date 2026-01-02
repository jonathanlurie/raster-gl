import { ProcessingNode } from './ProcessingNode';
import { Texture } from './Texture';
export type RasterContextOptions = {
    /**
     * Width of the canvas.
     * Note that each ProcessingNode can have a width different from the RasterContext
     * it is bound to.
     */
    width: number;
    /**
     * Height of the canvas.
     * Note that each ProcessingNode can have a height different from the RasterContext
     * it is bound to.
     */
    height: number;
    /**
     * If true, internally instantiates an OffscreenCanvas instead of an HTML Canvas Element.
     * This is particularly handy for web workers.
     * Default: false
     */
    offscreen?: boolean;
};
export declare class RasterContext {
    private readonly canvas;
    private readonly width;
    private readonly height;
    private readonly offscreen;
    private readonly gl;
    private readonly registeredTextures;
    private readonly registeredProcessingNodes;
    constructor(options: RasterContextOptions);
    getCanvas(): HTMLCanvasElement | OffscreenCanvas;
    getGlContext(): WebGL2RenderingContext;
    getSize(): {
        width: number;
        height: number;
    };
    isOffscreen(): boolean;
    registerTexture(tex: Texture): void;
    registerProcessingNode(node: ProcessingNode): void;
    /**
     * Free textures and processing nodes from GPU memory
     */
    free(): void;
}
