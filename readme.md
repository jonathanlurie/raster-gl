# Raster-gl
A 2D raster pipeline backed by WebGL2 and fragment shaders.

## Rendering and dimensions

`RasterContext` and `ProcessingNode` widths and heights are actual pixel counts.
A 512×512 node produces 512×512 pixels on all displays, including Retina displays
and OffscreenCanvas in workers. Texture nodes do not resize the shared canvas.
To display a larger backing image at a smaller CSS size, specify both explicitly:

```ts
const context = new RasterContext({ width: 1024, height: 1024 });
const canvas = context.getCanvas() as HTMLCanvasElement;
canvas.style.width = "512px";
canvas.style.height = "512px";
```

Each draw selects its framebuffer, viewport, program, vertex array, and input
textures. It disables dithering, blending, and other raster tests that could alter
the data. Call `render()` again after upstream texture contents change; assigning a
ProcessingNode as an input captures its current output texture, not a live graph
dependency. Shader changes invalidate cached uniforms and vertex attribute layouts.

`reuseOutputTexture: true` retains the same texture object across renders and
resizes. Resizing discards its contents and allocates storage at the new size.
With `reuseOutputTexture: false`, every explicit render creates a new output;
previous outputs remain usable until freed. `RasterContext.free()` releases all
registered textures and node resources.

## Numerical textures

Specify sampler precision as well as arithmetic precision in data-processing shaders:

```glsl
precision highp float;
precision highp sampler2D;
```

Set `{ bilinear: false }` once on `RasterContext` to default the whole pipeline to
nearest-neighbor sampling:

```ts
const context = new RasterContext({
  width: 512,
  height: 512,
  offscreen: true,
  bilinear: false,
});
const texture = await Texture.fromURL(context, tileUrl);
const node = new ProcessingNode(context, { renderToTexture: true });
```

All texture upload methods and node output textures inherit this setting, including
canvas outputs copied back to textures. An explicit `bilinear` option on an
individual texture or node overrides the context default. Existing code retains
bilinear sampling when the context option is omitted.

Framebuffers themselves have no sampling filter: their attached textures carry it.
Readback and PNG/ImageData/ImageBitmap exports copy pixels without resizing, so
they introduce no interpolation. For a canvas or exported image scaled with CSS,
set `element.style.imageRendering = "pixelated"` separately. This setting controls
texture lookups; shader operations such as the Gaussian blur still perform their
configured computation.

The cavity demo uses matching nearest sampling through
its elevation passes and exports at the source resolution. Integer output textures
always use nearest filtering and require `highp usampler2D` inputs and `uvec4`
fragment outputs. For integer nodes, `clearColor` contains integer channel values.

Input textures are assigned units per draw, using the context's hardware limit.
Stored textures do not permanently consume those units. The legacy `textureUnit`
and `rest()` APIs remain available, but their reserved units do not describe the
bindings used by ProcessingNode.

`Texture.fromURL()` disables decode-time color conversion and premultiplication,
applies `verticalFlip` during ImageBitmap creation, and closes the temporary bitmap.
For `fromImageSource()` with your own ImageBitmap, create it with
`{ colorSpaceConversion: "none", premultiplyAlpha: "none" }` when its channels hold
data. Existing decode-time conversions cannot be undone. `verticalFlip` defaults to
true for all input methods and flips the supplied image's current row order.

## Reading and exporting

`getPixelData()` selects the node's framebuffer and uses the output dimensions.
Raw rows run bottom-to-top, with crop coordinates measured from the bottom-left.
ImageData, ImageBitmap, and PNG exports reorder those rows top-to-bottom.
Dirty texture nodes render before readback. Canvas nodes redraw before readback
because another node or browser compositing may have overwritten their shared buffer.

## Validation

Run `npm run build`, `npm run build:lib`, and `npm run biome` for compilation and
formatting checks. `npm test` runs real WebGL2 regression tests in headless Chrome
at device pixel ratios 1 and 2, including a CPU reference for elevation convolution.
It requires Node 22 or newer and an installed Chrome/Chromium browser. On macOS it
uses `/Applications/Google Chrome.app`; elsewhere it uses `google-chrome` on PATH.
Set `CHROME_PATH` to choose another Chromium executable. No remote data is required.
