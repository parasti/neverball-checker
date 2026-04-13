#!/usr/bin/env node

'use strict';

const process = require('node:process');
const path = require('node:path');
const fs = require('node:fs');
const archiver = require('archiver');

const check = require('.');
const { checkAddon, buildDeps, parseSol, parseSetFile, parseMap, materialPaths, materialImagePaths } = check;

if (process.argv.length < 3) {
    console.error('Usage: %s neverball-data set-file.txt [--zip]', process.argv[1]);
    console.error('       %s neverball-data --dump-deps', process.argv[1]);
    console.error('       %s neverball-assets.json addon-dir/ [--zip]', process.argv[1]);
    process.exit(1);
}

/**
 * Recursively yield [relPath, fullPath] for every file under dir.
 *
 * @param {string} dir Absolute directory path
 * @param {string} [prefix] Neverball-relative prefix accumulated so far
 * @yields {[string, string]}
 */
function* walkDir(dir, prefix = '') {
    let entries;
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (e) {
        return;
    }
    for (const entry of entries) {
        const relPath = prefix ? prefix + '/' + entry.name : entry.name;
        const fullPath = dir + '/' + entry.name;
        if (entry.isDirectory()) {
            yield* walkDir(fullPath, relPath);
        } else {
            yield [relPath, fullPath];
        }
    }
}

async function buildZip(slug, addonFileMap, stockFileSet, foundAssets) {
    const zipPath = path.join(process.cwd(), 'set-' + slug + '.zip');

    const referencedPaths = new Set(['set-' + slug + '.txt']);
    for (const entry of foundAssets) {
        referencedPaths.add(entry.slice(entry.indexOf(':') + 1));
    }

    return new Promise((resolve, reject) => {
        const archive = archiver('zip', { zlib: { level: 9 } });
        const stream = fs.createWriteStream(zipPath);

        archive.on('error', reject);
        stream.on('close', () => resolve(zipPath));
        archive.pipe(stream);

        for (const filePath of referencedPaths) {
            if (!addonFileMap.has(filePath) || stockFileSet.has(filePath)) continue;
            archive.file(addonFileMap.get(filePath), { name: filePath });
        }

        archive.finalize();
    });
}

// ---- manifest mode: neverball-assets.json addon-dir/ [--zip] ----

if (process.argv[2].endsWith('.json')) {
    const assetsJsonPath = process.argv[2];
    const addonDir       = process.argv[3];
    const createZip      = process.argv[4] === '--zip';

    if (!addonDir) {
        console.error('Usage: %s neverball-assets.json addon-dir/ [--zip]', process.argv[1]);
        process.exit(1);
    }

    if (!fs.existsSync(addonDir)) {
        console.error('Addon directory does not exist.');
        process.exit(1);
    }

    const stockAssets = JSON.parse(fs.readFileSync(assetsJsonPath, 'utf8'));

    const addonFileMap = new Map();
    for (const [relPath, fullPath] of walkDir(addonDir)) {
        addonFileMap.set(relPath, fullPath);
    }

    const readFile = p => {
        const full = addonFileMap.get(p);
        if (full) {
            try { return fs.readFileSync(full); } catch { return null; }
        }
        return null;
    };

    const { sets } = checkAddon(stockAssets, [...addonFileMap.keys()], readFile);

    if (sets.length === 0) {
        console.error('No set-*.txt files found at addon root.');
        process.exit(1);
    }

    (async () => {
        let failed = false;
        const stockFileSet = new Set(stockAssets.files);

        for (const { slug, missingAssets, foundAssets } of sets) {
            if (missingAssets.size > 0) {
                for (const asset of missingAssets.values()) {
                    console.error('not-found:' + asset.type + ':' + asset.path + ':' + (asset.parent?.path ?? '_'));
                }
                failed = true;
                continue;
            }

            if (createZip) {
                const zipPath = await buildZip(slug, addonFileMap, stockFileSet, foundAssets);
                console.log('built:' + zipPath);
            } else {
                const referencedPaths = new Set(['set-' + slug + '.txt']);
                for (const entry of foundAssets) {
                    referencedPaths.add(entry.slice(entry.indexOf(':') + 1));
                }
                for (const filePath of referencedPaths) {
                    if (!addonFileMap.has(filePath) || stockFileSet.has(filePath)) continue;
                    console.log(addonFileMap.get(filePath));
                }
            }
        }

        process.exit(failed ? 1 : 0);
    })();

    return;
}

