import { ProcessingNode, RasterContext, Texture, UNIFORM_TYPE } from "../src/lib";
import { fragmentShaderBlurPass, fragmentShaderCombine } from "../src/demos/cavity-shading";
import { buildGaussianKernelFromRadius } from "../src/demos/common";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function equal(actual: ArrayLike<number>, expected: ArrayLike<number>, tolerance = 0) {
  assert(actual.length === expected.length, `Length ${actual.length}, expected ${expected.length}`);
  for (let i = 0; i < actual.length; i++) {
    assert(Math.abs(actual[i] - expected[i]) <= tolerance, `At ${i}: ${actual[i]}, expected ${expected[i]}`);
  }
}

function shader(body: string, declarations = "") {
  return `#version 300 es
precision highp float;
precision highp sampler2D;
in vec2 uv;
out vec4 fragColor;
${declarations}
void main() { ${body} }`;
}

function solid(ctx: RasterContext, color: number[], options: ConstructorParameters<typeof ProcessingNode>[1] = {}) {
  const node = new ProcessingNode(ctx, { renderToTexture: true, ...options });
  node.setShaderSource({ fragmentShaderSource: shader("fragColor = u_color;", "uniform vec4 u_color;") });
  node.setUniformVector4("u_color", color as [number, number, number, number]);
  return node;
}

function copy(ctx: RasterContext, texture: Texture | ProcessingNode, options: ConstructorParameters<typeof ProcessingNode>[1] = {}) {
  const node = new ProcessingNode(ctx, { renderToTexture: true, ...options });
  node.setShaderSource({ fragmentShaderSource: shader("fragColor = texture(u_image, uv);", "uniform sampler2D u_image;") });
  node.setUniformTexture2D("u_image", texture);
  return node;
}

