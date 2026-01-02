const DEFAULT_WIDTH = 512, DEFAULT_HEIGHT = 512;
var currentTextureUnit = 0, textureUnitSlots = Array(16).fill(!1);
function getUnusedTextureUnit() {
	for (let e = 0; e < textureUnitSlots.length; e += 1) if (!textureUnitSlots[e]) return textureUnitSlots[e] = !0, e;
	throw Error("All the texture units are already allocated.");
}
function freeTextureUnit(e) {
	textureUnitSlots[e] = !1;
}
function getCurrentTextureUnit() {
	return currentTextureUnit;
}
function incrementCurrentTextureUnit() {
	currentTextureUnit++;
}
function getShaderCompileError(e, b, x) {
	let S = e.createShader(e.VERTEX_SHADER);
	e.shaderSource(S, b), e.compileShader(S);
	let C = e.getShaderInfoLog(S), w = e.createShader(e.FRAGMENT_SHADER);
	return e.shaderSource(w, x), e.compileShader(w), {
		vertexShaderMessages: C,
		fragmentShaderMessages: e.getShaderInfoLog(w)
	};
}
function createProgram(e, b, x) {
	let S = e.createProgram();
	if (e.attachShader(S, b), e.attachShader(S, x), e.linkProgram(S), !e.getProgramParameter(S, e.LINK_STATUS)) {
		let b = e.getProgramInfoLog(S);
		return e.deleteProgram(S), {
			program: null,
			error: b
		};
	}
	return {
		program: S,
		error: null
	};
}
function compileShader(e, b, x) {
	let S = e.createShader(b);
	if (e.shaderSource(S, x), e.compileShader(S), !e.getShaderParameter(S, e.COMPILE_STATUS)) {
		let b = e.getShaderInfoLog(S);
		return e.deleteShader(S), {
			shader: null,
			error: b
		};
	}
	return {
		shader: S,
		error: null
	};
}
function prepareGlContext(e) {
	let b = e.canvasElemId ? document.getElementById(e.canvasElemId) : document.createElement("canvas");
	b.width = e.width, b.height = e.height;
	let x = b.getContext("webgl2");
	if (!x) throw Error("WebGL2 not supported in this browser.");
	return x;
}
var defaultOptionValues = {
	verticalFlip: !0,
	bilinear: !0
};
async function fetchAsImageBitmap(e, b) {
	let x = await fetch(e, { signal: b });
	if (!x.ok) throw Error(`Fetch failed: ${x.status}`);
	let S = await x.blob();
	return await createImageBitmap(S);
}
var Texture = class e {
	width;
	height;
	bitDepth;
	_textureUnit = null;
	_texture = null;
	usageRecords = [];
	rasterContext;
	static fromImageSource(b, x, S = {}) {
		let C = b.getGlContext(), w = {
			...defaultOptionValues,
			...S
		}, T = w.bilinear ? C.LINEAR : C.NEAREST, E = C.createTexture();
		if (w.verticalFlip && C.pixelStorei(C.UNPACK_FLIP_Y_WEBGL, !0), C.bindTexture(C.TEXTURE_2D, E), C.pixelStorei(C.UNPACK_ALIGNMENT, 4), C.texImage2D(C.TEXTURE_2D, 0, C.RGBA, C.RGBA, C.UNSIGNED_BYTE, x), C.texParameteri(C.TEXTURE_2D, C.TEXTURE_WRAP_S, C.CLAMP_TO_EDGE), C.texParameteri(C.TEXTURE_2D, C.TEXTURE_WRAP_T, C.CLAMP_TO_EDGE), C.texParameteri(C.TEXTURE_2D, C.TEXTURE_MIN_FILTER, T), C.texParameteri(C.TEXTURE_2D, C.TEXTURE_MAG_FILTER, T), C.bindTexture(C.TEXTURE_2D, null), !E) throw Error("Could not load image");
		let D = 0, O = 0;
		if (x instanceof VideoFrame ? (D = x.codedWidth, O = x.codedHeight) : (D = x.width, O = x.height), D === 0 || O === 0) throw Error(`Image dimensions are invalid (${D}, ${O})`);
		return new e(b, E, D, O, 8);
	}
	static async fromURL(b, x, S = {}) {
		let C = await fetch(x);
		if (!C.ok) throw Error(`Fetch failed: ${C.status}`);
		let w = await C.blob(), T = await createImageBitmap(w);
		return e.fromImageSource(b, T, S);
	}
	static fromData(b, x, S, C, w = {}) {
		let T = b.getGlContext(), E = T.createTexture(), D = {
			...defaultOptionValues,
			...w
		}, O = D.bilinear ? T.LINEAR : T.NEAREST;
		if (!E) throw Error("The texture could not be initialized");
		D.verticalFlip && T.pixelStorei(T.UNPACK_FLIP_Y_WEBGL, !0), T.bindTexture(T.TEXTURE_2D, E);
		let k = x.length / (S * C);
		if (k === 3) T.pixelStorei(T.UNPACK_ALIGNMENT, 1), T.texImage2D(T.TEXTURE_2D, 0, T.RGB, S, C, 0, T.RGB, T.UNSIGNED_BYTE, x);
		else if (k === 4) T.pixelStorei(T.UNPACK_ALIGNMENT, 4), T.texImage2D(T.TEXTURE_2D, 0, T.RGBA, S, C, 0, T.RGBA, T.UNSIGNED_BYTE, x);
		else throw Error("Invalid number of elements per pixel. The data texture must contain 1, 3 or 4 elements per pixel.");
		return T.texParameteri(T.TEXTURE_2D, T.TEXTURE_WRAP_S, T.CLAMP_TO_EDGE), T.texParameteri(T.TEXTURE_2D, T.TEXTURE_WRAP_T, T.CLAMP_TO_EDGE), T.texParameteri(T.TEXTURE_2D, T.TEXTURE_MIN_FILTER, O), T.texParameteri(T.TEXTURE_2D, T.TEXTURE_MAG_FILTER, O), T.bindTexture(T.TEXTURE_2D, null), new e(b, E, S, C, x.BYTES_PER_ELEMENT * 8);
	}
	constructor(e, b, x, S, C) {
		this._texture = b, this.width = x, this.height = S, this.bitDepth = C, this.rasterContext = e, this.rasterContext.registerTexture(this);
	}
	get textureUnit() {
		return this._textureUnit ??= getUnusedTextureUnit(), this._textureUnit;
	}
	get texture() {
		if (!this._texture) throw Error("This texture is not complete or has been disposed.");
		return this._texture;
	}
	rest() {
		this._textureUnit !== null && (freeTextureUnit(this._textureUnit), this._textureUnit = null);
	}
	free() {
		if (!this._texture) return;
		let e = this.rasterContext.getGlContext();
		e.getParameter(e.TEXTURE_BINDING_2D) === this._texture && e.bindTexture(e.TEXTURE_2D, null), e.deleteTexture(this._texture), this._texture = null, this.rest();
	}
	getIndexUsageRecord(e, b) {
		for (let x = 0; x < this.usageRecords.length; x += 1) if (this.usageRecords[x].node === e && this.usageRecords[x].uniformName === b) return x;
		return -1;
	}
	addUsageRecord(e, b) {
		this.getIndexUsageRecord(e, b) >= 0 || this.usageRecords.push({
			node: e,
			uniformName: b
		});
	}
	removeUsageRecord(e, b) {
		let x = this.getIndexUsageRecord(e, b);
		x !== -1 && (this.usageRecords.splice(x, 1), this.usageRecords.length === 0 && this.rest());
	}
};
let UNIFORM_TYPE = /* @__PURE__ */ function(e) {
	return e[e.BOOL = 1] = "BOOL", e[e.INT = 3] = "INT", e[e.FLOAT = 4] = "FLOAT", e;
}({});
function isObject(e) {
	return typeof e == "object" && !Array.isArray(e) && e !== null;
}
function isBoolean(e) {
	return typeof e == "boolean";
}
function isNumber(e) {
	return typeof e == "number";
}
function isArrayOfNumber(e) {
	return Array.isArray(e) ? e.every((e) => isNumber(e)) : !1;
}
function isTexture(e) {
	return e instanceof Texture;
}
function isArrayOfTexture(e) {
	return Array.isArray(e) ? e.every((e) => isTexture(e)) : !1;
}
function isVector2(e) {
	return Array.isArray(e) && isArrayOfNumber(e) && e.length === 2;
}
function isVector3(e) {
	return Array.isArray(e) && isArrayOfNumber(e) && e.length === 3;
}
function isVector4(e) {
	return Array.isArray(e) && isArrayOfNumber(e) && e.length === 5;
}
function isMatrix2(e) {
	return Array.isArray(e) && isArrayOfNumber(e) && e.length === 4;
}
function isMatrix3(e) {
	return Array.isArray(e) && isArrayOfNumber(e) && e.length === 9;
}
function isMatrix4(e) {
	return Array.isArray(e) && isArrayOfNumber(e) && e.length === 16;
}
var ProcessingNode = class e {
	rasterContext;
	renderToTexture;
	reuseOutputTexture;
	outputWidth;
	outputHeight;
	outputNeedUpdate = !0;
	positionAttributeLocation = null;
	compiledVertexShader = null;
	compiledFragmentShader = null;
	vertexShaderError = null;
	fragmentShaderError = null;
	shaderProgram = null;
	shaderProgramError = null;
	uniforms = {};
	clearColor = [
		0,
		0,
		0,
		1
	];
	outputTexture = null;
	framebuffer = null;
	positionBuffer = null;
	uint32 = !1;
	constructor(e, b = {}) {
		this.rasterContext = e;
		let x = this.rasterContext.getSize();
		this.renderToTexture = b.renderToTexture ?? !1, this.reuseOutputTexture = b.reuseOutputTexture ?? !0, this.outputWidth = b.width ?? x.width, this.outputHeight = b.height ?? x.height, this.uint32 = b.uint32 ?? !1;
		let S = this.rasterContext.getGlContext();
		if (this.renderToTexture) S.canvas.width = this.outputWidth, S.canvas.height = this.outputHeight;
		else {
			if (this.uint32) throw Error("A Node can only output uint32 when rendering to texture.");
			S.canvas.width = this.outputWidth * devicePixelRatio, S.canvas.height = this.outputHeight * devicePixelRatio, S.canvas instanceof OffscreenCanvas || (S.canvas.style.width = `${this.outputWidth}px`, S.canvas.style.height = `${this.outputHeight}px`);
		}
	}
	setClearColor(e) {
		this.clearColor[0] = e[0], this.clearColor[1] = e[1], this.clearColor[2] = e[2], this.clearColor[3] = e[3];
	}
	setOutputSize(e, b) {
		this.outputWidth = e, this.outputHeight = b, this.outputNeedUpdate = !0;
	}
	setRenderToTexture(e) {
		this.renderToTexture = e, this.outputNeedUpdate = !0;
	}
	getVertexShaderError() {
		return this.vertexShaderError;
	}
	getFragmentShaderError() {
		return this.fragmentShaderError;
	}
	getProgramError() {
		return this.shaderProgramError;
	}
	resetProgram() {
		let e = this.rasterContext.getGlContext();
		e.deleteProgram(this.shaderProgram), this.shaderProgram = null, this.shaderProgramError = null, e.deleteShader(this.compiledVertexShader), this.compiledVertexShader = null, this.vertexShaderError = null, e.deleteShader(this.compiledFragmentShader), this.compiledFragmentShader = null, this.fragmentShaderError = null;
	}
	setShaderSource(e = {}) {
		this.resetProgram();
		let b = e.throw ?? !0, x = e.vertexShaderSource ?? "#version 300 es\nprecision highp float;\n\nin vec2 a_position;\nout vec4 position;\nout vec2 uv;\n\nvoid main() {\n  position = vec4(a_position, 0.0, 1.0);\n  gl_Position = position;\n  uv = position.xy / 2. + 0.5;\n}", S = e.fragmentShaderSource ?? "#version 300 es\nprecision highp float;\n\nin vec2 uv;\nout vec4 fragColor;\n\nvoid main() {\n  fragColor = vec4(uv.x, uv.y, 1. - uv.x * uv.y, 1.);\n}", C = this.rasterContext.getGlContext(), w = compileShader(C, C.VERTEX_SHADER, x), T = compileShader(C, C.FRAGMENT_SHADER, S);
		if (this.compiledVertexShader = w.shader, this.compiledFragmentShader = T.shader, this.vertexShaderError = w.error, this.fragmentShaderError = T.error, b && (w.error || T.error)) {
			if (w.error) throw Error(w.error);
			if (T.error) throw Error(T.error);
		}
		if (w.shader === null || T.shader === null) return;
		let E = createProgram(C, w.shader, T.shader);
		if (this.shaderProgram = E.program, this.shaderProgramError = E.error, b && E.error) throw Error(E.error);
		C.useProgram(this.shaderProgram);
	}
	isProgramValid() {
		return !!this.shaderProgram;
	}
	setUniformBoolean(e, b) {
		this.outputNeedUpdate = !0;
		let x = this.rasterContext.getGlContext(), S;
		e in this.uniforms ? (S = this.uniforms[e], S.needsUpdate = !0) : S = {
			name: e,
			needsUpdate: !0,
			location: null,
			forcedType: UNIFORM_TYPE.BOOL,
			uniformFunction: null,
			uniformFunctionArguments: null
		}, typeof b == "boolean" ? (S.uniformFunction = x.uniform1i, S.uniformFunctionArguments = [+b], this.uniforms[e] = S) : Array.isArray(b) && b.length > 0 && typeof b[0] == "boolean" ? (S.uniformFunction = x.uniform1iv, S.uniformFunctionArguments = [b.map((e) => +e)], this.uniforms[e] = S) : console.warn(`Uniform ${e} type mismatch`);
	}
	setUniformNumber(e, b, x = UNIFORM_TYPE.FLOAT) {
		this.outputNeedUpdate = !0;
		let S = this.rasterContext.getGlContext(), C;
		e in this.uniforms ? (C = this.uniforms[e], C.needsUpdate = !0) : C = {
			name: e,
			needsUpdate: !0,
			location: null,
			forcedType: x,
			uniformFunction: null,
			uniformFunctionArguments: null
		}, typeof b == "number" && x === UNIFORM_TYPE.FLOAT ? (C.uniformFunction = S.uniform1f, C.uniformFunctionArguments = [b], this.uniforms[e] = C) : typeof b == "number" && x === UNIFORM_TYPE.INT ? (C.uniformFunction = S.uniform1i, C.uniformFunctionArguments = [b], this.uniforms[e] = C) : Array.isArray(b) && b.length > 0 && typeof b[0] == "number" && x === UNIFORM_TYPE.FLOAT ? (C.uniformFunction = S.uniform1fv, C.uniformFunctionArguments = [b], this.uniforms[e] = C) : Array.isArray(b) && b.length > 0 && typeof b[0] == "number" && x === UNIFORM_TYPE.INT ? (C.uniformFunction = S.uniform1iv, C.uniformFunctionArguments = [b], this.uniforms[e] = C) : console.warn(`Uniform ${e} type mismatch`);
	}
	setUniformTexture2D(b, x) {
		this.outputNeedUpdate = !0;
		let S, C = this.rasterContext.getGlContext();
		if (b in this.uniforms ? (S = this.uniforms[b], S.needsUpdate = !0, S.fragmentTexture?.removeUsageRecord(this, b)) : S = {
			name: b,
			needsUpdate: !0,
			location: null,
			uniformFunction: null,
			uniformFunctionArguments: null,
			isTexture: !0
		}, x instanceof e) {
			let e = x.getOutputTexture();
			S.uniformFunction = C.uniform1i, S.fragmentTexture = e, S.fragmentTexture?.addUsageRecord(this, b), S.uniformFunctionArguments = [S.fragmentTexture.textureUnit], this.uniforms[b] = S;
		} else isTexture(x) ? (S.uniformFunction = C.uniform1i, S.fragmentTexture = x, S.fragmentTexture?.addUsageRecord(this, b), S.uniformFunctionArguments = [S.fragmentTexture.textureUnit], this.uniforms[b] = S) : isArrayOfTexture(x) ? console.warn("Fragment does not support arrays of textures yet.") : console.warn(`Uniform ${b} type mismatch`);
	}
	setUniformVector2(e, b, x = UNIFORM_TYPE.FLOAT) {
		this.outputNeedUpdate = !0;
		let S = this.rasterContext.getGlContext(), C;
		e in this.uniforms ? (C = this.uniforms[e], C.needsUpdate = !0) : C = {
			name: e,
			needsUpdate: !0,
			location: null,
			forcedType: x,
			uniformFunction: null,
			uniformFunctionArguments: null
		}, x === UNIFORM_TYPE.FLOAT ? (C.uniformFunction = S.uniform2f, C.uniformFunctionArguments = [b[0], b[1]], this.uniforms[e] = C) : x === UNIFORM_TYPE.INT ? (C.uniformFunction = S.uniform2i, C.uniformFunctionArguments = [b[0], b[1]], this.uniforms[e] = C) : console.warn(`Uniform ${e} type mismatch`);
	}
	setUniformVector3(e, b, x = UNIFORM_TYPE.FLOAT) {
		this.outputNeedUpdate = !0;
		let S = this.rasterContext.getGlContext(), C;
		e in this.uniforms ? (C = this.uniforms[e], C.needsUpdate = !0) : C = {
			name: e,
			needsUpdate: !0,
			location: null,
			forcedType: x,
			uniformFunction: null,
			uniformFunctionArguments: null
		}, x === UNIFORM_TYPE.FLOAT ? (C.uniformFunction = S.uniform3f, C.uniformFunctionArguments = [
			b[0],
			b[1],
			b[2]
		], this.uniforms[e] = C) : x === UNIFORM_TYPE.INT ? (C.uniformFunction = S.uniform3i, C.uniformFunctionArguments = [
			b[0],
			b[1],
			b[2]
		], this.uniforms[e] = C) : console.warn(`Uniform ${e} type mismatch`);
	}
	setUniformVector4(e, b, x = UNIFORM_TYPE.FLOAT) {
		this.outputNeedUpdate = !0;
		let S = this.rasterContext.getGlContext(), C;
		e in this.uniforms ? (C = this.uniforms[e], C.needsUpdate = !0) : C = {
			name: e,
			needsUpdate: !0,
			location: null,
			forcedType: x,
			uniformFunction: null,
			uniformFunctionArguments: null
		}, x === UNIFORM_TYPE.FLOAT ? (C.uniformFunction = S.uniform4f, C.uniformFunctionArguments = [
			b[0],
			b[1],
			b[2],
			b[3]
		], this.uniforms[e] = C) : x === UNIFORM_TYPE.INT ? (C.uniformFunction = S.uniform4i, C.uniformFunctionArguments = [
			b[0],
			b[1],
			b[2],
			b[3]
		], this.uniforms[e] = C) : console.warn(`Uniform ${e} type mismatch`);
	}
	setUniformRGB(e, b) {
		this.setUniformVector3(e, [
			b[0] / 255,
			b[1] / 255,
			b[2] / 255
		]);
	}
	setUniformRGBA(e, b) {
		this.setUniformVector4(e, [
			b[0] / 255,
			b[1] / 255,
			b[2] / 255,
			b[3]
		]);
	}
	initUniforms() {
		let e = this.rasterContext.getGlContext(), b = this.shaderProgram;
		if (!b) return;
		let x = Object.keys(this.uniforms).map((e) => this.uniforms[e]), S = x.filter((e) => e.isTexture), C = x.filter((e) => !e.isTexture);
		for (let x of C) {
			if (!x.needsUpdate || !x.uniformFunction || !x.uniformFunctionArguments) return;
			x.location ??= e.getUniformLocation(b, x.name), x.uniformFunction.apply(e, [x.location, ...x.uniformFunctionArguments]), x.needsUpdate = !1;
		}
		for (let x of S) {
			if (!x.needsUpdate || !x.uniformFunction || !x.uniformFunctionArguments || !x.fragmentTexture) return;
			x.location ??= e.getUniformLocation(b, x.name);
			let S = x.fragmentTexture.textureUnit;
			e.activeTexture(e.TEXTURE0 + S), e.bindTexture(e.TEXTURE_2D, x.fragmentTexture.texture), x.uniformFunction.apply(e, [x.location, S]), x.needsUpdate = !1;
		}
	}
	initPlane() {
		let e = this.rasterContext.getGlContext();
		if (this.positionAttributeLocation) return;
		let b = this.shaderProgram;
		b && (this.positionAttributeLocation = e.getAttribLocation(b, "a_position"), this.positionBuffer = e.createBuffer(), e.bindBuffer(e.ARRAY_BUFFER, this.positionBuffer), e.bufferData(e.ARRAY_BUFFER, new Float32Array([
			-1,
			-1,
			1,
			-1,
			-1,
			1,
			1,
			1
		]), e.STATIC_DRAW), e.enableVertexAttribArray(this.positionAttributeLocation), e.vertexAttribPointer(this.positionAttributeLocation, 2, e.FLOAT, !1, 0, 0));
	}
	getOutputTexture() {
		return this.outputNeedUpdate && this.render(), this.outputTexture ? this.outputTexture : (console.warn("[GPU readback necessary] This node is not rendering to a texture."), Texture.fromImageSource(this.rasterContext, this.getNewOffscreenCanvas()));
	}
	initRenderToTextureLogic() {
		if (!this.renderToTexture || this.outputTexture && this.reuseOutputTexture) return;
		let e = this.rasterContext.getGlContext(), b = e.createTexture();
		e.bindTexture(e.TEXTURE_2D, b), this.outputTexture = new Texture(this.rasterContext, b, this.outputWidth, this.outputHeight, this.uint32 ? 32 : 8), e.texParameteri(e.TEXTURE_2D, e.TEXTURE_WRAP_S, e.CLAMP_TO_EDGE), e.texParameteri(e.TEXTURE_2D, e.TEXTURE_WRAP_T, e.CLAMP_TO_EDGE), e.texParameteri(e.TEXTURE_2D, e.TEXTURE_MIN_FILTER, e.LINEAR), e.texParameteri(e.TEXTURE_2D, e.TEXTURE_MAG_FILTER, e.LINEAR), this.uint32 ? e.texImage2D(e.TEXTURE_2D, 0, e.RGBA32UI, this.outputWidth, this.outputHeight, 0, e.RGBA_INTEGER, e.UNSIGNED_INT, null) : e.texImage2D(e.TEXTURE_2D, 0, e.RGBA, this.outputWidth, this.outputHeight, 0, e.RGBA, e.UNSIGNED_BYTE, null), this.framebuffer ??= e.createFramebuffer(), e.bindFramebuffer(e.FRAMEBUFFER, this.framebuffer), e.framebufferTexture2D(e.FRAMEBUFFER, e.COLOR_ATTACHMENT0, e.TEXTURE_2D, b, 0), e.checkFramebufferStatus(e.FRAMEBUFFER) !== e.FRAMEBUFFER_COMPLETE && console.error("Framebuffer is not complete.", e.checkFramebufferStatus(e.FRAMEBUFFER));
	}
	updateOutput() {
		if (!this.outputNeedUpdate) return;
		let e = this.rasterContext.getGlContext();
		this.renderToTexture && this.outputTexture && this.framebuffer ? (e.bindTexture(e.TEXTURE_2D, this.outputTexture.texture), e.bindFramebuffer(e.FRAMEBUFFER, this.framebuffer), e.bindTexture(e.TEXTURE_2D, null)) : (e.bindFramebuffer(e.FRAMEBUFFER, null), e.canvas.width = this.outputWidth * devicePixelRatio, e.canvas.height = this.outputHeight * devicePixelRatio, e.canvas instanceof OffscreenCanvas || (e.canvas.style.width = `${this.outputWidth}px`, e.canvas.style.height = `${this.outputHeight}px`), e.viewport(0, 0, e.canvas.width, e.canvas.height)), this.outputNeedUpdate = !1;
	}
	render() {
		if (!this.shaderProgram) return;
		let e = this.rasterContext.getGlContext();
		e.getParameter(e.CURRENT_PROGRAM) !== this.shaderProgram && e.useProgram(this.shaderProgram), this.initPlane(), this.initRenderToTextureLogic(), this.updateOutput(), this.initUniforms(), this.uint32 || (e.clearColor(this.clearColor[0], this.clearColor[1], this.clearColor[2], this.clearColor[3]), e.clear(e.COLOR_BUFFER_BIT)), e.drawArrays(e.TRIANGLE_STRIP, 0, 4);
	}
	dispose() {}
	getPixelData(e = !1) {
		let b = this.rasterContext.getGlContext(), x = b.canvas.width, S = b.canvas.height;
		if (this.uint32 && e) {
			let e = new Uint32Array(x * S * 4);
			return b.readPixels(0, 0, x, S, b.RGBA_INTEGER, b.UNSIGNED_INT, e), new Float32Array(e.buffer);
		}
		if (this.uint32 && !e) {
			let e = new Uint32Array(x * S * 4);
			return b.readPixels(0, 0, x, S, b.RGBA_INTEGER, b.UNSIGNED_INT, e), e;
		}
		let C = new Uint8Array(x * S * 4);
		return b.readPixels(0, 0, x, S, b.RGBA, b.UNSIGNED_BYTE, C), C;
	}
	getImageData() {
		if (this.uint32) throw Error("Uint32 image cannot be used to create an RGBA8 image.");
		let e = this.rasterContext.getGlContext(), b = e.canvas.width, x = e.canvas.height, S = new ImageData(b, x), C = this.getPixelData();
		return S.data.set(C), S;
	}
	async getImageBitmap() {
		let e = this.getImageData();
		return createImageBitmap(e);
	}
	getNewOffscreenCanvas() {
		let e = this.getImageData(), b = new OffscreenCanvas(e.width, e.height);
		return b.getContext("2d").putImageData(e, 0, 0), b;
	}
	async getPNGImageBlob() {
		return await this.getNewOffscreenCanvas().convertToBlob();
	}
	async getPNGImageBuffer() {
		if (this.uint32) return console.warn("Cannot convert uint32 data into PNG."), null;
		let e = await this.getPNGImageBlob();
		return e ? await e.arrayBuffer() : (console.warn("The PNG blob could not be created."), null);
	}
	async getPNGImageObjectURL() {
		if (this.uint32) return console.warn("Cannot convert uint32 data into PNG."), null;
		let e = await this.getPNGImageBlob();
		return e ? URL.createObjectURL(e) : (console.warn("The PNG blob could not be created."), null);
	}
	doesOutputNeedUpdate() {
		return this.outputNeedUpdate;
	}
	free() {
		let e = this.rasterContext.getGlContext();
		this.framebuffer &&= (e.bindFramebuffer(e.FRAMEBUFFER, this.framebuffer), e.framebufferTexture2D(e.FRAMEBUFFER, e.COLOR_ATTACHMENT0, e.TEXTURE_2D, null, 0), e.bindFramebuffer(e.FRAMEBUFFER, null), e.deleteFramebuffer(this.framebuffer), null), this.outputTexture && this.outputTexture.free(), this.resetProgram(), this.positionBuffer &&= (e.deleteBuffer(this.positionBuffer), null);
	}
}, RasterContext = class {
	canvas;
	width;
	height;
	offscreen;
	gl;
	registeredTextures = [];
	registeredProcessingNodes = [];
	constructor(e) {
		this.offscreen = e.offscreen ?? !1, this.width = e.width, this.height = e.height, this.offscreen ? this.canvas = new OffscreenCanvas(this.width, this.height) : (this.canvas = document.createElement("canvas"), this.canvas.width = this.width, this.canvas.height = this.width);
		let b = this.canvas.getContext("webgl2", {
			alpha: !0,
			premultipliedAlpha: !1
		});
		if (!b) throw Error("This device is not compatible with WebGL2");
		this.gl = b;
	}
	getCanvas() {
		return this.canvas;
	}
	getGlContext() {
		return this.gl;
	}
	getSize() {
		return {
			width: this.width,
			height: this.height
		};
	}
	isOffscreen() {
		return this.offscreen;
	}
	registerTexture(e) {
		this.registeredTextures.push(e);
	}
	registerProcessingNode(e) {
		this.registeredProcessingNodes.push(e);
	}
	free() {
		for (let e of this.registeredProcessingNodes) e.free();
		for (let e of this.registeredTextures) e.free();
	}
};
export { DEFAULT_HEIGHT, DEFAULT_WIDTH, ProcessingNode, RasterContext, Texture, UNIFORM_TYPE, compileShader, createProgram, fetchAsImageBitmap, freeTextureUnit, getCurrentTextureUnit, getShaderCompileError, getUnusedTextureUnit, incrementCurrentTextureUnit, isArrayOfNumber, isArrayOfTexture, isBoolean, isMatrix2, isMatrix3, isMatrix4, isNumber, isObject, isTexture, isVector2, isVector3, isVector4, prepareGlContext };

//# sourceMappingURL=raster-gl.js.map