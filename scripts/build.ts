import { mkdirSync, writeFileSync, copyFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";
import * as esbuild from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
const src = join(root, "src");

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let i = 0; i < 8; i += 1) {
      const mask = -(crc & 1);
      crc = (crc >>> 1) ^ (0xedb88320 & mask);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const typeBuffer = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])));
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function png(size: number): Buffer {
  const raw: number[] = [];
  for (let y = 0; y < size; y += 1) {
    raw.push(0);
    for (let x = 0; x < size; x += 1) {
      const nx = (x + 0.5) / size;
      const ny = (y + 0.5) / size;
      const inLens = Math.hypot(nx - 0.42, ny - 0.42) < 0.22;
      const inRing = Math.hypot(nx - 0.42, ny - 0.42) < 0.3 && !inLens;
      const handle = ny - nx > 0.28 && ny - nx < 0.42 && nx > 0.52 && ny > 0.52;
      const on = inRing || handle;
      raw.push(24, 119, 242, on ? 255 : 255);
      if (!on) {
        raw[raw.length - 1] = 255;
      }
      if (!on && !inLens) {
        raw[raw.length - 4] = 24;
        raw[raw.length - 3] = 119;
        raw[raw.length - 2] = 242;
      }
      if (inLens) {
        raw[raw.length - 4] = 255;
        raw[raw.length - 3] = 255;
        raw[raw.length - 2] = 255;
        raw[raw.length - 1] = 255;
      }
      if (on) {
        raw[raw.length - 4] = 255;
        raw[raw.length - 3] = 255;
        raw[raw.length - 2] = 255;
      }
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const idat = deflateSync(Buffer.from(raw));
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0))
  ]);
}

mkdirSync(join(dist, "icons"), { recursive: true });
mkdirSync(join(dist, "popup"), { recursive: true });
mkdirSync(join(dist, "content"), { recursive: true });

for (const size of [16, 32, 48, 128]) {
  writeFileSync(join(dist, "icons", `icon${size}.png`), png(size));
}

copyFileSync(join(src, "manifest.json"), join(dist, "manifest.json"));
copyFileSync(join(src, "popup", "popup.html"), join(dist, "popup", "popup.html"));
copyFileSync(join(src, "popup", "popup.css"), join(dist, "popup", "popup.css"));
copyFileSync(join(src, "content", "overlay.css"), join(dist, "content", "overlay.css"));

const alias = { "@src": src };

await Promise.all([
  esbuild.build({
    entryPoints: [join(src, "background.ts")],
    outfile: join(dist, "background.js"),
    bundle: true,
    format: "esm",
    target: "es2022",
    alias
  }),
  esbuild.build({
    entryPoints: [join(src, "content", "isolated.ts")],
    outfile: join(dist, "content", "isolated.js"),
    bundle: true,
    format: "iife",
    target: "es2022",
    alias
  }),
  esbuild.build({
    entryPoints: [join(src, "content", "main.ts")],
    outfile: join(dist, "content", "main.js"),
    bundle: true,
    format: "iife",
    target: "es2022",
    alias
  }),
  esbuild.build({
    entryPoints: [join(src, "popup", "popup.ts")],
    outfile: join(dist, "popup", "popup.js"),
    bundle: true,
    format: "iife",
    target: "es2022",
    alias
  })
]);
