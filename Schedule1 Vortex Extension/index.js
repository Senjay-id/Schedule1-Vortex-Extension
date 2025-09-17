const path = require('path');
const { fs, log, selectors, util, actions } = require('vortex-api');
const { axios, download, findModByFile, findDownloadIdByFile } = require('./downloader');

const STEAMAPP_ID = '3164500';
const GAME_ID = 'schedule1';
const BEPINEX_LINK = `https://api.github.com/repos/BepInEx/BepInEx/releases/latest`;
const MELONLOADER_LINK = `https://api.github.com/repos/LavaGang/MelonLoader/releases/latest`;

const BEPINEX_RELPATH = 'bepinex';
const BEPINEX_PATCHERS_RELPATH = path.join(BEPINEX_RELPATH, 'patchers');
const BEPINEX_PLUGINS_RELPATH = path.join(BEPINEX_RELPATH, 'plugins');
const BEPINEX_CONFIG_RELPATH = path.join(BEPINEX_RELPATH, 'config');

const MELONLOADER_RELPATH = 'MelonLoader';
const MELONLOADER_PLUGINS_RELPATH = path.join('plugins');
const MELONLOADER_MODS_RELPATH = path.join('mods');
const MELONLOADER_CONFIG_RELPATH = path.join('userdata');

const LUA_SCRIPT_RELPATH = path.join('mods', 'schedulelua', 'scripts');

function main(context) {
    context.registerGame({
        id: GAME_ID,
        name: 'Schedule 1',
        mergeMods: true,
        queryPath: findGame,
        supportedTools: [],
        queryModPath: () => '',
        logo: 'gameart.png',
        executable: () => 'Schedule I.exe',
        requiredFiles: [
            'Schedule I.exe',
        ],
        setup: (discovery) => prepareForModding(context.api, discovery),
        environment: {
            SteamAPPId: STEAMAPP_ID,
        },
        details: {
            steamAppId: STEAMAPP_ID,
        },
    });

    context.registerInstaller('schedule1-luamod', 25, testSupportedScheduleLuaContent, installScheduleLuaMod(context.api));
    context.registerInstaller('schedule1-luamod', 25, testSupportedLuaContent, installLuaMod(context.api));
    context.registerInstaller('schedule1-s1apimod', 25, testSupportedS1APIContent, installS1APIMod(context.api));
    context.registerInstaller('schedule1-pluginmod', 26, testSupportedPluginContent, installPluginMods(context.api));

    return true;
}

async function testSupportedLuaContent(files, gameId) {
    if (gameId !== GAME_ID) {
        return Promise.resolve({ supported: false, requiredFiles: [] });
    }

    const hasLuaFile = files.some(file =>
        path.extname(file).toLowerCase() === '.lua'
    );

    return Promise.resolve({
        supported: hasLuaFile,
        requiredFiles: [],
    });
}

async function testSupportedS1APIContent(files, gameId) {
    if (gameId !== GAME_ID) {
        return Promise.resolve({ supported: false, requiredFiles: [] });
    }

    const hasScheduleLuaDll = files.some(file =>
        path.basename(file).toLowerCase() === 's1apiloader.dll'
    );

    return Promise.resolve({
        supported: hasScheduleLuaDll,
        requiredFiles: [],
    });
}

async function testSupportedScheduleLuaContent(files, gameId) {
    if (gameId !== GAME_ID) {
        return Promise.resolve({ supported: false, requiredFiles: [] });
    }

    const hasScheduleLuaDll = files.some(file =>
        path.basename(file).toLowerCase() === 'schedulelua.dll'
    );

    return Promise.resolve({
        supported: hasScheduleLuaDll,
        requiredFiles: [],
    });
}

async function testSupportedPluginContent(files, gameId) {
    if (gameId !== GAME_ID) {
        return Promise.resolve({ supported: false, requiredFiles: [] });
    }

    const hasDll = files.some(file => path.extname(file).toLowerCase() === '.dll');
    const hasLoaderDll = files.some(file =>
        file.toLowerCase().includes('bepinex.dll') ||
        file.toLowerCase().includes('melonloader.dll')
    );

    return Promise.resolve({
        supported: hasDll && !hasLoaderDll,
        requiredFiles: [],
    });
}

