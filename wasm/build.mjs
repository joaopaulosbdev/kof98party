import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";

const ROOT = path.resolve(import.meta.dirname, "..");
const SRC = path.join(ROOT, "FBNeo-master", "src");
const GEN = path.join(import.meta.dirname, "build", "generated");
const PATCHED = path.join(import.meta.dirname, "build", "patched");
const OBJ = path.join(import.meta.dirname, "build", "obj");
const OUT_DIR = import.meta.dirname;

const EMSDK_ROOT = "C:/emsdk";
const EMCC = path.join(EMSDK_ROOT, "upstream", "emscripten", "emcc.exe");
const EMPP = path.join(EMSDK_ROOT, "upstream", "emscripten", "em++.exe");

const env = {
  ...process.env,
  EMSDK: EMSDK_ROOT,
  EMSDK_NODE: path.join(EMSDK_ROOT, "node", "24.19.0_64bit", "node.exe"),
  EMSDK_PYTHON: path.join(EMSDK_ROOT, "python", "3.13.3_64bit", "python.exe"),
  PATH: [
    EMSDK_ROOT,
    path.join(EMSDK_ROOT, "upstream", "emscripten"),
    path.join(EMSDK_ROOT, "node", "24.19.0_64bit"),
    process.env.PATH || "",
  ].join(path.delimiter),
};

const includeDirs = [
  GEN,
  path.join(SRC, "burn"),
  path.join(SRC, "burn", "devices"),
  path.join(SRC, "burn", "snd"),
  path.join(SRC, "burn", "drv", "neogeo"),
  path.join(SRC, "cpu"),
  path.join(SRC, "cpu", "m68k"),
  path.join(SRC, "cpu", "z80"),
  path.join(SRC, "burner"),
  path.join(SRC, "burner", "headless"),
  path.join(SRC, "burner", "sdl"),
  path.join(SRC, "intf"),
  path.join(SRC, "intf", "audio"),
  path.join(SRC, "intf", "audio", "headless"),
  path.join(SRC, "intf", "video"),
  path.join(SRC, "intf", "video", "headless"),
  path.join(SRC, "intf", "input"),
  path.join(SRC, "intf", "input", "headless"),
  path.join(SRC, "intf", "cd"),
  path.join(SRC, "dep", "libs", "zlib"),
  path.join(SRC, "dep", "libs", "libspng"),
  path.join(SRC, "dep", "libs", "zip"),
  path.join(SRC, "dep", "libs", "lzma"),
  path.join(SRC, "dep", "libs", "lzma", "include"),
  path.join(SRC, "dep", "libs", "zstd"),
  path.join(SRC, "dep", "libs", "libchdr"),
  path.join(SRC, "dep", "libs", "libchdr", "include"),
  path.join(SRC, "dep", "libs", "dr_libs"),
];

const commonDefs = [
  "-DBUILD_HEADLESS",
  "-DBUILD_NEOGEO",
  "-DLSB_FIRST",
  "-DSUPPORT_SPLIT_DRIVER",
  "-DUSE_SPEEDHACKS",
  "-DUSE_FILE32API",
  "-DHAVE_UNISTD_H",
  "-DNO_VIZ",
  "-D_LARGEFILE64_SOURCE=0",
  "-D_FILE_OFFSET_BITS=64",
  "-DCHDR_SYSTEM_ZLIB",
  "-D__fastcall=",
  "-DFILENAME=fbneo",
  "-DHAS_YM2610=1",
  "-DHAS_YM2610B=1",
  "-DHAS_Y8950=0",
  "-DHAS_YM2203=0",
  "-DHAS_YM2608=0",
  "-DHAS_YM2612=0",
  "-DHAS_YM3438=0",
  "-DHAS_YM3526=0",
  "-DHAS_YM3812=0",
  "-D_GNU_SOURCE",
];

