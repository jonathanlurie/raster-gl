
const Z_FOR_CENTRAL_MASS: Record<number, number> = {
  0.90: 1.644854,
  0.95: 1.959964,
  0.98: 2.326348,
  0.99: 2.575829,
  0.995: 2.807034,
  0.997: 3.0,      // common rule-of-thumb (≈ 99.73%)
  0.999: 3.290527
};

export function sigmaFromRadius(
  radius: number,
  centralMass: 0.90 | 0.95 | 0.98 | 0.99 | 0.995 | 0.997 | 0.999 = 0.99
): number {
  if (radius <= 0) return 1e-6;
  const z = Z_FOR_CENTRAL_MASS[centralMass];
  return radius / z;
}

export function buildGaussianKernelFromRadius(
  radius: number,
  centralMass: 0.90 | 0.95 | 0.98 | 0.99 | 0.995 | 0.997 | 0.999 = 0.999
): Float32Array {
  const sigma = sigmaFromRadius(radius, centralMass);
  return buildGaussianKernel(radius, sigma);
}


export function buildGaussianKernel(radius: number, sigma: number): Float32Array {
  const size = radius * 2 + 1;
  const kernel = new Float32Array(size);
  const sigma2 = sigma * sigma * 2;
  let sum = 0;

  for (let i = -radius; i <= radius; i++) {
    const value = Math.exp(-(i * i) / sigma2);
    kernel[i + radius] = value;
    sum += value;
  }

  // Normalize kernel
  for (let i = 0; i < size; i++) {
    kernel[i] /= sum;
  }

  return kernel;
}
