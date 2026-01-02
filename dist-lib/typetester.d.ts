export type Vec2 = [number, number];
export type Vec3 = [number, number, number];
export type Vec4 = [number, number, number, number];
export declare enum UNIFORM_TYPE {
    /**
     * Boolean
     */
    BOOL = 1,
    /**
     * Signed integer
     */
    INT = 3,
    /**
     * Float
     */
    FLOAT = 4
}
export declare function isObject(value: unknown): boolean;
export declare function isBoolean(value: unknown): boolean;
export declare function isNumber(value: unknown): boolean;
export declare function isArrayOfNumber(value: unknown): boolean;
export declare function isTexture(value: unknown): boolean;
export declare function isArrayOfTexture(value: unknown): boolean;
export declare function isVector2(value: unknown): boolean;
export declare function isVector3(value: unknown): boolean;
export declare function isVector4(value: unknown): boolean;
export declare function isMatrix2(value: unknown): boolean;
export declare function isMatrix3(value: unknown): boolean;
export declare function isMatrix4(value: unknown): boolean;