const sources = [
  // Wrapper
  path.join(import.meta.dirname, "fbneo_wasm.cpp"),

  // Generated m68kops
  path.join(GEN, "m68kops.c"),

  // Core burn
  ...[
    "burn.cpp", "burn_bitmap.cpp", "burn_gun.cpp", "burn_hdd.cpp", "burn_led.cpp",
    "burn_memory.cpp", "burn_pal.cpp", "burn_sha1.cpp", "burn_shift.cpp",
    "burn_sound.cpp", "burn_sound_c.cpp", "cheat.cpp", "debug_track.cpp",
    "hiscore.cpp", "load.cpp", "tilemap_generic.cpp", "tiles_generic.cpp",
    "timer.cpp", "vector.cpp",
  ].map((f) => path.join(SRC, "burn", f)),

  // Devices
  ...["joyprocess.cpp", "resnet.cpp"].map((f) => path.join(SRC, "burn", "devices", f)),

  // Sound
  ...["ay8910.c", "fm.c", "ymdeltat.c", "burn_ym2610.cpp", "burn_ost.cpp", "samples.cpp"].map((f) =>
    path.join(SRC, "burn", "snd", f)
  ),

  // CPU
  ...[
    "m68000_intf.cpp",
    "m68k/m68kcpu.c",
    "m68k/m68kdasm.c",
    "z80_intf.cpp",
    "z80/z80.cpp",
    "z80/z80ctc.cpp",
    "z80/z80daisy.cpp",
    "z80/z80pio.cpp",
  ].map((f) => path.join(SRC, "cpu", f)),

  // Drivers (Neo Geo + d_parent)
  path.join(SRC, "burn", "drv", "d_parent.cpp"),
  ...[
    "d_neogeo.cpp",
    "neo_decrypt.cpp",
    "neo_palette.cpp",
    "neo_run.cpp",
    "neo_sprite.cpp",
    "neo_text.cpp",
    "neo_upd4990a.cpp",
    "neogeo.cpp",
  ].map((f) => path.join(SRC, "burn", "drv", "neogeo", f)),

  // Burner shared
  ...[
    "cdlist.cpp", "conc.cpp", "cong.cpp", "dat.cpp", "gamc.cpp", "gami.cpp", "image.cpp",
    "inputbuf.cpp", "ioapi.c", "misc.cpp", "sshot.cpp", "state.cpp",
    "statec.cpp", "unzip.c", "zipfn.cpp",
  ].map((f) => path.join(SRC, "burner", f)),

  // Burner shared (from sdl subdir, non-SDL files used by headless)
  ...[
    "bzip.cpp", "inpdipsw.cpp", "ips_manager.cpp", "localise_gamelist.cpp",
    "media.cpp", "replay.cpp", "romdata.cpp", "scrn.cpp", "stated.cpp",
    "stringset.cpp", "support_paths.cpp",
  ].map((f) => path.join(SRC, "burner", "sdl", f)),

  // Burner headless
  ...[
    "headless_main.cpp", "headless_drv.cpp", "headless_input.cpp",
    "headless_memory.cpp", "headless_misc.cpp",
  ].map((f) => path.join(SRC, "burner", "headless", f)),

  // Interfaces
  path.join(SRC, "intf", "interface.cpp"),
  path.join(SRC, "intf", "audio", "aud_dsp.cpp"),
  path.join(SRC, "intf", "audio", "aud_interface.cpp"),
  path.join(SRC, "intf", "audio", "lowpass2.cpp"),
  path.join(SRC, "intf", "audio", "headless", "aud_headless.cpp"),
  path.join(SRC, "intf", "cd", "cd_interface.cpp"),
  path.join(SRC, "intf", "cd", "cd_chd.cpp"),
  path.join(SRC, "intf", "cd", "cd_img.cpp"),
  path.join(SRC, "intf", "input", "inp_interface.cpp"),
  path.join(SRC, "intf", "input", "headless", "inp_headless.cpp"),
  path.join(SRC, "intf", "video", "vid_interface.cpp"),
  path.join(SRC, "intf", "video", "vid_support.cpp"),
  path.join(SRC, "intf", "video", "headless", "vid_headless.cpp"),

  // Third-party libs
  ...fs.readdirSync(path.join(SRC, "dep", "libs", "zlib"))
    .filter((f) => f.endsWith(".c"))
    .map((f) => path.join(SRC, "dep", "libs", "zlib", f)),
  ...fs.readdirSync(path.join(SRC, "dep", "libs", "libchdr"))
    .filter((f) => f.endsWith(".c"))
    .map((f) => path.join(SRC, "dep", "libs", "libchdr", f)),
  path.join(SRC, "dep", "libs", "libspng", "spng.c"),
  path.join(SRC, "dep", "libs", "zip", "zip.c"),
  path.join(SRC, "dep", "libs", "lzma", "libchdr_lzma.c"),
  path.join(SRC, "dep", "libs", "zstd", "zstddeclib.c"),
];

fs.mkdirSync(OBJ, { recursive: true });
fs.mkdirSync(PATCHED, { recursive: true });

const PATCH_HS_FILES = new Set([
  "burn.cpp",
  "burn_hdd.cpp",
  "gami.cpp",
  "bzip.cpp",
  "inpdipsw.cpp",
  "romdata.cpp",
]);

function runCmd(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { env, shell: false });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d.toString()));
    child.stderr.on("data", (d) => (err += d.toString()));
    child.on("close", (code) => {
      if (code === 0) resolve({ out, err });
      else reject(new Error(`Exit ${code}: ${cmd} ${args.join(" ")}\n${out}\n${err}`));
    });
  });
}

