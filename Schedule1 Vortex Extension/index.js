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
const MELONLOADER_USERLIBS_RELPATH = path.join('userlibs');
const MELONLOADER_CONFIG_RELPATH = path.join('userdata');

const LUA_SCRIPT_RELPATH = path.join(MELONLOADER_MODS_RELPATH, 'schedulelua', 'scripts');

const DOC_BASENAMES = new Set([
    'readme', 'readme.md', 'readme.txt', 'readme.rst',
    'changelog', 'changelog.md', 'changelog.txt', 'changelog.rst',
    'changes', 'changes.md', 'changes.txt',
    'license', 'license.md', 'license.txt', 'license.rtf',
    'licence', 'licence.md', 'licence.txt',
    'copying', 'copying.md', 'copying.txt',
    'notice', 'notice.md', 'notice.txt',
    'authors', 'authors.md', 'authors.txt',
    'security.md', 'security.txt',
    'contributing.md', 'code_of_conduct.md',
    '.gitignore', '.gitattributes', '.editorconfig',
]);

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

    context.registerInstaller('schedule1-scheduleluamod', 25, testSupportedScheduleLuaContent, installScheduleLuaMod(context.api));
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

function pathSegments(filePath) {
    return String(filePath).split(/[/\\]/).filter(seg => seg && seg !== '.');
}

function shouldSkipFile(filePath) {
    if (!filePath || /[/\\]$/.test(filePath)) {
        return true;
    }
    const base = path.basename(filePath).toLowerCase();
    if (DOC_BASENAMES.has(base)) {
        return true;
    }
    if (/^readme(\.|$)/i.test(base)) {
        return true;
    }
    if (/^change[\s._-]*log(\.|$)/i.test(base)) {
        return true;
    }
    if (/^licen[cs]e(\.|$)/i.test(base)) {
        return true;
    }
    return false;
}

/**
 * Canonical root + remaining archive path after the matched folder.
 * Returns null when that would produce a destination with no filename
 * (the old path.join('mods') bug that created a *file* named mods).
 */
function buildDest(root, segments, idx) {
    if (idx < 0) {
        return null;
    }
    const rest = segments.slice(idx + 1);
    if (rest.length === 0) {
        return null;
    }
    return path.join(root, ...rest);
}

function resolvePluginDestination(file, options = {}) {
    const {
        isBepInEx = false,
        isBepInExPatcher = false,
        isMelonLoaderPlugins = false,
    } = options;

    if (shouldSkipFile(file)) {
        return null;
    }

    const ext = path.extname(file).toLowerCase();
    const segments = pathSegments(file);
    if (segments.length === 0) {
        return null;
    }
    const lowerSegments = segments.map(seg => seg.toLowerCase());

    const bepinexIdx = lowerSegments.indexOf('bepinex');
    const melonloaderIdx = lowerSegments.indexOf('melonloader');
    const userlibsIdx = lowerSegments.indexOf('userlibs');
    const userdataIdx = lowerSegments.indexOf('userdata');
    const modsIdx = lowerSegments.indexOf('mods');
    const pluginsIdx = lowerSegments.indexOf('plugins');
    const patchersIdx = lowerSegments.indexOf('patchers');
    const configIdx = lowerSegments.indexOf('config');

    // UserLibs is a MelonLoader game-root folder, never MelonLoader/UserLibs
    if (userlibsIdx !== -1) {
        return buildDest(MELONLOADER_USERLIBS_RELPATH, segments, userlibsIdx);
    }

    if (userdataIdx !== -1) {
        return buildDest(MELONLOADER_CONFIG_RELPATH, segments, userdataIdx);
    }

    if (bepinexIdx !== -1) {
        if (pluginsIdx > bepinexIdx) {
            return buildDest(BEPINEX_PLUGINS_RELPATH, segments, pluginsIdx);
        }
        if (patchersIdx > bepinexIdx) {
            return buildDest(BEPINEX_PATCHERS_RELPATH, segments, patchersIdx);
        }
        if (configIdx > bepinexIdx) {
            return buildDest(BEPINEX_CONFIG_RELPATH, segments, configIdx);
        }
        return buildDest(BEPINEX_RELPATH, segments, bepinexIdx);
    }

    if (melonloaderIdx !== -1) {
        if (modsIdx > melonloaderIdx) {
            return buildDest(MELONLOADER_MODS_RELPATH, segments, modsIdx);
        }
        if (pluginsIdx > melonloaderIdx) {
            return buildDest(MELONLOADER_PLUGINS_RELPATH, segments, pluginsIdx);
        }
        return buildDest(MELONLOADER_RELPATH, segments, melonloaderIdx);
    }

    if (modsIdx !== -1) {
        return buildDest(MELONLOADER_MODS_RELPATH, segments, modsIdx);
    }

    if (pluginsIdx !== -1) {
        if (isBepInEx) {
            return buildDest(BEPINEX_PLUGINS_RELPATH, segments, pluginsIdx);
        }
        return buildDest(MELONLOADER_PLUGINS_RELPATH, segments, pluginsIdx);
    }

    if (patchersIdx !== -1) {
        return buildDest(BEPINEX_PATCHERS_RELPATH, segments, patchersIdx);
    }

    if (ext === '.dll') {
        const name = path.basename(file);
        if (isBepInEx) {
            return path.join(
                isBepInExPatcher ? BEPINEX_PATCHERS_RELPATH : BEPINEX_PLUGINS_RELPATH,
                name
            );
        }
        if (isMelonLoaderPlugins) {
            return path.join(MELONLOADER_PLUGINS_RELPATH, name);
        }
        return path.join(MELONLOADER_MODS_RELPATH, name);
    }

    return null;
}

