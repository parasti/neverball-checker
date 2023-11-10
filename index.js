#!/usr/bin/env node

'use strict';

const process = require('node:process');
const path = require('node:path');
const fs = require('node:fs');
const Solid = require('neverball-solid');

if (process.argv.length < 4) {
  console.error('Usage: %s neverball-data set-file.txt', process.argv[1]);
  process.exit(1);
}

/** @type {string} Path to Neverball data (argument) */
const baseDir = process.argv[2];

/** @type {string} Path to set file (argument) */
const setFile = process.argv[3];

/** @type {string} Path to addon data directory, derived from {@link setFile} */
const addonDir = path.dirname(setFile);

if (!fs.existsSync(baseDir)) {
  console.error('Base directory does not exist.');
  process.exit(1);
}

if (!fs.existsSync(setFile)) {
  console.error('Set file does not exist.');
  process.exit(1);
}

/**
 * @typedef {Object} AssetBundle
 * 
 * @property {Set<string>} imageAssets
 * @property {Set<string>} audioAssets
 * @property {Set<string>} solAssets
 * @property {Set<string>} materialAssets
 * 
 * @typedef {Object} TypedAsset
 * 
 * @property {string} type
 * @property {string} path
 */

/** @type {Map<string,string>} */
const foundAddonFilenames = new Map();

/** @type {Map<string,string>} */
const foundBaseFilenames = new Map();

// HACK: include the set file itself.
foundAddonFilenames.set(path.basename(setFile), setFile);

/**
 * Get system filename from a Neverball path.
 * 
 * @param {string} path Neverball path
 * @returns {string?} system path
 */
function getSystemFile(path) {
  const addonPath = addonDir + '/' + path;
  const basePath = baseDir + '/' + path;

  if (fs.existsSync(addonPath)) {
    foundAddonFilenames.set(path, addonPath);
    return addonPath;
  } else if (fs.existsSync(basePath)) {
    foundBaseFilenames.set(path, basePath);
    return basePath;
  }

  return null;
}

/**
 * @param {string} filename system path of a set file
 * @returns AssetBundle
 */
function getAssetsFromSetFile(filename) {
  /** @type {Set<string>} */
  const imageAssets = new Set();
  /** @type {Set<string>} */
  const solAssets = new Set();

  const content = fs.readFileSync(filename, {encoding: 'utf-8'});
  const lines = content.split(/\r?\n/);
  const shot = lines[3] || '';
  const sols = lines.slice(5);

  if (shot) {
    imageAssets.add(shot);
  }

  for (const sol of sols) {
    if (sol) {
      solAssets.add(sol);
    }
  }

  return {
    imageAssets,
    audioAssets: new Set(),
    solAssets,
    materialAssets: new Set(),
  };
}

/**
 * @param {string} path Neverball path of SOL file
 * @returns AssetBundle
 */
function getAssetsFromSolFile(path) {
  /** @type {Set<string>} */
  const imageAssets = new Set();
  /** @type {Set<string>} */
  const audioAssets = new Set();
  /** @type {Set<string>} */
  const solAssets = new Set();
  /** @type {Set<string>} */
  const materialAssets = new Set();

  try {
    const filename = getSystemFile(path);

    if (!filename) {
      throw new Error(path + ' not found');
    }

    const sol = Solid(fs.readFileSync(filename));

    if (sol.dicts.shot) {
      imageAssets.add(sol.dicts.shot);
    }

    if (sol.dicts.song) {
      audioAssets.add(sol.dicts.song);
    }

    if (sol.dicts.grad) {
      imageAssets.add(sol.dicts.grad);
    }

    if (sol.dicts.back) {
      solAssets.add(sol.dicts.back);
    }

    for (const mtrl of sol.mtrls) {
      if (!(mtrl.f === 'NULL' || mtrl.f === 'default')) {
        materialAssets.add(mtrl.f);
      }
    }
  } catch (e) {
    console.error(e);
  }

  return {
    imageAssets,
    audioAssets,
    solAssets,
    materialAssets,
  };
}

/**
 * @param {AssetBundle} mainAssets
 * @returns {AssetBundle} combined assets
 */
function getAssetsRecursively(mainAssets) {
  let combinedImages = mainAssets.imageAssets || new Set();
  let combinedAudios = mainAssets.audioAssets || new Set();
  let combinedSols = mainAssets.solAssets || new Set();
  let combinedMaterials = mainAssets.materialAssets || new Set();
  
  for (const sol of mainAssets.solAssets) {
    const childAssets = getAssetsRecursively(getAssetsFromSolFile(sol));

    combinedImages = [...combinedImages, ...childAssets.imageAssets];
    combinedAudios = [...combinedAudios, ...childAssets.audioAssets];
    combinedSols = [...combinedSols, ...childAssets.solAssets];
    combinedMaterials = [...combinedMaterials, ...childAssets.materialAssets];
  }

  return {
    imageAssets: combinedImages,
    audioAssets: combinedAudios,
    solAssets: combinedSols,
    materialAssets: combinedMaterials,
  };
}

