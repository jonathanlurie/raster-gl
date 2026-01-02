import { RasterContext } from './RasterContext';
import { Texture } from './Texture';
import { UNIFORM_TYPE, Vec2, Vec3, Vec4 } from './typetester';
/**
 * Color channels: R, G, B and A with values in [0, 1]
 */
export type RGBAUnitColor = [number, number, number, number];
export declare class ProcessingNode {
    private readonly rasterContext;
    private renderToTexture;
    private readonly reuseOutputTexture;
    private outputWidth;
    private outputHeight;
    private outputNeedUpdate;
    private positionAttributeLocation;
    private compiledVertexShader;
    private compiledFragmentShader;
    private vertexShaderError;
    private fragmentShaderError;
    private shaderProgram;
    private shaderProgramError;
    private uniforms;
    private clearColor;
    private outputTexture;
    private framebuffer;
    private positionBuffer;
    private readonly uint32;
    constructor(rasterContext: RasterContext, options?: {
        renderToTexture?: boolean;
        /**
         * When true, the same output texture is reused for every render call (convenient for multipass animation)
         * When false, a new texture is created for each render call (convenient to reuse the same node to create different outputs)
         * Used only if renderToTexture is true.
         */
        reuseOutputTexture?: boolean;
        width?: number;
        height?: number;
        uint32?: boolean;
        /**
         * The clear color is of form RGBA where each channel is a value in [0, 1].
         * Default: [0, 0, 0, 1]
         */
        clearColor?: [number, number, number, number];
    });
    setClearColor(color: RGBAUnitColor): void;
    setOutputSize(w: number, h: number): void;
    setRenderToTexture(b: boolean): void;
    getVertexShaderError(): string | null;
    getFragmentShaderError(): string | null;
    getProgramError(): string | null;
    private resetProgram;
    setShaderSource(options?: {
        vertexShaderSource?: string;
        fragmentShaderSource?: string;
        throw?: boolean;
    }): void;
    isProgramValid(): boolean;
    /**
     * Add a boolean or an array of boolean a uniform.
     * The type is float by default but can be enforce to a integer
     */
    setUniformBoolean(name: string, value: boolean | boolean[]): void;
    /**
     * Add a number or an array of numbers a uniform.
     * The type is float by default but can be enforce to a integer
     */
    setUniformNumber(name: string, value: number | number[], type?: UNIFORM_TYPE): void;
    /**
     * Add a texture as uniform
     */
    setUniformTexture2D(name: string, value: Texture | ProcessingNode): void;
    setUniformVector2(name: string, value: Vec2, type?: UNIFORM_TYPE): void;
    setUniformVector3(name: string, value: Vec3, type?: UNIFORM_TYPE): void;
    setUniformVector4(name: string, value: Vec4, type?: UNIFORM_TYPE): void;
    /**
     * Set a RGB color as uniform, where each color channel is in [0, 255]
     */
    setUniformRGB(name: string, value: Vec3): void;
    /**
     * Set a RGB color as uniform, where each color channel (RGB) is in [0, 255]
     * and transparency is in [0, 1]
     */
    setUniformRGBA(name: string, value: Vec4): void;
    private initUniforms;
    private initPlane;
    /**
     * Get the output texture.
     * Will be `null` if this node was set to render to a canvas.
     * Will be a valid `FragmentTexture` if this node was set to render to texture.
     */
    getOutputTexture(): Texture;
    private initRenderToTextureLogic;
    private updateOutput;
    /**
     * Triggers the rendering of this node.
     */
    render(): void;
    dispose(): void;
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
    getPixelData(asFloat?: boolean): Uint8Array | Uint32Array | Float32Array;
    getImageData(): ImageData;
    getImageBitmap(): Promise<ImageBitmap>;
    getNewOffscreenCanvas(): OffscreenCanvas;
    getPNGImageBlob(): Promise<Blob | null>;
    getPNGImageBuffer(): Promise<ArrayBuffer | null>;
    getPNGImageObjectURL(): Promise<string | null>;
    doesOutputNeedUpdate(): boolean;
    /**
     * Freeing element from GPU memory
     */
    free(): void;
}
