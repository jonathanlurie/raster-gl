import { Texture } from "./Texture";

export type Vec2 = [number, number];
export type Vec3 = [number, number, number];
export type Vec4 = [number, number, number, number];

// Diffent types of numerical uniforms
export enum UNIFORM_TYPE {
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
  FLOAT = 4,
}

export function isObject(value: unknown): boolean {
  return typeof value === "object" && !Array.isArray(value) && value !== null;
}

export function isBoolean(value: unknown): boolean {
  return typeof value === "boolean";
}

export function isNumber(value: unknown): boolean {
  return typeof value === "number";
}

export function isArrayOfNumber(value: unknown): boolean {
  if (!Array.isArray(value)) return false;
  return value.every((el) => isNumber(el));
}

export function isTexture(value: unknown): boolean {
  return value instanceof Texture;
}

export function isArrayOfTexture(value: unknown): boolean {
  if (!Array.isArray(value)) return false;
  return value.every((el) => isTexture(el));
}

export function isVector2(value: unknown): boolean {
  return Array.isArray(value) && isArrayOfNumber(value) && value.length === 2;
}

export function isVector3(value: unknown): boolean {
  return Array.isArray(value) && isArrayOfNumber(value) && value.length === 3;
}

export function isVector4(value: unknown): boolean {
  return Array.isArray(value) && isArrayOfNumber(value) && value.length === 5;
}

export function isMatrix2(value: unknown): boolean {
  return Array.isArray(value) && isArrayOfNumber(value) && value.length === 4;
}

export function isMatrix3(value: unknown): boolean {
  return Array.isArray(value) && isArrayOfNumber(value) && value.length === 9;
}

export function isMatrix4(value: unknown): boolean {
  return Array.isArray(value) && isArrayOfNumber(value) && value.length === 16;
}