/**
 * Find actual material name (in case it lives under textures/).
 * 
 * @param {string} mtrl Neverball material name
 * @returns {string?}
 */
function findMaterialPath(mtrl) {
  const mtrls = [
    'textures/' + mtrl,
    mtrl,
  ];

  for (const mtrlPath of mtrls) {
    const filename = getSystemFile(mtrlPath);

    if (filename) {
      return mtrlPath;
    }
  }

  return null;
}

/**
 * Find the image for a material.
 * 
 * @param {string} mtrl Neverball material name
 * @returns {string?}
 */
function findMaterialImagePath(mtrl) {
  const images = [
    'textures/' + mtrl + '.png',
    'textures/' + mtrl + '.jpg',
    mtrl + '.png',
    mtrl + '.jpg',
  ];

  for (const materialImage of images) {
    const filename = getSystemFile(materialImage);

    if (filename) {
      return materialImage;
    }
  }

  return null;
}

/**
 * Remove duplicates from an array using strict comparison.
 * 
 * @param {Array} array 
 * @returns {Array}
 */
function deduplicate(array) {
  return array.filter((item, index) => index === array.indexOf(item));
}

/**
 * Recursively find all assets that a level set requires.
 * 
 * @param {string} filename set file name
 * @returns {AssetBundle}
 */
function getAssetsRecursivelyFromSetFile(filename) {
  /** @type {AssetBundle} */
  const assets = getAssetsRecursively(getAssetsFromSetFile(filename));
  
  return assets;
}

/**
 * Check assets for existence.
 * 
 * @param {AssetBundle} assets
 * 
 * @returns {{foundAssets: Set<TypedAsset>, missingAssets: Set<TypedAsset>}}
 */
function checkAssets(assets) {
  /** @type {Set<TypedAsset>} */
  const foundAssets = new Set();

  /** @type {Set<TypedAsset>} */
  const missingAssets = new Set();

  /** @type {Set<string>} */
  let objAssets = new Set();

  for (const path of assets.imageAssets) {
    const filename = getSystemFile(path);

    if (!filename) {
      missingAssets.add({
        type: 'image',
        path,
      });
    } else {
      foundAssets.add({
        type: 'image',
        path,
      });
    }
  }

  for (const path of assets.audioAssets) {
    const filename = getSystemFile(path);

    if (!filename) {
      missingAssets.add({
        type: 'audio',
        path,
      });
    } else {
      foundAssets.add({
        type: 'audio',
        path,
      });
    }
  }

  for (const path of assets.solAssets) {
    const filename = getSystemFile(path);

    if (!filename) {
      missingAssets.add({
        type: 'sol',
        path,
      });
    } else {
      foundAssets.add({
        type: 'sol',
        path,
      });
    }

    const mapPath = path.replace(/\.sol$/, '.map');
    const mapFile = getSystemFile(mapPath);

    if (!mapFile) {
      missingAssets.add({
        type: 'map',
        path, // SOL path
      });
    } else {
      foundAssets.add({
        type: 'map',
        path: mapPath,
      });

      // Read the .map file... OBJs are anonymous in the SOL, but do exist in the map.

      const mapData = fs.readFileSync(mapFile);
      const matches = mapData.toString().matchAll(/"model" +"([^"]+)"/g);
      const mapObjs = Array.from(matches).map(match => match[1]);

      objAssets = [...objAssets, ...mapObjs];
    }
  }

  for (const path of assets.materialAssets) {
    const mtrlPath = findMaterialPath(path);

    if (!mtrlPath) {
      missingAssets.add({
        type: 'material',
        path,
      });
    } else {
      foundAssets.add({
        type: 'material',
        path,
      });
    }

    const mtrlImagePath = findMaterialImagePath(path);

    if (!mtrlImagePath) {
      missingAssets.add({
        type: 'material-image',
        path, // Material path
      })
    } else {
      foundAssets.add({
        type: 'material-image',
        path: mtrlImagePath,
      })
    }
  }

  for (const path of objAssets) {
    const filename = getSystemFile(path);

    if (!filename) {
      missingAssets.add({
        type: 'obj',
        path
      });
    } else {
      foundAssets.add({
        type: 'obj',
        path
      });
    }
  }

  return {foundAssets, missingAssets};
}

/**
 * Print assets to console.
 * 
 * @param {Set<TypedAsset>} assets 
 */
function dumpTypedAssets(assets) {
  for (const asset of assets) {
    console.log(asset.type + ':' + asset.path);
  }
}

const assets = getAssetsRecursivelyFromSetFile(setFile);

const {missingAssets} = checkAssets(assets);

if (missingAssets.size) {
  console.error('Missing assets, listing them and aborting.');
  dumpTypedAssets(missingAssets);
  process.exit(1);
} else {
  console.log(Array.from(foundAddonFilenames.values()).join('\n'));
}