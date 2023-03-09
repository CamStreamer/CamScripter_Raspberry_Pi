import * as cp from 'child_process';
import * as chokidar from 'chokidar';
import { EventEmitter } from 'events';
import * as fs from 'fs-extra';
import * as getport from 'get-port';
import * as path from 'path';

import { CamScripterMonitor } from './camscripterMonitor';
import { Enviroment } from './commonData';
import { logger } from './logger';
import { ParamGroup } from './paramManager';

type Manifest = {
    package_name: string;
    package_menu_name: string;
    ui_link: string;
};

export class PackageManager extends EventEmitter {
    storage: string;
    packages: Record<string, Package>;
    packagesRegisterPrms: Record<string, Promise<void>>;
    pckdirWatch: chokidar.FSWatcher;
    pckdirWatchPause: boolean;
    settingsWatch: chokidar.FSWatcher;
    directiveParams: ParamGroup;
    version: string[];
    lockMode: boolean;
    ready: boolean;

    constructor(storage: string, version: string[]) {
        super();
        this.lockMode = false;
        this.storage = storage;
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
                logger.logError(`Package initialization error: ${err.message}`);
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
        this.packages[packageName] = new Package(`${this.storage}/${packageName}`, httpPort, httpPortPublic);
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
            const manifest = JSON.parse(rawManifest.toString());
            if ('required_camscripter_rbi_version' in manifest) {
                let version = manifest['required_camscripter_rbi_version'].split('.');

                if (version.length != this.version.length) {
                    throw new Error('Wrong manifest format');
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
                const name = manifest['package_name'];
                logger.logInfo('Package Manager: Installing package ' + name);

                logger.logInfo('npm install run');
                cp.execSync('sudo npm install', {
                    cwd: tmpPackagePath,
                });

                if (this.contains(name)) {
                    const pckgWasEnabled = this.packages[name].enabled;
                    this.unregisterPackage(name);
                    await fs.copy(`${this.storage}/${name}/localdata`, `${tmpPackagePath}/localdata`);
                    await fs.move(`${tmpPackagePath}`, `${this.storage}/${name}`, { overwrite: true });
                    await this.registerPackage(name);
                    if (pckgWasEnabled) {
                        this.packages[name].start();
                    }
                } else {
                    await fs.move(`${tmpPackagePath}`, `${this.storage}/${name}`, { overwrite: true });
                    await this.registerPackage(name);
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
        if (this.directiveParams) {
            this.directiveParams.refresh();
        }
    }

    uninstallPackage(name: string) {
        let storage = `${this.storage}/${name}`;
        fs.removeSync(storage);
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
                    if (name in params.value && params.value[name].enabled) {
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
    enabled: boolean;
    process: CamScripterMonitor;
    envVars: Enviroment;
    constructor(storage: string, httpPort: number, httpPortPublic: number) {
        this.storage = storage;
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
            logPath: this.storage + '/localdata/log.txt',
            env: this.envVars,
            restartDelay: 5000,
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
        let rawManifest = fs.readFileSync(this.storage + '/manifest.json');
        let manifest = JSON.parse(rawManifest.toString());
        return manifest;
    }

    accessOnlineFile(rawPath: string): [fs.Stats, fs.ReadStream] {
        let filePath = this.storage + '/html/' + path.normalize(rawPath);
        if (fs.pathExistsSync(filePath)) {
            let stat = fs.statSync(filePath);
            return [stat, fs.createReadStream(filePath)];
        } else {
            return null;
        }
    }

    accessLogFile(): { stat: fs.Stats; stream: fs.ReadStream } {
        let filePath = this.storage + '/localdata/log.txt';
        if (fs.pathExistsSync(filePath)) {
            let stat = fs.statSync(filePath);
            return { stat, stream: fs.createReadStream(filePath, { end: stat.size }) };
        } else {
            return null;
        }
    }

    getSettings(): object {
        const setPath = this.envVars.persistentDataPath + 'settings.json';
        if (fs.pathExistsSync(setPath)) {
            try {
                return fs.readJSONSync(setPath);
            } catch (err) {
                logger.logError(err);
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
