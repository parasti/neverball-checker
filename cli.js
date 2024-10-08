#!/usr/bin/env node

'use strict';

const process = require('node:process');
const path = require('node:path');
const fs = require('node:fs');

const Checker = require('.');

if (process.argv.length < 4) {
    console.error('Usage: %s neverball-data set-file.txt', process.argv[1]);
    process.exit(1);
}

/** @type {string} Path to Neverball data (argument) */
const baseDir = process.argv[2];

/** @type {string} Path to set file (argument) */
const setFile = path.basename(process.argv[3]);

/** @type {string} Path to addon data directory, derived from {@link setFile} */
const addonDir = path.dirname(process.argv[3]);

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
 * @param {string} path Neverball path
 * @returns {Buffer?}
 */
function readAsset(path) {
    const filename = getSystemFile(path);

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
    for (const asset of missingAssets) {
        console.log('not-found:' + asset);
    }
    process.exit(1);
} else {
    console.log(Array.from(foundAddonFilenames.values()).join('\n'));
}