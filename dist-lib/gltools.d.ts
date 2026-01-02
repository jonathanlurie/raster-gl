export declare const DEFAULT_WIDTH = 512;
export declare const DEFAULT_HEIGHT = 512;
export declare function getUnusedTextureUnit(): number;
export declare function freeTextureUnit(i: number): void;
export declare function getCurrentTextureUnit(): number;
export declare function incrementCurrentTextureUnit(): void;
export declare function getShaderCompileError(gl: WebGL2RenderingContext, vertexShaderSource: string, fragmentShaderSource: string): {
    vertexShaderMessages: string | null;
    fragmentShaderMessages: string | null;
};
export declare function createProgram(gl: WebGL2RenderingContext, vertexShader: WebGLShader, fragmentShader: WebGLShader): {
    program: WebGLProgram | null;
    error: string | null;
};
export declare function compileShader(gl: WebGL2RenderingContext, type: number, source: string): {
    shader: WebGLShader | null;
    error: string | null;
};
export declare function prepareGlContext(options: {
    canvasElemId?: string;
    width: number;
    height: number;
}): WebGL2RenderingContext;