/**
 * Helper: canonicalize destination to expected root + original subpath.
 * Example: if archive has "Mods/MyMod.dll" and idx points to "mods" element,
 * buildDest('mods', ['Mods','MyMod.dll'], idx) => 'mods/MyMod.dll'
 */
function buildDest(root, segments, idx) {
    // idx is index of the matched root in segments (lowerSegments index)
    // we want canonical root + rest of segments after idx
    const rest = segments.slice(idx + 1);
    if (rest.length === 0) {
        return path.join(root);
    }
    return path.join(root, ...rest);
}

function installS1APIMod(api) {
    return async (files, workingDir, gameId, progressDel, choices, unattended, archivePath) => {
        const instructions = [];

        for (const iter of files) {
            try {
                const full = path.join(workingDir, iter);
                const stats = await fs.statAsync(full);
                if (stats.isDirectory()) {
                    continue; // Skip directories
                }

                const segments = iter.split(path.sep);
                const lowerSegments = segments.map(seg => seg.toLowerCase());
                const pluginsIdx = lowerSegments.indexOf('plugins');

                if (pluginsIdx === -1) { // skip the file if the path doesn't have plugins
                    continue;
                }

                const destination = buildDest('plugins', segments, pluginsIdx);

                instructions.push({
                    type: 'copy',
                    source: iter,
                    destination: destination,
                });
            } catch (e) {
                api.sendNotification({
                    id: 'schedule1-staterror',
                    type: 'error',
                    message: 'Error while reading stats for the mod file',
                    allowSuppress: true,
                    actions: [
                        {
                            title: 'More',
                            action: dismiss => {
                                api.showDialog('error', 'Error while reading stats for the mod file', {
                                    bbcode: api.translate(`An error has occurred while reading stats for mod file:\n${iter}\n `
                                        + `Error:\n${e}\n\nPlease report this to the extension developer.`)
                                }, [
                                    { label: 'Close', action: () => api.suppressNotification('schedule1-staterror') }
                                ]);
                            },
                        },
                    ],
                });
            }
        }
        return { instructions };
    };
}

function installLuaMod(api) {
    return async (files, workingDir, gameId, progressDel, choices, unattended, archivePath) => {
        const instructions = [];

        for (const iter of files) {
            try {
                const full = path.join(workingDir, iter);
                const stats = await fs.statAsync(full);
                if (stats.isDirectory()) {
                    continue; // Skip directories
                }

                const isLuaFile = path.extname(iter).toLowerCase() === '.lua';
                if (!isLuaFile) {
                    continue;
                }

                const filename = path.basename(iter);
                instructions.push({
                    type: 'copy',
                    source: iter,
                    destination: path.join(LUA_SCRIPT_RELPATH, filename),
                });
            } catch (e) {
                api.sendNotification({
                    id: 'schedule1-staterror',
                    type: 'error',
                    message: 'Error while reading stats for the mod file',
                    allowSuppress: true,
                    actions: [
                        {
                            title: 'More',
                            action: dismiss => {
                                api.showDialog('error', 'Error while reading stats for the mod file', {
                                    bbcode: api.translate(`An error has occurred while reading stats for mod file:\n${iter}\n `
                                        + `Error:\n${e}\n\nPlease report this to the extension developer.`)
                                }, [
                                    { label: 'Close', action: () => api.suppressNotification('schedule1-staterror') }
                                ]);
                            },
                        },
                    ],
                });
            }
        }
        return { instructions };
    };
}

function installScheduleLuaMod(api) {
    return async (files, workingDir, gameId, progressDel, choices, unattended, archivePath) => {
        const instructions = [];

        for (const iter of files) {
            try {
                const full = path.join(workingDir, iter);
                const stats = await fs.statAsync(full);
                if (stats.isDirectory()) {
                    continue; // Skip directories
                }

                const segments = iter.split(path.sep);
                const lowerSegments = segments.map(seg => seg.toLowerCase());
                const modsIdx = lowerSegments.indexOf('mods');
                const userlibsIdx = lowerSegments.indexOf('userlibs');

                // Skip if the file is in the root (no 'mods' or 'userlibs' in path)
                if (modsIdx === -1 && userlibsIdx === -1) {
                    continue;
                }

                let destination;
                if (modsIdx !== -1) {
                    // Force canonical 'mods' root (lowercase) + rest of the path
                    destination = buildDest('mods', segments, modsIdx);
                } else {
                    // userlibs -> map to 'userdata' (canonical for melon's userdata folder)
                    destination = buildDest('userdata', segments, userlibsIdx);
                }

                instructions.push({
                    type: 'copy',
                    source: iter,
                    destination: destination,
                });
            } catch (e) {
                api.sendNotification({
                    id: 'schedule1-staterror',
                    type: 'error',
                    message: 'Error while reading stats for the mod file',
                    allowSuppress: true,
                    actions: [
                        {
                            title: 'More',
                            action: dismiss => {
                                api.showDialog('error', 'Error while reading stats for the mod file', {
                                    bbcode: api.translate(`An error has occurred while reading stats for mod file:\n${iter}\n `
                                        + `Error:\n${e}\n\nPlease report this to the extension developer.`)
                                }, [
                                    { label: 'Close', action: () => api.suppressNotification('schedule1-staterror') }
                                ]);
                            },
                        },
                    ],
                });
            }
        }
        return { instructions };
    };
}

