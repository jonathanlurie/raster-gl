import { resolve } from 'path';
import { defineConfig } from 'vite';
import dts from 'vite-plugin-dts';

export default defineConfig({
  mode: "production",
  build: {
    copyPublicDir: false,
    minify: true,
    sourcemap: true,
    outDir: "dist-lib",
    lib: {
      entry: resolve(__dirname, 'src/lib/index.ts'),
      name: 'raster-gl',
      fileName: (format, entryName) => "raster-gl.js",
      formats: ['es'],
    },
    rollupOptions: {
      external: [],
      output: {
        globals: {},
      },
    },
  },
  plugins:[
    dts({
      insertTypesEntry: true,
      entryRoot: "src/lib",
      include: "src/lib"
    }),
  ],
});