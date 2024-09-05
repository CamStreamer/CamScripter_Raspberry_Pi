import * as cp from 'child_process';
import * as chokidar from 'chokidar';
import { EventEmitter } from 'events';
import * as fs from 'fs-extra';
import * as getport from 'get-port';
import * as path from 'path';

import { CamScripterMonitor } from './camscripterMonitor';
import { Enviroment } from './commonData';
import { errToString, logger } from './logger';
import { ParamGroup } from './paramManager';

type Manifest = {
    package_name: string;
    package_menu_name: string;
    required_camscripter_rbi_version: string;
    ui_link: string;
};

export class PackageManager extends EventEmitter {
    private storage: string;
    private logsStorage: string;
    private packages: Record<string, Package>;
    private packagesRegisterPrms: Record<string, Promise<void>>;
    private pckdirWatch: chokidar.FSWatcher;
    private pckdirWatchPause: boolean;
    private settingsWatch: chokidar.FSWatcher;
    private directiveParams?: ParamGroup;
    private version: string[];
    private lockMode: boolean;
    private ready: boolean;

    constructor(storage: string, logsStorage: string, version: string[]) {
        super();
        this.lockMode = false;
        this.storage = storage;
        this.logsStorage = logsStorage;
        this.packages = {};
        this.packagesRegisterPrms = {};
        this.pckdirWatchPause = false;
        this.version = version;
        this.ready = false;

        this.pckdirWatch = chokidar.watch(`${storage}`, { depth: 0 });
        this.pckdirWatch.on('addDir', (pathDir) => {
            if (this.pckdirWatchPause) {
                return;
            }
            const parsed = path.parse(pathDir);
            if (parsed.name !== 'packages') {
                this.packagesRegisterPrms[parsed.name] = this.registerPackage(parsed.name);
            }
        });
        this.pckdirWatch.on('unlinkDir', (pathDir) => {
            if (this.pckdirWatchPause) {
                return;
            }
            const parsed = path.parse(pathDir);
            this.unregisterPackage(parsed.name);
        });
        this.pckdirWatch.on('ready', async () => {
            try {
                await Promise.all(Object.values(this.packagesRegisterPrms));
                for (let name in this.packages) {
                    logger.logInfo('Package ready ' + name);
                }
            } catch (err) {
                logger.logError(`Package initialization error: ${errToString(err)}`);
            } finally {
                this.ready = true;
                this.emit('ready');
            }
        });
        this.pckdirWatch.on('error', (err) => {
            logger.logError(`Package watcher error: ${err.message}`);
        });

        const settingsGlob = `${storage}/**/localdata/settings.json`;
        this.settingsWatch = chokidar.watch(settingsGlob, { depth: 2 });
        this.settingsWatch.on('change', (filePath) => {
            let pathMembers = filePath.split('/');
            let pckgName = pathMembers[pathMembers.length - 3];
            if (this.contains(pckgName)) {
                this.packages[pckgName].restart('SIGINT');
            }
        });
    }

    isReady() {
        return this.ready;
    }

    getPackages() {
        return this.packages;
    }

    async registerPackage(packageName: string) {
        if (this.contains(packageName)) {
            return;
        }

        logger.logInfo(`Package added ${packageName}`);
        const httpPort = await getport({
            port: getport.makeRange(52521, 52570),
        });
        const httpPortPublic = await getport({
            port: getport.makeRange(52571, 52620),
        });
        this.packages[packageName] = new Package(
            `${this.storage}/${packageName}`,
            `${this.logsStorage}/${packageName}.txt`,
            httpPort,
            httpPortPublic
        );
    }

    unregisterPackage(packageName: string) {
        if (!this.contains(packageName)) {
            return;
        }

        logger.logInfo(`Package removed ${packageName}`);
        this.packages[packageName].stop();
        delete this.packages[packageName];
    }

    async installPackage(tmpPackagePath: string) {
        if (fs.existsSync(tmpPackagePath + '/manifest.json')) {
            const rawManifest = await fs.readFile(tmpPackagePath + '/manifest.json');
            const manifest = JSON.parse(rawManifest.toString()) as Manifest;
            logger.logInfo('Package Manager: Installing package ' + manifest.package_menu_name);

            if (manifest.package_name.length === 0) {
                throw new Error('Wrong manifest format: package name is empty.');
            }
            if (!/^[0-9a-zA-Z_-]+$/.test(manifest.package_name)) {
                throw new Error(
                    'Wrong manifest format: only alphabetic characters, underscore and coma are allowed in package name.'
                );
            }

            if (manifest.required_camscripter_rbi_version) {
                const version = manifest.required_camscripter_rbi_version.split('.');
                if (version.length != this.version.length) {
                    throw new Error(
                        'Wrong manifest format: invalid format of required_camscripter_rbi_version attribute.'
                    );
                }
                for (let i = 0; i < this.version.length; i++) {
                    if (Number.parseInt(version[i]) > Number.parseInt(this.version[i])) {
                        throw new Error('Newer CSc-RBi version required');
                    } else if (Number.parseInt(version[i]) < Number.parseInt(this.version[i])) {
                        break;
                    }
                }
            }

            try {
                this.lock();
                this.pckdirWatchPause = true;

                logger.logInfo('npm install run');
                cp.execSync('sudo npm install', {
                    cwd: tmpPackagePath,
                });

                if (this.contains(manifest.package_name)) {
                    const pckgWasEnabled = this.packages[manifest.package_name].enabled;
                    this.unregisterPackage(manifest.package_name);
                    await fs.copy(`${this.storage}/${manifest.package_name}/localdata`, `${tmpPackagePath}/localdata`);
                    await fs.move(`${tmpPackagePath}`, `${this.storage}/${manifest.package_name}`, { overwrite: true });
                    await this.registerPackage(manifest.package_name);
                    if (pckgWasEnabled) {
                        this.packages[manifest.package_name].start();
                    }
                } else {
                    await fs.move(`${tmpPackagePath}`, `${this.storage}/${manifest.package_name}`, { overwrite: true });
                    await this.registerPackage(manifest.package_name);
                }
            } catch (err) {
                throw err;
            } finally {
                this.pckdirWatchPause = true;
                this.unlock();
            }
            return true;
        } else {
            logger.logError('Package Manager: Error no manifest found');
            throw new Error('No manifest found');
        }
    }