function installPluginMods(api) {
    return async (files, workingDir, gameId, progressDel, choices, unattended, archivePath) => {
        let destination = "";
        let isBepInEx = false;
        let isBepInExPatcher = false;
        let isMelonLoader = false;
        let isMelonLoaderPlugins = false;
        const variantSet = new Set();
        const state = api.getState();
        const discovery = selectors.discoveryByGame(state, GAME_ID);

        // First pass: detect plugin types by reading DLL contents (same as before)
        await Promise.all(files.map(async file => {
            if (path.extname(file).toLowerCase() === '.dll') {
                try {
                    const content = await fs.readFileAsync(path.join(workingDir, file), 'utf8');
                    if (content.includes('BepInEx')) {
                        isBepInEx = true;
                        isBepInExPatcher = !content.includes('BaseUnityPlugin');
                    } else if (content.includes('MelonLoader')) {
                        isMelonLoader = true;
                        isMelonLoaderPlugins = content.includes('MelonPlugin');
                    }
                } catch (err) {
                    api.showErrorNotification('Failed to read mod file', err);
                }
            }
        }));

        // Check if the user has bepinex installed
        if (isBepInEx) {
            try {
                await fs.statAsync(path.join(discovery.path, BEPINEX_RELPATH, 'core', 'BepInEx.dll'));
            } catch (err) {
                const missingBepinex = await api.showDialog('info', 'Trying to install a bepinex plugin', {
                    bbcode: api.translate('Vortex has detected that you are trying to install a bepinex plugin without having BepInEx installed.[br][/br][br][/br]'
                        + `Would you like to install BepInEx?`),
                    options: { order: ['bbcode'], wrap: true },
                }, [
                    { label: 'Yes' },
                    { label: 'No' }
                ]);
                if (missingBepinex.action === 'Yes') {
                    await importBepinex(api);
                }
            }
        }

        // Check if the user has melonloader installed
        if (isMelonLoader) {
            try {
                await fs.statAsync(path.join(discovery.path, 'MelonLoader', 'net6', 'MelonLoader.dll'));
            } catch (err) {
                const missingMelonLoader = await api.showDialog('info', 'Trying to install a MelonLoader plugin', {
                    bbcode: api.translate('Vortex has detected that you are trying to install a MelonLoader plugin without having MelonLoader installed.[br][/br][br][/br]'
                        + 'Would you like to install MelonLoader?[br][/br][br][/br]'
                        + '[b]Requirements[/b][br][/br]'
                        + 'In order to run MelonLoader you must install:[br][/br]'
                        + '• [url=https://aka.ms/vs/16/release/vc_redist.x64.exe]Microsoft Visual C++ 2015-2019 Redistributable 64 Bit[/url] for 64 bit games.[br][/br]'
                        + '• [url=https://aka.ms/vs/16/release/vc_redist.x86.exe]Microsoft Visual C++ 2015-2019 Redistributable 32 Bit[/url] for 32 bit games.[br][/br][br][/br]'
                        + '• Il2Cpp games require [url=https://dotnet.microsoft.com/en-us/download/dotnet/6.0#runtime-desktop-6.0.19]dotnet 6.0[/url]. We recommend the .NET Desktop Runtime, x64 or x86 depending on if your game is 64 bit or 32 bit'),
                    options: { order: ['bbcode'], wrap: true },
                }, [
                    { label: 'Yes' },
                    { label: 'No' }
                ]);
                if (missingMelonLoader.action === 'Yes') {
                    await importMelonLoader(api);
                }
            }
        }

        // If both detected, bail out (same behavior you had)
        if (isBepInEx && isMelonLoader) {
            const mixedModHandling = await api.showDialog('error', 'Mixed mod detected', {
                bbcode: api.translate('Vortex has detected that the mod package has bepinex and melonloader mod on the archive.[br][/br][br][/br]'
                    + `Mixed mods are not supported by the game extension and the mod author will need to repackage their mod.`),
                options: { order: ['bbcode'], wrap: true },
            }, [
                { label: 'Ok' }
            ]);
            if (mixedModHandling.action === 'Ok') {
                throw new util.UserCanceled();
            }
        }

        // Second pass: build instructions with case-insensitive detection and canonical destinations
        const instructions = [];
        for (const iter of files) {
            try {
                const full = path.join(workingDir, iter);
                const stats = await fs.statAsync(full);
                if (stats.isDirectory()) {
                    continue;
                }

                const ext = path.extname(iter).toLowerCase();
                const segments = iter.split(path.sep);
                const lowerSegments = segments.map(seg => seg.toLowerCase());

                const bepinexIdx = lowerSegments.indexOf('bepinex');
                const bepinexConfigIdx = lowerSegments.indexOf('config');
                const bepinexPluginsIdx = lowerSegments.indexOf('plugins');
                const bepinexPatchersIdx = lowerSegments.indexOf('patchers');
                const melonloaderIdx = lowerSegments.indexOf('melonloader');
                const melonloaderUserLibsIdx = lowerSegments.indexOf('userlibs');
                const melonloaderConfigIdx = lowerSegments.indexOf('userdata');
                const pluginsIdx = lowerSegments.indexOf('plugins');
                const modsIdx = lowerSegments.indexOf('mods');

                // Variant detection: record the prefix before the variant root (as before)
                if (bepinexIdx !== -1) {
                    variantSet.add(segments.slice(0, bepinexIdx).join(path.sep));
                }
                if (melonloaderIdx !== -1) {
                    variantSet.add(segments.slice(0, melonloaderIdx).join(path.sep));
                }

                // Priority mapping:
                let dest = null;

                // Explicit bepinex plugin/patcher/config cases first
                if (bepinexPluginsIdx !== -1) {
                    dest = path.join(BEPINEX_RELPATH, 'plugins', ...segments.slice(bepinexPluginsIdx + 1));
                } else if (bepinexPatchersIdx !== -1) {
                    dest = path.join(BEPINEX_RELPATH, 'patchers', ...segments.slice(bepinexPatchersIdx + 1));
                } else if (bepinexConfigIdx !== -1 && bepinexIdx !== -1 && bepinexConfigIdx > bepinexIdx) {
                    // e.g. .../BepInEx/config/...
                    dest = path.join(BEPINEX_RELPATH, 'config', ...segments.slice(bepinexConfigIdx + 1));
                } else if (bepinexIdx !== -1) {
                    // any other file under a BepInEx root
                    dest = path.join(BEPINEX_RELPATH, ...segments.slice(bepinexIdx + 1));
                }
                // MelonLoader specific
                else if (melonloaderUserLibsIdx !== -1) {
                    // If archive contains 'userlibs', put under MelonLoader/<rest>
                    dest = path.join(MELONLOADER_RELPATH, ...segments.slice(melonloaderUserLibsIdx + 1));
                } else if (melonloaderConfigIdx !== -1) {
                    // userdata -> canonical userdata folder
                    dest = path.join(MELONLOADER_CONFIG_RELPATH, ...segments.slice(melonloaderConfigIdx + 1));
                } else if (melonloaderIdx !== -1) {
                    dest = path.join(MELONLOADER_RELPATH, ...segments.slice(melonloaderIdx + 1));
                }
                // Generic plugins/mods detection (non-bepinex/melonloader)
                else if (pluginsIdx !== -1) {
                    dest = buildDest('plugins', segments, pluginsIdx);
                } else if (modsIdx !== -1) {
                    dest = buildDest('mods', segments, modsIdx);
                }

                // If still no dest, handle DLLs specially based on detected loader
                if (!dest && ext === '.dll') {
                    if (isBepInEx) {
                        // put in bepinex plugins/patchers depending on detection
                        if (isBepInExPatcher) {
                            // keep last two path parts if present (folder + dll)
                            const dllSegments = segments.slice(-2);
                            dest = path.join(BEPINEX_PATCHERS_RELPATH, ...dllSegments);
                        } else {
                            const dllSegments = segments.slice(-2);
                            dest = path.join(BEPINEX_PLUGINS_RELPATH, ...dllSegments);
                        }
                    } else if (isMelonLoader) {
                        // melon's detection: either plugins or mods
                        if (isMelonLoaderPlugins) {
                            dest = path.join(MELONLOADER_PLUGINS_RELPATH, path.basename(iter));
                        } else {
                            dest = path.join(MELONLOADER_MODS_RELPATH, path.basename(iter));
                        }
                    } else {
                        // Default fallback for dll: put into mods/
                        dest = path.join('mods', path.basename(iter));
                    }
                }

                // Non-dll "other" files: try to place under appropriate mod folder for loader
                if (!dest && (!ext || ext === '')) {
                    if (isMelonLoader) {
                        dest = path.join(MELONLOADER_MODS_RELPATH, ...segments.slice(1));
                    } else if (isBepInEx) {
                        dest = path.join(BEPINEX_PLUGINS_RELPATH, ...segments.slice(1));
                    }
                }

                // Generic non-md files: place under mods/plugins depending on loader
                if (!dest && ext !== '.md') {
                    if (isMelonLoader) {
                        dest = path.join(MELONLOADER_MODS_RELPATH, ...segments.slice(1));
                    } else if (isBepInEx) {
                        dest = path.join(BEPINEX_PLUGINS_RELPATH, ...segments.slice(1));
                    }
                }

                // If we still don't have a destination, skip (this was your original behavior)
                if (!dest) {
                    continue;
                }

                // push the copy instruction
                instructions.push({
                    type: 'copy',
                    source: iter,
                    destination: dest,
                });
            } catch (e) {
                api.sendNotification({
                    id: 'schedule1-staterror',
                    type: 'error',
                    message: 'Error while reading stats for the mod file',
                    allowSuppress: true,
                    actions: [
                        {
                            title: 'More',
                            action: dismiss => {
                                api.showDialog('error', 'Error while reading stats for the mod file', {
                                    bbcode: api.translate(`An error has occurred while reading stats for mod file:\n${iter}\n `
                                        + `Error:\n${e}\n\nPlease report this to the extension developer.`)
                                }, [
                                    { label: 'Close', action: () => api.suppressNotification('schedule1-staterror') }
                                ]);
                            },
                        },
                    ],
                });
            }
        }

        if (variantSet.size > 1) {
            const variantModHandling = await api.showDialog('error', 'Variant mod detected', {
                bbcode: api.translate('The author of the mod has packaged the mod files in such a way that users need to specifically choose which variant of the mods to install.[br][/br][br][/br]'
                    + `Variant mods are not supported by the game extension, and the mod author will need to repackage their mod.`),
                options: { order: ['bbcode'], wrap: true },
            }, [
                { label: 'Ok' },
                { label: 'Ignore' },
            ]);

            if (variantModHandling.action === 'Ok') {
                throw new util.UserCanceled();
            }

            api.sendNotification({
                type: 'warning',
                message: 'Variant mod detected.\n\nThe author of the mod has packaged the mod files in such a way that users need to specifically choose which variant of the mods to install.\n\nThe installed mod may not work as expected.',
            });
        }
        return { instructions };
    };
}