// ---- base-dir modes: neverball-data ... ----

const baseDir = process.argv[2];

if (!fs.existsSync(baseDir)) {
    console.error('Base directory does not exist.');
    process.exit(1);
}

// ---- dump-deps mode ----

if (process.argv[3] === '--dump-deps') {
    /** @param {string} p Neverball path */
    function baseExists(p) {
        return fs.existsSync(baseDir + '/' + p);
    }

    const files = [];

    /** @type {Object.<string, {images:string[],audio:string[],sols:string[],sets:string[],materials:string[],materialImages:string[],objs:string[]}>} */
    const deps = {};

    for (const [relPath, fullPath] of walkDir(baseDir)) {
        files.push(relPath);

        if (relPath.endsWith('.sol')) {
            const buf = fs.readFileSync(fullPath);
            const { images, audio, sols, materials } = parseSol(relPath, buf);

            const mapPath = relPath.replace(/\.sol$/, '.map');
            let objs = [];
            try {
                objs = parseMap(mapPath, fs.readFileSync(baseDir + '/' + mapPath));
            } catch (e) {
                // no sibling .map
            }

            // Resolved material images are image deps — merge them in.
            const materialImages = materials
                .map(m => materialImagePaths(m).find(baseExists))
                .filter(Boolean);

            deps[relPath] = {
                images: [...images, ...materialImages],
                audio,
                sols,
                sets: [],
                materials,
                objs,
            };
        } else if (relPath.endsWith('.txt')) {
            const content = fs.readFileSync(fullPath, 'utf8');
            const { images, sols, sets } = parseSetFile(relPath, content);
            // Skip files with no parseable deps (e.g. ball.txt, readmes).
            if (images.length > 0 || sols.length > 0 || sets.length > 0) {
                deps[relPath] = { images, audio: [], sols, sets, materials: [], objs: [] };
            }
        }
    }

    console.log(JSON.stringify({ files, deps }, null, 2));
    process.exit(0);
}

// ---- check mode ----

if (process.argv.length < 4) {
    console.error('Usage: %s neverball-data set-file.txt [--zip]', process.argv[1]);
    process.exit(1);
}

/** @type {string} Path to set file (argument) */
const setFile = path.basename(process.argv[3]);

/** @type {string} Path to addon data directory, derived from set file path */
const addonDir = path.dirname(process.argv[3]);

/** @type {boolean} Create a zip file */
const createZip = (process.argv.length > 4 && process.argv[4] === '--zip');

if (!fs.existsSync(addonDir + '/' + setFile)) {
    console.error('Set file does not exist.');
    process.exit(1);
}

// Pass 1: build deps by reading files from addon (preferred) or base.

function readFile(p) {
    const addonPath = addonDir + '/' + p;
    const basePath = baseDir + '/' + p;
    try {
        if (fs.existsSync(addonPath)) return fs.readFileSync(addonPath);
        if (fs.existsSync(basePath)) return fs.readFileSync(basePath);
    } catch (e) {}
    return null;
}

const { deps } = buildDeps(setFile, { readFile });

// Build file sets for existence checks and zip filtering.

const addonFileMap = new Map(); // relPath → fullPath
for (const [relPath, fullPath] of walkDir(addonDir)) {
    addonFileMap.set(relPath, fullPath);
}

const baseFileSet = new Set();
for (const [relPath] of walkDir(baseDir)) {
    baseFileSet.add(relPath);
}

const allFiles = new Set([...addonFileMap.keys(), ...baseFileSet]);

// Pass 2: pure check.

const { missingAssets, foundAssets } = check(setFile, { deps, files: allFiles });

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

    // Collect all referenced file paths from foundAssets, plus the set file itself.
    // foundAssets entries are "type:path" — strip the prefix to get the file path.
    const referencedPaths = new Set([setFile]);
    for (const entry of foundAssets) {
        referencedPaths.add(entry.slice(entry.indexOf(':') + 1));
    }

    // Output addon-only files: referenced, in addon, not already in base.
    for (const filePath of referencedPaths) {
        if (!addonFileMap.has(filePath) || baseFileSet.has(filePath)) continue;

        const fullPath = addonFileMap.get(filePath);
        console.log(fullPath);

        if (archive) {
            archive.file(fullPath, { name: filePath });
        }
    }

    if (archive) {
        archive.finalize();
    }
}
