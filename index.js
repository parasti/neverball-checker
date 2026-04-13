'use strict';

const Solid = require('neverball-solid');

// --- Pure parsers ---

/**
 * Parse a SOL file buffer and return its direct asset dependencies.
 * The path argument is unused by the default implementation; injected parsers
 * may use it to look up precomputed data instead of parsing the buffer.
 *
 * @param {string} path Neverball path of the SOL file
 * @param {Buffer} buffer
 * @returns {{ images: string[], audio: string[], sols: string[], materials: string[] }}
 */
function parseSol(path, buffer) {
  const images = [];
  const audio = [];
  const sols = [];
  const materials = [];

  try {
    const sol = Solid(buffer);

    if (sol.dicts.shot) images.push(sol.dicts.shot);
    if (sol.dicts.grad) images.push(sol.dicts.grad);
    if (sol.dicts.song) audio.push(sol.dicts.song);
    if (sol.dicts.back) sols.push(sol.dicts.back);

    for (const mtrl of sol.mtrls) {
      if (!(mtrl.f === 'NULL' || mtrl.f === 'default')) {
        materials.push(mtrl.f);
      }
    }
  } catch (e) {
    // unparseable SOL — return empty
  }

  return { images, audio, sols, materials };
}

/**
 * Parse a set file (.txt) and return its direct asset dependencies.
 * The path argument is unused by the default implementation.
 *
 * @param {string} path Neverball path of the set file
 * @param {string} content
 * @returns {{ images: string[], sols: string[], sets: string[] }}
 */
function parseSetFile(path, content) {
  const lines = content.split(/\r?\n/).map(l => l.trim());
  const filename = path.split('/').pop();

  if (filename === 'sets.txt' || filename === 'courses.txt') {
    return {
      images: [],
      sols: [],
      sets: lines.filter(l => l && !l.startsWith('#')),
    };
  }

  if (filename.startsWith('holes-') && filename.endsWith('.txt')) {
    return {
      images: [],
      sols: [],
      sets: [],
    };
  }

  const shot = lines[3] || '';
  const sols = lines.slice(5).filter(Boolean);

  return {
    images: shot ? [shot] : [],
    sols,
    sets: [],
  };
}

/**
 * Parse a .map file buffer and return the OBJ model paths it references.
 * The path argument is unused by the default implementation.
 *
 * @param {string} path Neverball path of the .map file
 * @param {Buffer} buffer
 * @returns {string[]}
 */
function parseMap(path, buffer) {
  const matches = buffer.toString().matchAll(/"model" +"([^"]+)"/g);
  return [...new Set(Array.from(matches, m => m[1]))];
}

/**
 * Return candidate file paths for a material name, in lookup order.
 *
 * @param {string} mtrl
 * @returns {string[]}
 */
function materialPaths(mtrl) {
  return ['textures/' + mtrl, mtrl];
}

/**
 * Return candidate image paths for a material name, in lookup order.
 *
 * @param {string} mtrl
 * @returns {string[]}
 */
function materialImagePaths(mtrl) {
  return [
    'textures/' + mtrl + '.png',
    'textures/' + mtrl + '.jpg',
    mtrl + '.png',
    mtrl + '.jpg',
  ];
}

// --- Pass 1: build deps ---

/**
 * @typedef {{ images: string[], audio: string[], sols: string[], sets: string[], materials: string[], objs: string[] }} DepEntry
 */

/**
 * Recursively collect dependencies reachable from startPath.
 *
 * @param {string} startPath Neverball path to start from (set file or SOL)
 * @param {{
 *   readFile: (path: string) => Buffer|null,
 *   fileExists?: (path: string) => boolean,
 *   parseSol?: typeof parseSol,
 *   parseSetFile?: typeof parseSetFile,
 *   parseMap?: typeof parseMap,
 * }} opts
 * @returns {{ deps: Object.<string, DepEntry> }}
 */
function buildDeps(startPath, opts) {
  const _readFile = opts.readFile;
  const _fileExists = opts.fileExists || (p => _readFile(p) !== null);
  const _parseSol = opts.parseSol || parseSol;
  const _parseSetFile = opts.parseSetFile || parseSetFile;
  const _parseMap = opts.parseMap || parseMap;

  /** @type {Object.<string, DepEntry>} */
  const deps = {};
  const visited = new Set();

  function visitMaterial(mtrl) {
    if (deps[mtrl]) return;

    const mtrlImage = materialImagePaths(mtrl).find(p => _fileExists(p));

    deps[mtrl] = {
      images: mtrlImage ? [mtrlImage] : [],
      audio: [],
      sols: [],
      sets: [],
      materials: [],
      objs: [],
    };
  }

  function visit(path) {
    if (visited.has(path)) return;
    visited.add(path);

    const buf = _readFile(path);
    if (!buf) return;

    /** @type {DepEntry} */
    let entry;

    if (path.endsWith('.sol')) {
      const { images, audio, sols, materials } = _parseSol(path, buf);

      const mapPath = path.replace(/\.sol$/, '.map');
      const mapBuf = _readFile(mapPath);
      const objs = mapBuf ? _parseMap(mapPath, mapBuf) : [];

      entry = { images, audio, sols, sets: [], materials, objs };

      for (const mtrl of materials) {
        visitMaterial(mtrl);
      }
    } else {
      const { images, sols, sets } = _parseSetFile(path, buf.toString('utf8'));
      entry = { images, audio: [], sols, sets, materials: [], objs: [] };
    }

    deps[path] = entry;

    for (const sol of entry.sols) {
      visit(sol);
    }

    for (const set of entry.sets) {
      visit(set);
    }
  }

  visit(startPath);

  return { deps };
}