/*
async function modloaderRequirement(api, discovery) {

    try {
        
    } catch (err) {


    }

}
*/

async function importBepinex(api) {
    api.sendNotification({
        id: `schedule1-installingbepinex`,
        message: 'Downloading BepInEx',
        type: 'activity',
        noDismiss: true,
        allowSuppress: false,
    });
    try {
        const response = await axios.get(BEPINEX_LINK);
        if (response.status === 200) {
            const release = response.data;
            if (release.assets.length > 0) {
                const chosenAsset = release.assets.find(asset => asset.name.includes('BepInEx_win_x64'));
                const assetName = chosenAsset.name;
                const assetUrl = chosenAsset.browser_download_url;
                const modVersion = release.tag_name;

                const tempPath = path.join(util.getVortexPath('temp'), assetName);
                const Response = await axios({
                    method: 'get',
                    url: assetUrl,
                    responseType: 'arraybuffer',
                    headers: {
                        "Accept-Encoding": "gzip, deflate",
                        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/107.0.0.0 Safari/537.36"
                    },
                });

                await fs.writeFileAsync(tempPath, Buffer.from(Response.data));
                api.dismissNotification(`schedule1-installingbepinex`);

                api.events.emit('import-downloads', [tempPath], (dlIds) => {
                    const id = dlIds[0];
                    if (id === undefined) {
                        return;
                    }
                    api.events.emit('start-install-download', id, true, (err, modId) => {
                        if (err !== null) {
                            api.showErrorNotification('Failed to install bepinex from github repo, ', err);
                        }
                        const state = api.getState();
                        const profileId = selectors.lastActiveProfileForGame(state, GAME_ID);
                        const batch = [
                            actions.setModAttributes(GAME_ID, modId, {
                                installTime: new Date(),
                                name: `BepInEx`,
                                customFileName: `BepInEx`,
                                version: modVersion,
                            }),
                            actions.setModEnabled(profileId, modId, true),
                        ];

                        util.batchDispatch(api.store, batch);
                        api.dismissNotification(`schedule1-installingbepinex`);
                        return Promise.resolve();
                    });
                });
            }
        }
    }
    catch (err) {
        api.dismissNotification(`schedule1-installingbepinex`);
        return Promise.reject(err);
    }
}

