#!/usr/bin/env node

'use strict';

const process = require('node:process');
const path = require('node:path');
const fs = require('node:fs');
const archiver = require('archiver');

const Checker = require('.');

if (process.argv.length < 4) {
    console.error('Usage: %s neverball-data set-file.txt [--zip]', process.argv[1]);
    process.exit(1);
}

/** @type {string} Path to Neverball data (argument) */
const baseDir = process.argv[2];

/** @type {string} Path to set file (argument) */
const setFile = path.basename(process.argv[3]);

/** @type {string} Path to addon data directory, derived from {@link setFile} */
const addonDir = path.dirname(process.argv[3]);

/** @type {boolean} Create a zip file. */
const createZip = (process.argv.length > 4 && process.argv[4] === '--zip');

if (!fs.existsSync(baseDir)) {
    console.error('Base directory does not exist.');
    process.exit(1);
}

if (!fs.existsSync(addonDir + '/' + setFile)) {
    console.error('Set file does not exist.');
    process.exit(1);
}

/** @type {Map<string,string>} */
const foundAddonFilenames = new Map();

/** @type {Map<string,string>} */
const foundBaseFilenames = new Map();

/** @type {Set<string>} */
const foundBaseOverrides = new Set();

// HACK: include the set file itself.
foundAddonFilenames.set(setFile, addonDir + '/' + setFile);

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

        if (fs.existsSync(basePath)) {
            foundBaseOverrides.add(addonPath);
        }

        return addonPath;
    } else if (fs.existsSync(basePath)) {
        foundBaseFilenames.set(path, basePath);
        return basePath;
    }

    return null;
}

/**
 * Read contents of a Neverball path.
 * 
 * @param {import('.').Asset} asset Neverball asset
 * @returns {Buffer?}
 */
function readAsset(asset) {
    const filename = getSystemFile(asset.path);

    try {
        return fs.readFileSync(filename);
    } catch (e) {
        return null;
    }
}

/**
 * Check asset existence.
 * 
 * @param {string} path Neverball path
 * @returns {boolean}
 */
function assetExists(path) {
    return getSystemFile(path) !== null;
}

const checker = Checker({
    readAsset,
    assetExists,
});

const { missingAssets } = checker.check(setFile);

if (missingAssets.size) {
    for (const [_, asset] of missingAssets) {
        console.log('not-found:' + asset.type + ':' + asset.path + ':' + (asset.parent ? asset.parent.path : '_'));
    }
    process.exit(1);
} else {
    let archive = null;

    if (createZip) {
        archive = archiver('zip', {
            zlib: {
                level: 9,
            }
        });

        const archivePath = path.basename(setFile, '.txt') + '.zip';
        const archiveStream = fs.createWriteStream(archivePath);

        archive.pipe(archiveStream);
    }

    for (const filename of foundAddonFilenames.values()) {
        if (!foundBaseOverrides.has(filename)) {
            console.log(filename);

            if (archive) {
                const compatFilename = filename.replace(/^\.\//, '');

                archive.file(addonDir + '/' + compatFilename, {
                    name: compatFilename,
                });
            }
        }
    }

    if (archive) {
        archive.finalize();
    }
}