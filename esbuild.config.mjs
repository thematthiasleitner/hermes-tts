import esbuild from "esbuild";
import { readFileSync } from "fs";

const banner = {
  js: readFileSync("banner.js", "utf8"),
};

const prod = process.argv.includes("--prod");
const dev = process.argv.includes("--dev");

const options = {
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: [
    "obsidian",
    "electron",
    "@codemirror/state",
    "@codemirror/view"
  ],
  format: "cjs",
  target: "es2018",
  platform: "node",
  sourcemap: prod ? false : "inline",
  banner,
  outfile: "main.js",
  logLevel: "info"
};

if (dev) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
  console.log("Watching for changes...");
} else {
  await esbuild.build(options);
}