// --- Pass 2: pure check ---

/**
 * @typedef {Object} MissingAsset
 * @property {string} path
 * @property {{ path: string }|null} parent
 * @property {string} type
 */

/**
 * Check a set file's dependency tree against a known file set.
 * Pure: no I/O, no callbacks.
 *
 * @param {string} setFile Neverball path of the set file to check
 * @param {{ deps: Object.<string, DepEntry>, files: Set<string> }} structure
 * @returns {{ missingAssets: Map<string, MissingAsset>, foundAssets: Set<string> }}
 */
function check(setFile, { deps, files }) {
  /** @type {Map<string, MissingAsset>} */
  const missingAssets = new Map();
  const foundAssets = new Set();
  const visited = new Set();

  function markMissing(path, parent, type) {
    missingAssets.set(path, { path, parent, type });
  }

  function traverse(path) {
    if (visited.has(path)) return;
    visited.add(path);

    const entry = deps[path];
    if (!entry) return;

    const self = { path };

    for (const img of entry.images) {
      if (!files.has(img)) markMissing(img, self, 'image');
      else foundAssets.add('image:' + img);
    }

    for (const aud of entry.audio) {
      if (!files.has(aud)) markMissing(aud, self, 'audio');
      else foundAssets.add('audio:' + aud);
    }

    for (const sol of entry.sols) {
      const mapPath = sol.replace(/\.sol$/, '.map');

      if (!files.has(sol)) markMissing(sol, self, 'sol');
      else foundAssets.add('sol:' + sol);

      if (!files.has(mapPath)) markMissing(sol, self, 'map'); // keyed on SOL path
      else foundAssets.add('map:' + mapPath);

      traverse(sol);
    }

    for (const set of entry.sets) {
      const filename = set.split('/').pop();
      const type = (filename.startsWith('holes-') && filename.endsWith('.txt')) ? 'course' : 'set';
      if (!files.has(set)) markMissing(set, self, type);
      else foundAssets.add(type + ':' + set);

      traverse(set);
    }

    for (const mtrl of entry.materials) {
      const mtrlPath = materialPaths(mtrl).find(p => files.has(p));
      if (!mtrlPath) markMissing(mtrl, self, 'material');
      else foundAssets.add('material:' + mtrlPath); // resolved path

      const mtrlImg = materialImagePaths(mtrl).find(p => files.has(p));
      if (!mtrlImg) markMissing(mtrl, self, 'material-image');
      else foundAssets.add('material-image:' + mtrlImg);
    }

    for (const obj of entry.objs) {
      if (!files.has(obj)) markMissing(obj, self, 'obj');
      else foundAssets.add('obj:' + obj);
    }
  }

  traverse(setFile);

  return { missingAssets, foundAssets };
}

/**
 * Validate all set files in an addon against a stock asset manifest.
 *
 * Handles the two-pass dep-build + check cycle that is common to both the
 * browser validator and the CLI zip builder. Callers only need to supply how
 * files are read and which paths exist in the addon; what to do with the
 * results (render UI, build zips, …) is left to the caller.
 *
 * @param {{ files: string[], deps: Object.<string, DepEntry> }} stockAssets
 *   Pre-computed manifest of base-game files and their dependency graph,
 *   as produced by `neverball-checker --dump-deps`.
 * @param {string[]} addonFiles
 *   All file paths present in the addon (relative, Neverball-style).
 * @param {(path: string) => Buffer|null} readFile
 *   Read an addon file by its Neverball-relative path. Return null if absent.
 * @returns {{
 *   valid: boolean,
 *   sets: Array<{
 *     setFile: string,
 *     slug: string,
 *     missingAssets: Map<string, MissingAsset>,
 *     foundAssets: Set<string>
 *   }>
 * }}
 */
function checkAddon(stockAssets, addonFiles, readFile) {
  const setFiles = addonFiles.filter(p => /^set-[^/]+\.txt$/.test(p));

  const addonDeps = Object.assign(
    {},
    ...setFiles.map(sf => buildDeps(sf, { readFile }).deps)
  );

  const combinedDeps  = { ...stockAssets.deps, ...addonDeps };
  const combinedFiles = new Set([...stockAssets.files, ...addonFiles]);

  const sets = setFiles.map(setFile => {
    const slug = setFile.replace(/^set-(.+)\.txt$/, '$1');
    const { missingAssets, foundAssets } = check(setFile, {
      deps:  combinedDeps,
      files: combinedFiles,
    });
    return { setFile, slug, missingAssets, foundAssets };
  });

  return { valid: sets.length > 0 && sets.every(s => s.missingAssets.size === 0), sets };
}

module.exports = check;
module.exports.checkAddon = checkAddon;
module.exports.buildDeps = buildDeps;
module.exports.parseSol = parseSol;
module.exports.parseSetFile = parseSetFile;
module.exports.parseMap = parseMap;
module.exports.materialPaths = materialPaths;
module.exports.materialImagePaths = materialImagePaths;
