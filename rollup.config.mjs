import commonjs from "@rollup/plugin-commonjs";
import nodeResolve from "@rollup/plugin-node-resolve";
import typescript from "@rollup/plugin-typescript";
import path from "node:path";
import url from "node:url";

const isWatching = !!process.env.ROLLUP_WATCH;
const sdPlugin = "tphan.enphase.sdPlugin";

/** @type {import("rollup").RollupOptions} */
const config = {
	input: "src/plugin.ts",
	output: {
		file: `${sdPlugin}/bin/plugin.js`,
		format: "es",
		sourcemap: isWatching,
		sourcemapPathTransform: (relativeSourcePath, sourcemapPath) =>
			url.pathToFileURL(path.resolve(path.dirname(sourcemapPath), relativeSourcePath)).href,
	},
	plugins: [
		{
			// Rebuild whenever the manifest changes while watching.
			name: "watch-manifest",
			buildStart() {
				this.addWatchFile(`${sdPlugin}/manifest.json`);
			},
		},
		typescript({ mapRoot: isWatching ? "./" : undefined }),
		nodeResolve({ browser: false, exportConditions: ["node"], preferBuiltins: true }),
		commonjs(),
		{
			// Stream Deck loads the bundle as ESM; the bin/ folder needs its own type marker
			// because the installed .sdPlugin folder has no package.json above it.
			name: "emit-module-package-file",
			generateBundle() {
				this.emitFile({ type: "asset", fileName: "package.json", source: `{ "type": "module" }` });
			},
		},
	],
};

export default config;
