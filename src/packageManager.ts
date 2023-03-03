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
    pckdir_watch: chokidar.FSWatcher;
    pckdir_watch_pause: boolean;
    settings_watch: chokidar.FSWatcher;
    directive_params: ParamGroup;
    version: string[];
    lock_mode: boolean;
    ready: boolean;

    constructor(storage: string, version: string[]) {
        super();
        this.lock_mode = false;
        this.storage = storage;
        this.packages = {};
        this.packagesRegisterPrms = {};
        this.pckdir_watch_pause = false;
        this.version = version;
        this.ready = false;

        this.pckdir_watch = chokidar.watch(`${storage}`, { depth: 0 });
        this.pckdir_watch.on('addDir', (path_dir) => {
            if (this.pckdir_watch_pause) {
                return;
            }
            const parsed = path.parse(path_dir);
            if (parsed.name !== 'packages') {
                this.packagesRegisterPrms[parsed.name] = this.registerPackage(parsed.name);
            }
        });
        this.pckdir_watch.on('unlinkDir', (path_dir) => {
            if (this.pckdir_watch_pause) {
                return;
            }
            const parsed = path.parse(path_dir);
            this.unregisterPackage(parsed.name);
        });
        this.pckdir_watch.on('ready', async () => {
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
        this.pckdir_watch.on('error', (err) => {
            logger.logError(`Package watcher error: ${err.message}`);
        });

        const settingsGlob = `${storage}/**/localdata/settings.json`;
        this.settings_watch = chokidar.watch(settingsGlob, { depth: 2 });
        this.settings_watch.on('change', (file_path) => {
            let path_members = file_path.split('/');
            let pckg_name = path_members[path_members.length - 3];
            if (this.contains(pckg_name)) {
                this.packages[pckg_name].restart('SIGINT');
            }
        });
    }

    async registerPackage(package_name: string) {
        if (this.contains(package_name)) {
            return;
        }

        logger.logInfo(`Package added ${package_name}`);
        const http_port = await getport({
            port: getport.makeRange(52521, 52570),
        });
        const http_port_public = await getport({
            port: getport.makeRange(52571, 52620),
        });
        this.packages[package_name] = new Package(`${this.storage}/${package_name}`, http_port, http_port_public);
    }

    unregisterPackage(package_name: string) {
        if (!this.contains(package_name)) {
            return;
        }

        logger.logInfo(`Package removed ${package_name}`);
        this.packages[package_name].stop();
        delete this.packages[package_name];
    }

    async installPackage(tmp_package_path: string) {
        if (fs.existsSync(tmp_package_path + '/manifest.json')) {
            const raw_manifest = await fs.readFile(tmp_package_path + '/manifest.json');
            const manifest = JSON.parse(raw_manifest.toString());
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
                this.pckdir_watch_pause = true;
                const name = manifest['package_name'];
                logger.logInfo('Package Manager: Installing package ' + name);

                logger.logInfo('npm install run');
                cp.execSync('sudo npm install', {
                    cwd: tmp_package_path,
                });

                if (this.contains(name)) {
                    const pckgWasEnabled = this.packages[name].enabled;
                    this.unregisterPackage(name);
                    await fs.copy(`${this.storage}/${name}/localdata`, `${tmp_package_path}/localdata`);
                    await fs.move(`${tmp_package_path}`, `${this.storage}/${name}`, { overwrite: true });
                    await this.registerPackage(name);
                    if (pckgWasEnabled) {
                        this.packages[name].start();
                    }
                } else {
                    await fs.move(`${tmp_package_path}`, `${this.storage}/${name}`, { overwrite: true });
                    await this.registerPackage(name);
                }
            } catch (err) {
                throw err;
            } finally {
                this.pckdir_watch_pause = true;
                this.unlock();
            }
            return true;
        } else {
            logger.logError('Package Manager: Error no manifest found');
            throw new Error('No manifest found');
        }
    }

    lock() {
        this.lock_mode = true;
    }
    unlock() {
        this.lock_mode = false;
        if (this.directive_params) {
            this.directive_params.refresh();
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
        this.directive_params = params;

        this.directive_params.on('refresh', () => {
            if (!this.lock_mode) {
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
        this.directive_params.refresh();
    }

    listManifests(): Manifest[] {
        let list = [];
        for (let p in this.packages) {
            list.push(this.packages[p].readManifest());
        }
        return list;
    }
}

export class Package {
    manifest: Manifest;
    storage: string;
    enabled: boolean;
    process: CamScripterMonitor;
    env_vars: Enviroment;
    constructor(storage: string, http_port: number, http_port_public: number) {
        this.storage = storage;
        this.manifest = this.readManifest();
        this.enabled = false;
        this.env_vars = {
            http_port,
            http_port_public,
            install_path: this.storage,
            persistent_data_path: this.storage + '/localdata/',
        };
        if (!fs.pathExistsSync(`${this.storage}/localdata`)) {
            fs.mkdirSync(`${this.storage}/localdata`);
        }
        this.process = new CamScripterMonitor(this.storage + '/main.js', {
            cwd: this.storage,
            log_path: this.storage + '/localdata/log.txt',
            env: this.env_vars,
            restart_delay: 5000,
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
        let raw_manifest = fs.readFileSync(this.storage + '/manifest.json');
        let manifest = JSON.parse(raw_manifest.toString());
        return manifest;
    }

    accessOnlineFile(raw_path: string): [fs.Stats, fs.ReadStream] {
        let file_path = this.storage + '/html/' + path.normalize(raw_path);
        if (fs.pathExistsSync(file_path)) {
            let stat = fs.statSync(file_path);
            return [stat, fs.createReadStream(file_path)];
        } else {
            return null;
        }
    }

    accessLogFile(): { stat: fs.Stats; stream: fs.ReadStream } {
        let file_path = this.storage + '/localdata/log.txt';
        if (fs.pathExistsSync(file_path)) {
            let stat = fs.statSync(file_path);
            return { stat, stream: fs.createReadStream(file_path, { end: stat.size }) };
        } else {
            return null;
        }
    }

    getSettings(): object {
        let set_path = this.env_vars.persistent_data_path + 'settings.json';
        if (fs.pathExistsSync(set_path)) {
            try {
                let json = fs.readJSONSync(set_path);
                return json;
            } catch (err) {
                logger.logError(err);
                return {};
            }
        } else {
            return {};
        }
    }

    setSettings(json_obj: object): void {
        let set_path = this.env_vars.persistent_data_path + 'settings.json';
        fs.writeJsonSync(set_path, json_obj);
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
