'use strict';

const Solid = require('neverball-solid');

/**
 * @typedef {Object} AssetBundle
 * 
 * @property {Set<string>} imageAssets
 * @property {Set<string>} audioAssets
 * @property {Set<string>} solAssets
 * @property {Set<string>} materialAssets
 */

/**
 * @callback ReadAssetFunction
 * @param {string} path
 * @returns {Buffer?}
 * 
 * @callback AssetExistsFunction
 * @param {string} path
 * @returns {boolean}
 */

/**
 * @param {{readAsset: ReadAssetFunction, assetExists: AssetExistsFunction}} opts 
 */
module.exports = function Checker(opts) {
  const { readAsset, assetExists } = opts;

  /**
   * @param {string} path Neverball path of a set file
   * @returns AssetBundle
   */
  function getAssetsFromSetFile(path) {
    /** @type {Set<string>} */
    const imageAssets = new Set();
    /** @type {Set<string>} */
    const solAssets = new Set();

    const content = readAsset(path).toString('utf8');
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
      const content = readAsset(path);

      if (content === null) {
        throw new Error(path + ' not found');
      }

      const sol = Solid(content);

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
      // console.error(e);
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

      combinedImages = new Set([...combinedImages, ...childAssets.imageAssets]);
      combinedAudios = new Set([...combinedAudios, ...childAssets.audioAssets]);
      combinedSols = new Set([...combinedSols, ...childAssets.solAssets]);
      combinedMaterials = new Set([...combinedMaterials, ...childAssets.materialAssets]);
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
      if (assetExists(mtrlPath)) {
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
      if (assetExists(materialImage)) {
        return materialImage;
      }
    }

    return null;
  }

  /**
   * Recursively find all assets that a level set requires.
   * 
   * @param {string} path set file path
   * @returns {AssetBundle}
   */
  function getAssetsRecursivelyFromSetFile(path) {
    /** @type {AssetBundle} */
    const assets = getAssetsRecursively(getAssetsFromSetFile(path));

    return assets;
  }

  /**
   * Check assets for existence.
   * 
   * @param {AssetBundle} assets
   * 
   * @returns {{foundAssets: Set<string>, missingAssets: Set<string>}}
   */
  function checkAssets(assets) {
    /** @type {Set<string>} */
    const foundAssets = new Set();

    /** @type {Set<string>} */
    const missingAssets = new Set();

    /** @type {Set<string>} */
    let objAssets = new Set();

    for (const path of assets.imageAssets) {
      if (!assetExists(path)) {
        missingAssets.add(`image:${path}`);
      } else {
        foundAssets.add(`image:${path}`);
      }
    }

    for (const path of assets.audioAssets) {
      if (!assetExists(path)) {
        missingAssets.add(`audio:${path}`);
      } else {
        foundAssets.add(`audio:${path}`);
      }
    }

    for (const path of assets.solAssets) {
      try {
        const content = readAsset(path);

        if (content === null) {
          throw `SOL file ${path} not found`;
        }

        // Also check if we can load the SOL. This will throw an exception if not.
        const sol = Solid(content);

        foundAssets.add(`sol:${path}`);
      } catch (e) {
        missingAssets.add(`sol:${path}`);
      }

      const mapPath = path.replace(/\.sol$/, '.map');
      const mapData = readAsset(mapPath);

      if (mapData === null) {
        missingAssets.add(`map:${path}`); // SOL path
      } else {
        foundAssets.add(`map:${mapPath}`);

        // Find oBJ assets. OBJs are anonymous in the SOL, so we're parsing the .map.

        const matches = mapData.toString().matchAll(/"model" +"([^"]+)"/g);
        const mapObjs = Array.from(matches).map(match => match[1]);

        objAssets = new Set([...objAssets, ...mapObjs]);
      }
    }

    for (const path of assets.materialAssets) {
      const mtrlPath = findMaterialPath(path);

      if (!mtrlPath) {
        missingAssets.add(`material:${path}`);
      } else {
        foundAssets.add(`material:${path}`);
      }

      const mtrlImagePath = findMaterialImagePath(path);

      if (!mtrlImagePath) {
        missingAssets.add(`material-image:${path}`); // Material path
      } else {
        foundAssets.add(`material-image:${mtrlImagePath}`);
      }
    }

    for (const path of objAssets) {
      if (!assetExists(path)) {
        missingAssets.add(`obj:${path}`);
      } else {
        foundAssets.add(`obj:${path}`);
      }
    }

    return { foundAssets, missingAssets };
  }

  return {
    check: function (setFile) {
      const assets = getAssetsRecursivelyFromSetFile(setFile);

      return checkAssets(assets);
    }
  };
}