const incArgs = includeDirs.map((d) => `-I${d}`);
const cFlags = [
  "-O3",
  "-std=gnu99",
  "-include",
  "unistd.h",
  "-Wno-write-strings",
  "-Wno-sign-compare",
  "-Wno-unused",
  "-Wno-conversion",
  "-Wno-attributes",
  "-Wno-unused-parameter",
  "-Wno-unused-value",
  "-Wno-deprecated-declarations",
  ...commonDefs,
  ...incArgs,
];
const cppFlags = [
  "-O3",
  "-std=c++11",
  "-Wno-write-strings",
  "-Wno-sign-compare",
  "-Wno-unused",
  "-Wno-conversion",
  "-Wno-attributes",
  "-Wno-unused-parameter",
  "-Wno-unused-value",
  "-Wno-narrowing",
  "-Wno-unknown-pragmas",
  "-Wno-undef",
  "-Wno-missing-braces",
  "-Wno-multichar",
  "-Wno-sequence-point",
  "-Wno-deprecated-declarations",
  ...commonDefs,
  ...incArgs,
];

const objs = [];
const queue = [];

for (const rawSrcFile of sources) {
  if (!fs.existsSync(rawSrcFile)) {
    throw new Error(`Missing source file: ${rawSrcFile}`);
  }
  let srcFile = rawSrcFile;
  const baseName = path.basename(rawSrcFile);
  if (PATCH_HS_FILES.has(baseName)) {
    const patchedFile = path.join(PATCHED, baseName);
    const origContent = fs.readFileSync(rawSrcFile, "utf8");
    const newContent = origContent.replaceAll("%hs", "%s");
    if (!fs.existsSync(patchedFile) || fs.readFileSync(patchedFile, "utf8") !== newContent) {
      fs.writeFileSync(patchedFile, newContent, "utf8");
    }
    srcFile = patchedFile;
  }
  const rel = path.relative(ROOT, rawSrcFile).replace(/[:\\/]/g, "_");
  const objFile = path.join(OBJ, `${rel}.o`);
  objs.push(objFile);

  const srcStat = fs.statSync(srcFile);
  const objExists = fs.existsSync(objFile);
  if (objExists && fs.statSync(objFile).mtimeMs >= srcStat.mtimeMs) {
    continue;
  }

  const isCpp = srcFile.endsWith(".cpp");
  const compiler = isCpp ? EMPP : EMCC;
  const flags = isCpp ? cppFlags : cFlags;
  queue.push({ srcFile, objFile, compiler, flags });
}

console.log(`Total sources: ${sources.length}, compiling: ${queue.length}`);

const concurrency = Math.max(2, Math.min(os.cpus().length, 8));
let idx = 0;
let done = 0;

async function worker() {
  while (idx < queue.length) {
    const job = queue[idx++];
    await runCmd(job.compiler, [...job.flags, "-c", job.srcFile, "-o", job.objFile]);
    done++;
    if (done % 10 === 0 || done === queue.length) {
      console.log(`Compiled ${done}/${queue.length}: ${path.basename(job.srcFile)}`);
    }
  }
}

await Promise.all(Array.from({ length: concurrency }, worker));

console.log("Linking kof98_fbneo.js + kof98_fbneo.wasm...");
const exportedFns = [
  "_malloc", "_free",
  "_fbw_init", "_fbw_set_rom_path", "_fbw_load", "_fbw_frame",
  "_fbw_reset", "_fbw_exit",
  "_fbw_get_width", "_fbw_get_height", "_fbw_get_fps", "_fbw_copy_rgba",
  "_fbw_get_audio_rate", "_fbw_get_audio_frames", "_fbw_get_audio_buffer",
  "_fbw_set_input", "_fbw_save_state", "_fbw_load_state", "_fbw_set_dip",
];
const exportedRuntime = [
  "FS", "ccall", "cwrap", "UTF8ToString", "HEAPU8", "HEAP16", "HEAP32", "HEAPU32",
];

await runCmd(EMPP, [
  "-O3",
  ...objs,
  "-o", path.join(OUT_DIR, "kof98_fbneo.js"),
  "-sALLOW_MEMORY_GROWTH=1",
  "-sINITIAL_MEMORY=268435456",
  "-sMAXIMUM_MEMORY=1073741824",
  "-sMODULARIZE=1",
  "-sEXPORT_ES6=1",
  "-sEXPORT_NAME=createFBNeoModule",
  `-sEXPORTED_FUNCTIONS=${JSON.stringify(exportedFns)}`,
  `-sEXPORTED_RUNTIME_METHODS=${JSON.stringify(exportedRuntime)}`,
  "-sFILESYSTEM=1",
  "-sENVIRONMENT=web",
]);

console.log("Build complete!");
