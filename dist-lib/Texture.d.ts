import { ProcessingNode } from './ProcessingNode';
import { RasterContext } from './RasterContext';
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
export declare function fetchAsImageBitmap(url: string, abortSignal?: AbortSignal): Promise<ImageBitmap>;
export declare class Texture {
    readonly width: number;
    readonly height: number;
    readonly bitDepth: number;
    private _textureUnit;
    private _texture;
    private readonly usageRecords;
    private readonly rasterContext;
    /**
     * Instanciate a Texture from an ImageBitmap
     */
    static fromImageSource(rasterContext: RasterContext, image: TexImageSource, options?: TextureOptions): Texture;
    /**
     * Create a Texture instance from the URL of an image (png or jpeg)
     */
    static fromURL(rasterContext: RasterContext, url: string, options?: TextureOptions): Promise<Texture>;
    static fromData(rasterContext: RasterContext, data: Uint8Array, width: number, height: number, options?: TextureOptions): Texture;
    constructor(rasterContext: RasterContext, texture: WebGLTexture, width: number, height: number, bitDepth: number);
    get textureUnit(): number;
    get texture(): WebGLTexture;
    /**
     * Dissociates from its texture unit (if previopusly associated)
     */
    rest(): void;
    /**
     * Frees the GPU memory for this texture.
     * After this, the texture is no longer usable.
     */
    free(): void;
    private getIndexUsageRecord;
    /**
     * Adds a usage record corresponding to a node + uniform
     */
    addUsageRecord(node: ProcessingNode, uniformName: string): void;
    /**
     * Removes a usage record corresponding to a node + uniform.
     * Puts the texture unit at rest if this texture is no longer in use by
     * any node.
     */
    removeUsageRecord(node: ProcessingNode, uniformName: string): void;
}
