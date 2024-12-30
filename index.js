'use strict';

const Solid = require('neverball-solid');

/**
 * @typedef {Object} Asset
 * 
 * @property {string} path
 * @property {Asset} [parent]
 * @property {string} [type]
 */

/**
 * @typedef {Map<string,Asset>} AssetList
 */

/**
 * @typedef {Object} AssetBundle
 * 
 * @property {AssetList} imageAssets
 * @property {AssetList} audioAssets
 * @property {AssetList} solAssets
 * @property {AssetList} materialAssets
 */

/**
 * @callback ReadAssetFunction
 * @param {Asset} asset
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
   * Create an asset list.
   * 
   * @returns {AssetList}
   */
  function createAssetList() {
    return new Map();
  }

  /**
   * Add to asset list.
   * 
   * @param {AssetList} list asset list
   * @param {string} path Neverball path of asset
   * @param {Asset} [parent] parent asset
   * @param {string} [type] asset type
   */
  function addAssetToList(list, path, parent = null, type = null) {
    list.set(path, {
      path,
      parent,
      type,
    });
  }

  /**
   * @param {Asset} asset Neverball asset of a set file
   * @returns AssetBundle
   */
  function getAssetsFromSetFile(asset) {
    const imageAssets = createAssetList();
    const solAssets = createAssetList();

    const content = readAsset(asset).toString('utf8');
    const lines = content.split(/\r?\n/);
    const shot = lines[3] || '';
    const sols = lines.slice(5);

    if (shot) {
      addAssetToList(imageAssets, shot, asset);
    }

    for (const sol of sols) {
      if (sol) {
        addAssetToList(solAssets, sol, asset);
      }
    }

    return {
      imageAssets,
      audioAssets: createAssetList(),
      solAssets,
      materialAssets: createAssetList(),
    };
  }

  /**
   * @param {Asset} asset Neverball asset of a SOL file
   * @returns AssetBundle
   */
  function getAssetsFromSolFile(asset) {
    const imageAssets = createAssetList();
    const audioAssets = createAssetList();
    const solAssets = createAssetList();
    const materialAssets = createAssetList();

    try {
      const content = readAsset(asset);

      if (content === null) {
        throw new Error(asset.path + ' not found');
      }

      const sol = Solid(content);

      if (sol.dicts.shot) {
        addAssetToList(imageAssets, sol.dicts.shot, asset);
      }

      if (sol.dicts.song) {
        addAssetToList(audioAssets, sol.dicts.song, asset);
      }

      if (sol.dicts.grad) {
        addAssetToList(imageAssets, sol.dicts.grad, asset);
      }

      if (sol.dicts.back) {
        addAssetToList(solAssets, sol.dicts.back, asset);
      }

      for (const mtrl of sol.mtrls) {
        if (!(mtrl.f === 'NULL' || mtrl.f === 'default')) {
          addAssetToList(materialAssets, mtrl.f, asset);
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
    let combinedImages = mainAssets.imageAssets || createAssetList();
    let combinedAudios = mainAssets.audioAssets || createAssetList();
    let combinedSols = mainAssets.solAssets || createAssetList();
    let combinedMaterials = mainAssets.materialAssets || createAssetList();

    for (const [_, asset] of mainAssets.solAssets) {
      const childAssets = getAssetsRecursively(getAssetsFromSolFile(asset));

      combinedImages = new Map([...combinedImages, ...childAssets.imageAssets]);
      combinedAudios = new Map([...combinedAudios, ...childAssets.audioAssets]);
      combinedSols = new Map([...combinedSols, ...childAssets.solAssets]);
      combinedMaterials = new Map([...combinedMaterials, ...childAssets.materialAssets]);
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
   * @param {Asset} asset set file asset
   * @returns {AssetBundle}
   */
  function getAssetsRecursivelyFromSetFile(asset) {
    /** @type {AssetBundle} */
    const assets = getAssetsRecursively(getAssetsFromSetFile(asset));

    return assets;
  }

  /**
   * Check assets for existence.
   * 
   * @param {AssetBundle} assets
   * 
   * @returns {{foundAssets: Set<string>, missingAssets: AssetList}}
   */
  function checkAssets(assets) {
    /** @type {Set<string>} */
    const foundAssets = new Set();

    const missingAssets = createAssetList();

    let objAssets = createAssetList();

    for (const [_, asset] of assets.imageAssets) {
      if (!assetExists(asset.path)) {
        addAssetToList(missingAssets, asset.path, asset.parent, 'image');
      } else {
        foundAssets.add(`image:${asset.path}`);
      }
    }

    for (const [_, asset] of assets.audioAssets) {
      if (!assetExists(asset.path)) {
        addAssetToList(missingAssets, asset.path, asset.parent, 'audio');
      } else {
        foundAssets.add(`audio:${asset.path}`);
      }
    }

    for (const [_, asset] of assets.solAssets) {
      try {
        const content = readAsset(asset);

        if (content === null) {
          throw `SOL file ${asset.path} not found`;
        }

        // Also check if we can load the SOL. This will throw an exception if not.
        const sol = Solid(content);

        foundAssets.add(`sol:${asset.path}`);
      } catch (e) {
        addAssetToList(missingAssets, asset.path, asset.parent, 'sol');
      }

      const mapPath = asset.path.replace(/\.sol$/, '.map');
      /** @type {Asset} */
      const mapAsset = {
        path: mapPath,
      };
      const mapData = readAsset({ path: mapPath });

      if (mapData === null) {
        addAssetToList(missingAssets, asset.path, asset.parent, 'map'); // SOL path
      } else {
        foundAssets.add(`map:${mapPath}`);

        // Find oBJ assets. OBJs are anonymous in the SOL, so we're parsing the .map.

        const matches = mapData.toString().matchAll(/"model" +"([^"]+)"/g);
        const mapObjs = new Map(
          Array.from(matches).map(match => [
            match[1], 
            {
              path: match[1],
              parent: mapAsset
            }
          ])
        );

        objAssets = new Map([...objAssets, ...mapObjs]);
      }
    }

    for (const [_, asset] of assets.materialAssets) {
      const mtrlPath = findMaterialPath(asset.path);

      if (!mtrlPath) {
        addAssetToList(missingAssets, asset.path, asset.parent, 'material');
      } else {
        foundAssets.add(`material:${asset.path}`);
      }

      const mtrlImagePath = findMaterialImagePath(asset.path);

      if (!mtrlImagePath) {
        addAssetToList(missingAssets, asset.path, asset.parent, 'material-image'); // Material path
      } else {
        foundAssets.add(`material-image:${mtrlImagePath}`);
      }
    }

    for (const [_, asset] of objAssets) {
      if (!assetExists(asset.path)) {
        addAssetToList(missingAssets, asset.path, asset.parent, 'obj');
      } else {
        foundAssets.add(`obj:${asset.path}`);
      }
    }

    return { foundAssets, missingAssets };
  }

  return {
    check: function (setFile) {
      const assets = getAssetsRecursivelyFromSetFile({
        path: setFile,
      });

      return checkAssets(assets);
    }
  };
}