    lock() {
        this.lockMode = true;
    }
    unlock() {
        this.lockMode = false;
        this.directiveParams?.refresh();
    }

    uninstallPackage(name: string) {
        fs.removeSync(`${this.storage}/${name}`);
        fs.removeSync(`${this.logsStorage}/${name}.txt`);
        this.unregisterPackage(name);
    }

    contains(name: string) {
        return name in this.packages;
    }

    connect(params: ParamGroup) {
        this.directiveParams = params;

        this.directiveParams.on('refresh', () => {
            if (!this.lockMode) {
                logger.logInfo('Parameters applied!');
                for (let name in this.packages) {
                    if (params.value.hasOwnProperty(name) && params.value[name].enabled) {
                        this.packages[name].start();
                    } else {
                        this.packages[name].stop();
                    }
                }
            }
        });
        this.directiveParams.refresh();
    }

    listManifests(): Manifest[] {
        let list: Manifest[] = [];
        for (let pckgName in this.packages) {
            list.push(this.packages[pckgName].readManifest());
        }
        return list.sort((a, b) => {
            if (a.package_menu_name < b.package_menu_name) {
                return -1;
            }
            if (a.package_menu_name > b.package_menu_name) {
                return 1;
            }
            return 0;
        });
    }
}

export class Package {
    manifest: Manifest;
    storage: string;
    logPath: string;
    enabled: boolean;
    process: CamScripterMonitor;
    envVars: Enviroment;
    constructor(storage: string, logPath: string, httpPort: number, httpPortPublic: number) {
        this.storage = storage;
        this.logPath = logPath;
        this.manifest = this.readManifest();
        this.enabled = false;
        this.envVars = {
            httpPort: httpPort,
            httpPortPublic: httpPortPublic,
            installPath: this.storage,
            persistentDataPath: this.storage + '/localdata/',
        };
        if (!fs.pathExistsSync(`${this.storage}/localdata`)) {
            fs.mkdirSync(`${this.storage}/localdata`);
        }
        this.process = new CamScripterMonitor(this.storage + '/main.js', {
            cwd: this.storage,
            logPath: this.logPath,
            env: this.envVars,
        });

        this.process.on('start', () => {
            logger.logInfo('Starting package ' + this.manifest.package_name);
        });
        this.process.on('restart', () => {
            logger.logInfo('Restarting package ' + this.manifest.package_name);
        });
        this.process.on('stop', () => {
            logger.logInfo('Stopping package ' + this.manifest.package_name);
        });
    }

    readManifest(): Manifest {
        let rawManifest = fs.readFileSync(path.join(this.storage, 'manifest.json'));
        let manifest = JSON.parse(rawManifest.toString());
        return manifest;
    }

    accessOnlineFile(rawPath: string): [fs.Stats, fs.ReadStream] | undefined {
        let filePath = path.join(this.storage, 'html', path.normalize(rawPath));
        if (fs.pathExistsSync(filePath)) {
            let stat = fs.statSync(filePath);
            return [stat, fs.createReadStream(filePath)];
        }
        return undefined;
    }

    accessLogFile(): { stat: fs.Stats; stream: fs.ReadStream } | undefined {
        if (fs.pathExistsSync(this.logPath)) {
            let stat = fs.statSync(this.logPath);
            return { stat, stream: fs.createReadStream(this.logPath, { end: stat.size }) };
        }
        return undefined;
    }

    getSettings(): object {
        const setPath = this.envVars.persistentDataPath + 'settings.json';
        if (fs.pathExistsSync(setPath)) {
            try {
                return fs.readJSONSync(setPath);
            } catch (err) {
                logger.logError(errToString(err));
                return {};
            }
        } else {
            return {};
        }
    }

    setSettings(jsonObj: object): void {
        const setPath = this.envVars.persistentDataPath + 'settings.json';
        fs.writeJsonSync(setPath, jsonObj);
    }

    start(): void {
        if (!this.enabled) {
            this.enabled = true;
            this.process.start();
        }
    }

    restart(signal?: NodeJS.Signals): void {
        if (this.enabled) {
            let sig = signal || 'SIGTERM';
            this.process.restart(sig);
        }
    }

    stop(): void {
        if (this.enabled) {
            this.enabled = false;
            this.process.stop();
        }
    }
}
