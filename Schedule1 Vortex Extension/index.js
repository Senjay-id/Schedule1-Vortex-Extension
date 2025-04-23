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
    context.registerInstaller('schedule1-luamod', 25, testSupportedS1APIContent, installS1APIMod(context.api));
    context.registerInstaller('schedule1-pluginmod', 27, testSupportedPluginContent, installPluginMods(context.api));

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

function installS1APIMod(api) {
    return async (files, workingDir, gameId, progressDel, choices, unattended, archivePath) => {
        const instructions = [];

        for (const iter of files) {
            try {
                const stats = await fs.statAsync(path.join(workingDir, iter));
                if (stats.isDirectory()) {
                    continue; // Skip directories
                }

                const segments = iter.split(path.sep);
                const lowerSegments = segments.map(seg => seg.toLowerCase());
                const hasPlugins = lowerSegments.includes('plugins');

                if (!hasPlugins) { // skip the file if the path doesn't have plugins
                    continue;
                }

                const pluginsIdx = lowerSegments.indexOf('plugins');
                const destination = segments.slice(pluginsIdx).join(path.sep);
                
                instructions.push({
                    type: 'copy',
                    source: iter,
                    destination: path.join(destination),
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
        return { instructions }; // async functions automatically wrap in Promise
    };
}

function installLuaMod(api) {
    return async (files, workingDir, gameId, progressDel, choices, unattended, archivePath) => {
        const instructions = [];

        for (const iter of files) {
            try {
                const stats = await fs.statAsync(path.join(workingDir, iter));
                if (stats.isDirectory()) {
                    continue; // Skip directories
                }

                const segments = iter.split(path.sep);
                const isLuaFile = iter.toLowerCase().endsWith('.lua');

                if (!isLuaFile)
                    continue;
                else {
                    const filename = path.basename(iter);
                    instructions.push({
                        type: 'copy',
                        source: iter,
                        destination: path.join(LUA_SCRIPT_RELPATH, filename),
                        //destination: path.join(LUA_SCRIPT_RELPATH, segments.join(path.sep)),
                    });
                }
                // Get just the filename (last segment of the path)

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
        return { instructions }; // async functions automatically wrap in Promise
    };
}

function installScheduleLuaMod(api) {
    return async (files, workingDir, gameId, progressDel, choices, unattended, archivePath) => {
        const instructions = [];

        for (const iter of files) {
            try {
                const stats = await fs.statAsync(path.join(workingDir, iter));
                if (stats.isDirectory()) {
                    continue; // Skip directories
                }

                const segments = iter.split(path.sep);
                const lowerSegments = segments.map(seg => seg.toLowerCase());
                const hasMods = lowerSegments.includes('mods');
                const hasUserlibs = lowerSegments.includes('userlibs');

                // Skip if the file is in the root (no 'mods' or 'userlibs' in path)
                if (!hasMods && !hasUserlibs) {
                    continue;
                }

                // Determine destination based on whether it's in 'mods' or 'userlibs'
                let destination;
                if (hasMods) {
                    const modsIdx = lowerSegments.indexOf('mods');
                    destination = segments.slice(modsIdx).join(path.sep);
                } else if (hasUserlibs) {
                    const userlibsIdx = lowerSegments.indexOf('userlibs');
                    destination = segments.slice(userlibsIdx).join(path.sep);
                }

                instructions.push({
                    type: 'copy',
                    source: iter,
                    destination: path.join(destination),
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
        return { instructions }; // async functions automatically wrap in Promise
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

        const instructions = [];
        for (const iter of files) {
            try {
                const stats = await fs.statAsync(path.join(workingDir, iter));
                if (stats.isDirectory()) {
                    continue;
                }

                const ext = path.extname(iter).toLowerCase();
                const segments = iter.split(path.sep);
                const bepinexIdx = segments.map(seg => seg.toLowerCase()).indexOf('bepinex');
                const bepinexConfigIdx = segments.map(seg => seg.toLowerCase()).indexOf('config');
                const bepinexPluginsIdx = segments.map(seg => seg.toLowerCase()).indexOf('plugins');
                const bepinexPatchersIdx = segments.map(seg => seg.toLowerCase()).indexOf('patchers');
                const melonloaderIdx = segments.map(seg => seg.toLowerCase()).indexOf('melonloader');
                const melonloaderUserLibsIdx = segments.map(seg => seg.toLowerCase()).indexOf('userlibs');
                const melonloaderConfigIdx = segments.map(seg => seg.toLowerCase()).indexOf('userdata');

                if (bepinexIdx !== -1) {
                    variantSet.add(segments.slice(0, bepinexIdx).join(path.sep));
                    instructions.push({
                        type: 'copy',
                        source: iter,
                        destination: path.join(destination, segments.slice(bepinexIdx).join(path.sep)),
                    });
                } else if (bepinexPluginsIdx !== -1) {
                    const relPath = path.join(BEPINEX_PLUGINS_RELPATH, segments.slice(bepinexPluginsIdx + 1).join(path.sep));
                    instructions.push({
                        type: 'copy',
                        source: iter,
                        destination: path.join(destination, relPath),
                    });
                } else if (bepinexPatchersIdx !== -1) {
                    const relPath = path.join(BEPINEX_PATCHERS_RELPATH, segments.slice(bepinexPatchersIdx + 1).join(path.sep));
                    instructions.push({
                        type: 'copy',
                        source: iter,
                        destination: path.join(destination, relPath),
                    });
                } else if (bepinexConfigIdx !== -1) {
                    const relPath = path.join(BEPINEX_CONFIG_RELPATH, segments.slice(bepinexConfigIdx + 1).join(path.sep));
                    instructions.push({
                        type: 'copy',
                        source: iter,
                        destination: path.join(destination, relPath),
                    });
                } else if (melonloaderIdx !== -1) {
                    variantSet.add(segments.slice(0, melonloaderIdx).join(path.sep));
                    instructions.push({
                        type: 'copy',
                        source: iter,
                        destination: path.join(destination, segments.slice(melonloaderIdx).join(path.sep)),
                    });
                } else if (melonloaderUserLibsIdx !== -1) {
                    variantSet.add(segments.slice(0, melonloaderIdx).join(path.sep));
                    instructions.push({
                        type: 'copy',
                        source: iter,
                        destination: path.join(destination, segments.slice(melonloaderUserLibsIdx).join(path.sep)),
                    });
                } else if (melonloaderConfigIdx !== -1) {
                    const relPath = path.join(MELONLOADER_CONFIG_RELPATH, segments.slice(melonloaderConfigIdx + 1).join(path.sep));
                    instructions.push({
                        type: 'copy',
                        source: iter,
                        destination: path.join(destination, relPath),
                    });
                } else if (ext === '.dll') {
                    let relPath = '';
                    const dllSegments = iter.split(path.sep);

                    if (isBepInEx) {
                        relPath = isBepInExPatcher
                            ? path.join(BEPINEX_PATCHERS_RELPATH, dllSegments.slice(-2).join(path.sep))
                            : path.join(BEPINEX_PLUGINS_RELPATH, dllSegments.slice(-2).join(path.sep));
                    } else if (isMelonLoader) {
                        relPath = isMelonLoaderPlugins
                            ? path.join(MELONLOADER_PLUGINS_RELPATH, path.basename(iter))
                            : path.join(MELONLOADER_MODS_RELPATH, path.basename(iter));
                    }

                    instructions.push({
                        type: 'copy',
                        source: iter,
                        destination: path.join(destination, relPath),
                    });
                } else if (!ext) {
                    let otherRelPath = '';
                    const otherSegments = iter.split(path.sep);

                    if (isMelonLoader) {
                        otherRelPath = path.join(MELONLOADER_MODS_RELPATH, otherSegments.slice(1).join(path.sep));
                    }
                    else if (isBepInEx) {
                        otherRelPath = path.join(BEPINEX_PLUGINS_RELPATH, otherSegments.slice(1).join(path.sep));
                    }

                    if (otherRelPath) {
                        instructions.push({
                            type: 'copy',
                            source: iter,
                            destination: path.join(destination, otherRelPath),
                        });
                    }
                } else if (ext !== '.md') {
                    let otherRelPath = '';
                    const otherSegments = iter.split(path.sep);

                    if (isMelonLoader) {
                        otherRelPath = path.join(MELONLOADER_MODS_RELPATH, otherSegments.slice(1).join(path.sep));
                    }
                    else if (isBepInEx) {
                        otherRelPath = path.join(BEPINEX_PLUGINS_RELPATH, otherSegments.slice(1).join(path.sep));
                    }

                    if (otherRelPath) {
                        instructions.push({
                            type: 'copy',
                            source: iter,
                            destination: path.join(destination, otherRelPath),
                        });
                    }
                }
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
                const assetName = chosenAsset.name
                const assetUrl = chosenAsset.browser_download_url
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
                const assetName = chosenAsset.name
                const assetUrl = chosenAsset.browser_download_url
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