export async function run() {
  const passed: string[] = [];
  const failed: string[] = [];
  const ctx = new RasterContext({ width: 8, height: 4, offscreen: true });
  const gl = ctx.getGlContext();
  const debug = gl.getExtension("WEBGL_debug_renderer_info");
  const renderer = debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
  async function test(name: string, action: () => void | Promise<void>) {
    try {
      await action();
      const error = gl.getError();
      assert(error === gl.NO_ERROR, `WebGL error after test: 0x${error.toString(16)}`);
      passed.push(name);
    } catch (error) {
      failed.push(`${name}: ${error instanceof Error ? error.stack : error}`);
      while (gl.getError() !== gl.NO_ERROR) { /* Drain errors to isolate subsequent cases. */ }
    }
  }

  await test("non-square HTML canvas dimensions", () => {
    const html = new RasterContext({ width: 7, height: 3 });
    assert(html.getCanvas().width === 7 && html.getCanvas().height === 3, "Incorrect canvas dimensions");
    html.free();
  });

  await test("later scalar uniform updates after unchanged uniform", () => {
    const node = new ProcessingNode(ctx, { renderToTexture: true, width: 1, height: 1 });
    node.setShaderSource({ fragmentShaderSource: shader("fragColor = vec4(u_red, 0, u_blue, 1);", "uniform float u_red; uniform float u_blue;") });
    node.setUniformNumber("u_red", 1);
    node.setUniformNumber("u_blue", 0);
    node.render();
    node.setUniformNumber("u_blue", 1);
    equal(node.getPixelData().data, [255, 0, 255, 255]);
  });

  await test("A/B/A restores framebuffer, viewport, program and texture", () => {
    const a = solid(ctx, [1, 0, 0, 1], { width: 3, height: 2 });
    const b = solid(ctx, [0, 1, 0, 1], { width: 7, height: 4 });
    const consumer = copy(ctx, a, { width: 3, height: 2 });
    consumer.render();
    b.render();
    consumer.render();
    equal(consumer.getPixelData().data, new Uint8Array(6 * 4).map((_, i) => i % 4 === 0 || i % 4 === 3 ? 255 : 0));
    equal(b.getPixelData({ w: 1, h: 1 }).data, [0, 255, 0, 255]);
    equal(gl.getParameter(gl.VIEWPORT), [0, 0, 3, 2]);
  });

  await test("texture bindings recover after another node and image upload", () => {
    const red = solid(ctx, [1, 0, 0, 1], { width: 1, height: 1 });
    const green = solid(ctx, [0, 1, 0, 1], { width: 1, height: 1 });
    const a = copy(ctx, red, { width: 1, height: 1 });
    const b = copy(ctx, green, { width: 1, height: 1 });
    a.render(); b.render();
    Texture.fromData(ctx, new Uint8Array([0, 0, 255, 255]), 1, 1);
    a.render();
    equal(a.getPixelData().data, [255, 0, 0, 255]);
    a.setUniformTexture2D("u_image", green);
    equal(a.getPixelData().data, [0, 255, 0, 255]);
  });

  await test("resizing output preserves texture identity and reallocates storage", () => {
    const a = solid(ctx, [0, 0, 1, 1], { width: 2, height: 2 });
    const texture = a.getOutputTexture();
    const consumer = copy(ctx, texture, { width: 5, height: 3 });
    a.setOutputSize(5, 3);
    a.render();
    assert(a.getOutputTexture() === texture && texture.width === 5 && texture.height === 3, "Texture identity or size lost");
    consumer.render();
    equal(consumer.getPixelData({ x: 4, y: 2, w: 1, h: 1 }).data, [0, 0, 255, 255]);
  });

  await test("non-reused outputs retain earlier snapshots", () => {
    const producer = solid(ctx, [1, 0, 0, 1], { reuseOutputTexture: false, width: 1, height: 1 });
    const first = producer.getOutputTexture();
    producer.setUniformVector4("u_color", [0, 1, 0, 1]);
    const second = producer.getOutputTexture();
    assert(first !== second, "Output was reused");
    equal(copy(ctx, first, { width: 1, height: 1 }).getPixelData().data, [255, 0, 0, 255]);
    equal(copy(ctx, second, { width: 1, height: 1 }).getPixelData().data, [0, 255, 0, 255]);
    producer.render();
    assert(producer.getOutputTexture() !== second, "Clean explicit render reused a snapshot");
  });

  await test("workers render without a devicePixelRatio global", async () => {
    const source = `import { RasterContext, ProcessingNode } from ${JSON.stringify(new URL("/src/lib/index.ts", location.href).href)};
      const context = new RasterContext({ width: 3, height: 2, offscreen: true });
      const node = new ProcessingNode(context);
      node.setShaderSource();
      const { width, height, data } = node.getPixelData();
      postMessage({ width, height, size: data.length, error: context.getGlContext().getError() });
      context.free();`;
    const url = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
    const worker = new Worker(url, { type: "module" });
    try {
      const result = await new Promise<{ width: number; height: number; size: number; error: number }>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("Worker timed out")), 10000);
        worker.onmessage = (event) => { clearTimeout(timeout); resolve(event.data); };
        worker.onerror = (event) => { clearTimeout(timeout); reject(new Error(event.message)); };
      });
      assert(result.width === 3 && result.height === 2 && result.size === 24 && result.error === 0, "Worker output is invalid");
    } finally { worker.terminate(); URL.revokeObjectURL(url); }
  });

  await test("readback selects the node framebuffer and dimensions", () => {
    const a = solid(ctx, [1, 0, 0, 1], { width: 3, height: 2 });
    const b = solid(ctx, [0, 1, 0, 1], { width: 6, height: 4 });
    a.render(); b.render();
    const previous = gl.getParameter(gl.READ_FRAMEBUFFER_BINDING);
    const data = a.getPixelData();
    assert(data.width === 3 && data.height === 2, "Wrong readback dimensions");
    equal(data.data.slice(0, 4), [255, 0, 0, 255]);
    assert(gl.getParameter(gl.READ_FRAMEBUFFER_BINDING) === previous, "Read binding was not restored");
  });

  await test("canvas renders and exports exact pixels at any DPR", async () => {
    const canvas = solid(ctx, [1, 0, 1, 1], { renderToTexture: false, width: 5, height: 3 });
    const intermediate = solid(ctx, [0, 1, 0, 1], { width: 2, height: 2 });
    canvas.render();
    intermediate.render();
    const pixels = canvas.getPixelData();
    assert(pixels.width === 5 && pixels.height === 3, "DPR affected dimensions");
    equal(pixels.data.slice(0, 4), [255, 0, 255, 255]);
    const bitmap = await createImageBitmap((await canvas.getPNGImageBlob())!);
    assert(bitmap.width === 5 && bitmap.height === 3, "Wrong PNG dimensions");
    bitmap.close();
    canvas.setRenderToTexture(true);
    const oldTexture = canvas.getOutputTexture();
    canvas.setRenderToTexture(false);
    const newTexture = canvas.getOutputTexture();
    assert(newTexture !== oldTexture, "Canvas mode returned stale texture output");
  });

  await test("program replacement refreshes uniform locations and attribute layout", () => {
    const node = solid(ctx, [1, 0, 0, 1], { width: 1, height: 1 });
    node.render();
    const vertexShaderSource = `#version 300 es
layout(location = 3) in vec2 a_position;
out vec2 uv;
void main() { uv = a_position * .5 + .5; gl_Position = vec4(a_position, 0, 1); }`;
    node.setShaderSource({ vertexShaderSource, fragmentShaderSource: shader("fragColor = vec4(u_color.b, u_color.r, u_color.g, u_color.a);", "uniform vec4 u_color;") });
    equal(node.getPixelData().data, [0, 255, 0, 255]);
    solid(ctx, [0, 0, 1, 1]).render();
    node.render();
    equal(node.getPixelData().data, [0, 255, 0, 255]);
  });

  await test("location zero reuses vertex buffer", () => {
    const original = gl.createBuffer;
    let created = 0;
    gl.createBuffer = function () { created++; return original.call(this); };
    try {
      const node = solid(ctx, [1, 1, 1, 1]);
      node.render(); node.render(); node.render();
      assert(created === 1, `Allocated ${created} buffers`);
    } finally { gl.createBuffer = original; }
  });

  await test("raster state and dithering cannot corrupt a later data pass", () => {
    const node = solid(ctx, [1, 0, 0, 1], { width: 2, height: 2 });
    node.render();
    gl.enable(gl.DITHER); gl.enable(gl.BLEND); gl.blendFunc(gl.ZERO, gl.ZERO);
    gl.enable(gl.SCISSOR_TEST); gl.scissor(0, 0, 0, 0);
    gl.enable(gl.RASTERIZER_DISCARD); gl.colorMask(false, false, false, false);
    node.render();
    assert(!gl.isEnabled(gl.DITHER), "Dithering remains enabled");
    equal(node.getPixelData({ w: 1, h: 1 }).data, [255, 0, 0, 255]);
  });

  await test("integer render targets can be sampled and cleared", () => {
    const integer = new ProcessingNode(ctx, { renderToTexture: true, uint32: true, width: 1, height: 1, clearColor: [9, 8, 7, 6] });
    integer.setShaderSource({ fragmentShaderSource: "#version 300 es\nprecision highp float;\nlayout(location=0) out highp uvec4 fragColor;\nuniform bool u_discard;\nvoid main() { if (u_discard) discard; fragColor = uvec4(1); }" });
    integer.setUniformBoolean("u_discard", true);
    equal(integer.getPixelData().data, [9, 8, 7, 6]);
    assert(gl.getError() === gl.NO_ERROR, "Integer clear/draw/read generated error");
    integer.setShaderSource({ fragmentShaderSource: "#version 300 es\nprecision highp float;\nlayout(location=0) out highp uvec4 fragColor;\nvoid main() { fragColor = uvec4(255, 128, 64, 255); }" });
    const sampler = new ProcessingNode(ctx, { renderToTexture: true, width: 1, height: 1 });
    sampler.setShaderSource({ fragmentShaderSource: shader("fragColor = vec4(texture(u_integer, uv)) / 255.;", "uniform highp usampler2D u_integer;") });
    sampler.setUniformTexture2D("u_integer", integer);
    equal(sampler.getPixelData().data, [255, 128, 64, 255]);
    let threw = false;
    try { integer.setRenderToTexture(false); } catch { threw = true; }
    assert(threw, "Integer canvas output was accepted");
  });

  const rows = new Uint8Array([255, 0, 0, 255, 0, 0, 255, 255]);
  await test("data texture flips are explicit, independent of previous uploads", () => {
    const flipped = Texture.fromData(ctx, rows, 1, 2, { verticalFlip: true, bilinear: false });
    const unflipped = Texture.fromData(ctx, rows, 1, 2, { verticalFlip: false, bilinear: false });
    equal(copy(ctx, flipped, { width: 1, height: 2 }).getPixelData().data, [0, 0, 255, 255, 255, 0, 0, 255]);
    equal(copy(ctx, unflipped, { width: 1, height: 2 }).getPixelData().data, rows);
    equal(rows, [255, 0, 0, 255, 0, 0, 255, 255]);
  });

  await test("ImageBitmap direct and URL uploads agree with ImageData orientation", async () => {
    const data = new ImageData(new Uint8ClampedArray(rows), 1, 2);
    const bitmap = await createImageBitmap(data, { premultiplyAlpha: "none", colorSpaceConversion: "none" });
    const canvas = new OffscreenCanvas(1, 2);
    canvas.getContext("2d")!.putImageData(data, 0, 0);
    const url = URL.createObjectURL(await canvas.convertToBlob());
    try {
      for (const verticalFlip of [true, false]) {
        const reference = copy(ctx, Texture.fromImageSource(ctx, data, { verticalFlip, bilinear: false }), { width: 1, height: 2 }).getPixelData().data;
        const direct = Texture.fromImageSource(ctx, bitmap, { verticalFlip, bilinear: false });
        const fromURL = await Texture.fromURL(ctx, url, { verticalFlip, bilinear: false });
        equal(copy(ctx, direct, { width: 1, height: 2 }).getPixelData().data, reference);
        equal(copy(ctx, fromURL, { width: 1, height: 2 }).getPixelData().data, reference);
      }
    } finally { bitmap.close(); URL.revokeObjectURL(url); }
  });

  await test("ImageData and PNG export use top-to-bottom rows", async () => {
    const input = Texture.fromData(ctx, rows, 1, 2, { bilinear: false });
    const node = copy(ctx, input, { width: 1, height: 2 });
    equal(node.getImageData().data, rows);
    const bitmap = await createImageBitmap((await node.getPNGImageBlob())!);
    const canvas = new OffscreenCanvas(1, 2);
    const context = canvas.getContext("2d")!;
    context.drawImage(bitmap, 0, 0);
    equal(context.getImageData(0, 0, 1, 2).data, rows);
    bitmap.close();
  });

  await test("upload and readback isolate pixel-store and buffer state", () => {
    gl.pixelStorei(gl.UNPACK_ROW_LENGTH, 12);
    gl.pixelStorei(gl.UNPACK_SKIP_ROWS, 2);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    const texture = Texture.fromData(ctx, rows, 1, 2, { verticalFlip: false, bilinear: false });
    assert(gl.getParameter(gl.UNPACK_ROW_LENGTH) === 12, "Upload state not restored");
    gl.pixelStorei(gl.UNPACK_ROW_LENGTH, 0); gl.pixelStorei(gl.UNPACK_SKIP_ROWS, 0);
    const node = copy(ctx, texture, { width: 1, height: 2 });
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, buffer);
    gl.bufferData(gl.PIXEL_PACK_BUFFER, 1024, gl.STATIC_READ);
    gl.pixelStorei(gl.PACK_ROW_LENGTH, 8); gl.pixelStorei(gl.PACK_SKIP_ROWS, 2);
    equal(node.getPixelData().data, rows);
    assert(gl.getParameter(gl.PIXEL_PACK_BUFFER_BINDING) === buffer, "Pack buffer not restored");
    assert(gl.getParameter(gl.PACK_ROW_LENGTH) === 8, "Pack state not restored");
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null); gl.deleteBuffer(buffer);
    gl.pixelStorei(gl.PACK_ROW_LENGTH, 0); gl.pixelStorei(gl.PACK_SKIP_ROWS, 0);
  });

  await test("more than sixteen stored textures do not exhaust per-draw slots", () => {
    const nodes = Array.from({ length: 24 }, (_, i) => copy(ctx, Texture.fromData(ctx, new Uint8Array([i, 0, 0, 255]), 1, 1), { width: 1, height: 1 }));
    nodes.forEach((node, i) => equal(node.getPixelData().data, [i, 0, 0, 255]));
  });

  await test("feedback is rejected before drawing", () => {
    const node = copy(ctx, Texture.fromData(ctx, rows, 1, 2));
    const texture = node.getOutputTexture();
    node.setUniformTexture2D("u_image", texture);
    let threw = false;
    try { node.render(); } catch { threw = true; }
    assert(threw, "Feedback loop was accepted");
  });

  await test("cavity blur matches CPU convolution across Terrarium byte boundaries", () => {
    const width = 16, height = 8, radius = 3;
    const elevations = Array.from({ length: width * height }, (_, i) => 250 + (i % width) * 2.5 + Math.floor(i / width) * .25);
    const bytes = new Uint8Array(width * height * 4);
    elevations.forEach((value, i) => {
      const e = Math.round((value + 32768) * 256);
      bytes.set([e >> 16, (e >> 8) & 255, e & 255, 255], i * 4);
    });
    const input = Texture.fromData(ctx, bytes, width, height, { verticalFlip: false, bilinear: false });
    const kernel = Array.from(buildGaussianKernelFromRadius(radius));
    function blur(texture: Texture | ProcessingNode, horizontal: boolean) {
      const node = new ProcessingNode(ctx, { renderToTexture: true, width, height, bilinear: false });
      node.setShaderSource({ fragmentShaderSource: fragmentShaderBlurPass });
      node.setUniformNumber("u_kernel", kernel);
      node.setUniformNumber("u_kernelSize", kernel.length, UNIFORM_TYPE.INT);
      node.setUniformBoolean("u_isHorizontalPass", horizontal);
      node.setUniformTexture2D("u_tile", texture);
      return node;
    }
    const output = blur(blur(input, true), false).getPixelData().data;
    const cpuPass = (values: number[], horizontal: boolean) => values.map((_, index) => {
      const x = index % width, y = Math.floor(index / width);
      return kernel.reduce((sum, weight, i) => {
        const sx = Math.max(0, Math.min(width - 1, x + (horizontal ? i - radius : 0)));
        const sy = Math.max(0, Math.min(height - 1, y + (horizontal ? 0 : i - radius)));
        return sum + weight * values[sy * width + sx];
      }, 0);
    });
    const expected = cpuPass(cpuPass(elevations, true), false);
    const actual = expected.map((_, i) => output[i * 4] * 256 + output[i * 4 + 1] + output[i * 4 + 2] / 256 - 32768);
    equal(actual, expected, .03);
  });

  await test("flat terrain has no spurious cavity shading", () => {
    const flat = Texture.fromData(ctx, new Uint8Array([129, 1, 32, 255]), 1, 1, { bilinear: false });
    const node = new ProcessingNode(ctx, { renderToTexture: true, width: 4, height: 4 });
    node.setShaderSource({ fragmentShaderSource: fragmentShaderCombine });
    node.setUniformRGB("u_tint", [0, 0, 100]);
    node.setUniformTexture2D("u_tile", flat);
    for (const radius of [3, 7, 15, 30, 60]) {
      node.setUniformTexture2D(`u_tileLowPass_${radius}`, flat);
      node.setUniformNumber(`u_weightLowPass_${radius}`, 3);
    }
    const result = node.getPixelData().data;
    for (let i = 3; i < result.length; i += 4) assert(result[i] === 0, `Nonzero cavity alpha: ${result[i]}`);
  });

  await test("context nearest default covers uploads, multiple passes, canvas copies and exports", async () => {
    const nearest = new RasterContext({ width: 2, height: 1, offscreen: true, bilinear: false });
    const nearestGl = nearest.getGlContext();
    const bytes = new Uint8Array([255, 0, 0, 255, 0, 0, 255, 255]);
    const imageData = new ImageData(new Uint8ClampedArray(bytes), 2, 1);
    const canvas = new OffscreenCanvas(2, 1);
    canvas.getContext("2d")!.putImageData(imageData, 0, 0);
    const url = URL.createObjectURL(await canvas.convertToBlob());
    const bitmap = await createImageBitmap(imageData);
    function filter(texture: Texture, expected: number = nearestGl.NEAREST) {
      nearestGl.bindTexture(nearestGl.TEXTURE_2D, texture.texture);
      assert(nearestGl.getTexParameter(nearestGl.TEXTURE_2D, nearestGl.TEXTURE_MIN_FILTER) === expected, "Wrong minification filter");
      assert(nearestGl.getTexParameter(nearestGl.TEXTURE_2D, nearestGl.TEXTURE_MAG_FILTER) === expected, "Wrong magnification filter");
    }
    try {
      assert(ctx.getDefaultBilinear(), "Default context no longer uses bilinear sampling");
      const inputs = [
        Texture.fromData(nearest, bytes, 2, 1),
        Texture.fromImageSource(nearest, imageData),
        Texture.fromImageSource(nearest, bitmap),
        await Texture.fromURL(nearest, url),
      ];
      for (const input of inputs) filter(input);
      const first = copy(nearest, inputs[0], { width: 4, height: 1 });
      filter(first.getOutputTexture());
      const second = copy(nearest, first, { width: 8, height: 1 });
      filter(second.getOutputTexture());
      const expected = new Uint8Array(32);
      for (let x = 0; x < 8; x++) expected.set(x < 4 ? [255, 0, 0, 255] : [0, 0, 255, 255], x * 4);
      equal(second.getPixelData().data, expected);
      const display = copy(nearest, second, { renderToTexture: false, width: 8, height: 1 });
      filter(display.getOutputTexture());
      const exported = await createImageBitmap((await display.getPNGImageBlob())!);
      try {
        const result = new OffscreenCanvas(8, 1).getContext("2d")!;
        result.drawImage(exported, 0, 0);
        equal(result.getImageData(0, 0, 8, 1).data, expected);
      } finally { exported.close(); }
      const override = Texture.fromData(nearest, bytes, 2, 1, { bilinear: true });
      filter(override, nearestGl.LINEAR);
      filter(copy(nearest, override, { bilinear: true }).getOutputTexture(), nearestGl.LINEAR);
      assert(nearestGl.getError() === nearestGl.NO_ERROR, "WebGL error in nearest pipeline");
    } finally {
      bitmap.close();
      URL.revokeObjectURL(url);
      nearest.free();
    }
  });

  await test("context cleanup deletes registered node resources", () => {
    const other = new RasterContext({ width: 2, height: 2, offscreen: true });
    const otherGl = other.getGlContext();
    solid(other, [1, 1, 1, 1]).render();
    const program = otherGl.getParameter(otherGl.CURRENT_PROGRAM);
    const vao = otherGl.getParameter(otherGl.VERTEX_ARRAY_BINDING);
    other.free(); other.free();
    otherGl.useProgram(null);
    assert(!otherGl.isProgram(program) && !otherGl.isVertexArray(vao), "Resources survived free()");
  });
  ctx.free();
  return { renderer, dpr: devicePixelRatio, passed, failed };
}