function notifyStatError(api, iter, e) {
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

function installS1APIMod(api) {
    return async (files, workingDir, gameId, progressDel, choices, unattended, archivePath) => {
        const instructions = [];

        for (const iter of files) {
            if (shouldSkipFile(iter)) {
                continue;
            }

            try {
                const full = path.join(workingDir, iter);
                const stats = await fs.statAsync(full);
                if (stats.isDirectory()) {
                    continue;
                }

                const ext = path.extname(iter).toLowerCase();
                const segments = pathSegments(iter);
                const lowerSegments = segments.map(seg => seg.toLowerCase());
                const pluginsIdx = lowerSegments.indexOf('plugins');
                const modsIdx = lowerSegments.indexOf('mods');
                const userlibsIdx = lowerSegments.indexOf('userlibs');

                let destination = null;
                if (pluginsIdx !== -1) {
                    destination = buildDest(MELONLOADER_PLUGINS_RELPATH, segments, pluginsIdx);
                } else if (userlibsIdx !== -1) {
                    destination = buildDest(MELONLOADER_USERLIBS_RELPATH, segments, userlibsIdx);
                } else if (modsIdx !== -1) {
                    destination = buildDest(MELONLOADER_MODS_RELPATH, segments, modsIdx);
                } else if (ext === '.dll') {
                    destination = path.join(MELONLOADER_PLUGINS_RELPATH, path.basename(iter));
                }

                if (!destination) {
                    continue;
                }

                instructions.push({
                    type: 'copy',
                    source: iter,
                    destination,
                });
            } catch (e) {
                notifyStatError(api, iter, e);
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
                    continue;
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
                notifyStatError(api, iter, e);
            }
        }
        return { instructions };
    };
}

function installScheduleLuaMod(api) {
    return async (files, workingDir, gameId, progressDel, choices, unattended, archivePath) => {
        const instructions = [];

        for (const iter of files) {
            if (shouldSkipFile(iter)) {
                continue;
            }

            try {
                const full = path.join(workingDir, iter);
                const stats = await fs.statAsync(full);
                if (stats.isDirectory()) {
                    continue;
                }

                const ext = path.extname(iter).toLowerCase();
                const segments = pathSegments(iter);
                const lowerSegments = segments.map(seg => seg.toLowerCase());
                const modsIdx = lowerSegments.indexOf('mods');
                const userlibsIdx = lowerSegments.indexOf('userlibs');
                const userdataIdx = lowerSegments.indexOf('userdata');
                const pluginsIdx = lowerSegments.indexOf('plugins');

                let destination = null;
                if (userlibsIdx !== -1) {
                    destination = buildDest(MELONLOADER_USERLIBS_RELPATH, segments, userlibsIdx);
                } else if (userdataIdx !== -1) {
                    destination = buildDest(MELONLOADER_CONFIG_RELPATH, segments, userdataIdx);
                } else if (modsIdx !== -1) {
                    destination = buildDest(MELONLOADER_MODS_RELPATH, segments, modsIdx);
                } else if (pluginsIdx !== -1) {
                    destination = buildDest(MELONLOADER_PLUGINS_RELPATH, segments, pluginsIdx);
                } else if (ext === '.dll') {
                    destination = path.join(MELONLOADER_MODS_RELPATH, path.basename(iter));
                }

                if (!destination) {
                    continue;
                }

                instructions.push({
                    type: 'copy',
                    source: iter,
                    destination,
                });
            } catch (e) {
                notifyStatError(api, iter, e);
            }
        }
        return { instructions };
    };
}

function installPluginMods(api) {
    return async (files, workingDir, gameId, progressDel, choices, unattended, archivePath) => {
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
                await fs.statAsync(path.join(discovery.path, MELONLOADER_RELPATH, 'net6', 'MelonLoader.dll'));
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
            if (shouldSkipFile(iter)) {
                continue;
            }

            try {
                const full = path.join(workingDir, iter);
                const stats = await fs.statAsync(full);
                if (stats.isDirectory()) {
                    continue;
                }

                const segments = pathSegments(iter);
                const lowerSegments = segments.map(seg => seg.toLowerCase());
                const bepinexIdx = lowerSegments.indexOf('bepinex');
                const melonloaderIdx = lowerSegments.indexOf('melonloader');
                if (bepinexIdx !== -1) {
                    variantSet.add(segments.slice(0, bepinexIdx).join(path.sep));
                }
                if (melonloaderIdx !== -1) {
                    variantSet.add(segments.slice(0, melonloaderIdx).join(path.sep));
                }

                const dest = resolvePluginDestination(iter, {
                    isBepInEx,
                    isBepInExPatcher,
                    isMelonLoaderPlugins,
                });
                if (!dest) {
                    continue;
                }

                instructions.push({
                    type: 'copy',
                    source: iter,
                    destination: dest,
                });
            } catch (e) {
                notifyStatError(api, iter, e);
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
        path.join(discovery.path, MELONLOADER_MODS_RELPATH),
        path.join(discovery.path, MELONLOADER_PLUGINS_RELPATH),
        path.join(discovery.path, MELONLOADER_USERLIBS_RELPATH),
        path.join(discovery.path, MELONLOADER_CONFIG_RELPATH),
    ];
    try {
        await Promise.all(modPaths.map((m) => fs.ensureDirWritableAsync(m)));
        return Promise.resolve();
    } catch (err) {
        log('error', 'Failed to prepare for modding', err);
        return Promise.reject(err);
    }
}

module.exports = {
    default: main,
};