async function importMelonLoader(api) {
    api.sendNotification({
        id: `schedule1-installingmelonloader`,
        message: 'Downloading MelonLoader',
        type: 'activity',
        noDismiss: true,
        allowSuppress: false,
    });
    try {
        const response = await axios.get(MELONLOADER_LINK);
        if (response.status === 200) {
            const release = response.data;
            if (release.assets.length > 0) {
                const chosenAsset = release.assets.find(asset => asset.name.includes('MelonLoader.x64.zip'));
                const assetName = chosenAsset.name;
                const assetUrl = chosenAsset.browser_download_url;
                const modVersion = release.tag_name;

                const tempPath = path.join(util.getVortexPath('temp'), assetName);
                const Response = await axios({
                    method: 'get',
                    url: assetUrl,
                    responseType: 'arraybuffer',
                    headers: {
                        "Accept-Encoding": "gzip, deflate",
                        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/107.0.0.0 Safari/537.36"
                    },
                });

                await fs.writeFileAsync(tempPath, Buffer.from(Response.data));
                api.dismissNotification(`schedule1-installingmelonloader`);

                api.events.emit('import-downloads', [tempPath], (dlIds) => {
                    const id = dlIds[0];
                    if (id === undefined) {
                        return;
                    }
                    api.events.emit('start-install-download', id, true, (err, modId) => {
                        if (err !== null) {
                            api.showErrorNotification('Failed to install melonloader from github schedule1, ', err);
                        }
                        const state = api.getState();
                        const profileId = selectors.lastActiveProfileForGame(state, GAME_ID);
                        const batch = [
                            actions.setModAttributes(GAME_ID, modId, {
                                installTime: new Date(),
                                name: `MelonLoader`,
                                customFileName: `MelonLoader`,
                                version: modVersion,
                            }),
                            actions.setModEnabled(profileId, modId, true),
                        ];

                        util.batchDispatch(api.store, batch);
                        api.dismissNotification(`schedule1-installingmelonloader`);
                        return Promise.resolve();
                    });
                });
            }
        }
    }
    catch (err) {
        api.dismissNotification(`schedule1-installingmelonloader`);
        return Promise.reject(err);
    }
}

function findGame() {
    return util.GameStoreHelper.findByAppId([STEAMAPP_ID])
        .then(game => game.gamePath);
}

async function prepareForModding(api, discovery) {
    const modPaths = [
        path.join(discovery.path, BEPINEX_RELPATH),
        path.join(discovery.path, MELONLOADER_RELPATH),
        path.join(discovery.path, "MelonLoader"),
    ];
    try {
        await Promise.all(modPaths.map((m) => fs.ensureDirWritableAsync(m)));
        //await modloaderRequirement(api, discovery);
        return Promise.resolve();
    } catch (err) {
        log('error', 'Failed to prepare for modding', err);
        return Promise.reject(err);
    }
}

module.exports = {
    default: main,
};
