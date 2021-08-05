import * as fs from 'fs';
import * as fse from 'fs-extra'
import * as chokidar from 'chokidar';
import * as path from 'path';
import { ParamGroup } from './paramManager';
import { logger, Enviroment } from './commonData';
import { EventEmitter } from 'events';
import { CamScripterMonitor } from './camscripterMonitor';
import * as getport from 'get-port';
import * as cp from 'child_process';


type Manifest = {
    package_name: string;
    package_menu_name: string;
    ui_link: string;
}

export class PackageManager extends EventEmitter {
    storage: string;
    packages: { [key: string]: Package };
    pckdir_watch: chokidar.FSWatcher;
    directive_params: ParamGroup;
    version: string[];
    lock_mode: boolean;
    ready: boolean;

    constructor(storage: string, version: string[]) {
        super();
        this.lock_mode = false;
        this.storage = storage;
        this.packages = {};
        this.version = version;
        this.pckdir_watch = chokidar.watch(storage);
        this.ready = false;

        this.pckdir_watch.on('addDir', async pathDir => {
            let parsed = path.parse(pathDir);
            if (parsed.dir === this.storage) {
                logger.logInfo("Package added " + parsed.name);
                let http_p = await getport({ port: getport.makeRange(52521, 52570) });
                let http_pp = await getport({ port: getport.makeRange(52571, 52620) })
                this.packages[parsed.name] = (new Package(`${this.storage}/${parsed.name}`, http_p, http_pp));
            }
        });
        this.pckdir_watch.on('unlinkDir', pathDir => {
            let parsed = path.parse(pathDir);
            if (parsed.dir === this.storage) {
                delete this.packages[parsed.name];
            }
        });

        this.pckdir_watch.on('change', file_path => {
            let parsed = path.parse(file_path);
            let path_members = parsed.dir.split('/');
            let n = path_members.length;
            let pckg_name = path_members[n - 2]

            if (parsed.name === 'settings'
                && pckg_name in this.packages
                && path_members[n - 1] === 'localdata'
                && path_members.slice(0, n - 2).join('/') === this.storage) {
                this.packages[pckg_name].restart('SIGINT');
            }
        });

        this.pckdir_watch.on('ready', () => {
            let packages = this.list();
            for (let name in this.packages) {
                logger.logInfo("Package ready " + name);
            }
            this.ready = true;
            this.emit('ready');
        });

    }

    installPackage(tmp_file: string) {
        if (fse.existsSync(tmp_file + '/manifest.json')) {
            let raw_manifest = fse.readFileSync(tmp_file + '/manifest.json');
            let manifest = JSON.parse(raw_manifest.toString());
            if ('required_camscripter_rbi_version' in manifest) {
                let version = manifest['required_camscripter_rbi_version'].split('.');

                if (version.length != this.version.length) throw 'Wrong manifest format';

                for (let i = 0; i < this.version.length; i++) {
                    if (Number.parseInt(version[i]) > Number.parseInt(this.version[i])) {
                        throw 'Newer CSc-RBi version required';
                    } else if (Number.parseInt(version[i]) < Number.parseInt(this.version[i])) {
                        break;
                    }
                }
            }
            logger.logInfo("npm install run")
            cp.execSync("npm install", {
                cwd: tmp_file
            });
            this.lock();
            let name = manifest["package_name"];
            logger.logInfo('Package Manager: Installing package ' + name);
            let copy_filter = (src, dest) => {
                let parsed = path.parse(dest);
                if (parsed.dir === this.storage + `/${name}/localdata` && fs.existsSync(dest)) {
                    return false;
                }
                return true;
            };

            if (name in this.packages) {
                if (this.packages[name].enabled) this.packages[name].stop();
                fse.copySync(tmp_file, `${this.storage}/${name}`, { 'filter': copy_filter });
            } else {
                fse.copySync(tmp_file, `${this.storage}/${name}`);
            }
            this.unlock();
            return true;
        } else {
            logger.logError('Package Manager: Error no manifest found');
            throw 'No manifest found';
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
        fse.removeSync(storage);
        delete this.packages[name];
    }

    contains(name: string) {
        return name in this.packages;
    }

    connect(params: ParamGroup) {
        this.directive_params = params;

        this.directive_params.on('refresh', () => {
            if (!this.lock_mode) {
                logger.logInfo("Parameters applied!");
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

    list(): string[] {
        let packages = [];
        let filenames = fs.readdirSync(this.storage);
        filenames.forEach(file => {
            packages.push(file);
        });
        return packages;
    }

    listManifests(): Manifest[] {
        let list = []
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
    constructor(storage: string, default_http_sockt: number, default_http_public: number) {

        this.storage = storage;
        this.manifest = this.readManifest();
        this.enabled = false;
        this.env_vars = {
            http_socket: default_http_sockt,
            http_socket_public: default_http_public,
            install_path: this.storage,
            persistent_data_path: this.storage + '/localdata/'
        };
        if (!fse.pathExistsSync(`${this.storage}/localdata`)) {
            fse.mkdirSync(`${this.storage}/localdata`);
        }
        this.process = new (CamScripterMonitor)(this.storage + '/main.js', {
            'cwd': this.storage,
            'log_path': this.storage + '/localdata/log.txt',
            'env': this.env_vars,
            'restart_delay': 5000
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

    accessOnlineFile(raw_path: string): [fs.Stats, fse.ReadStream] {
        let file_path = this.storage + '/html/' + path.normalize(raw_path);
        if (fse.pathExistsSync(file_path)) {
            let stat = fse.statSync(file_path);
            return [stat, fse.createReadStream(file_path)];
        } else {
            return null;
        }
    }

    accessLogFile(): [fs.Stats, fse.ReadStream] {
        let file_path = this.storage + '/localdata/log.txt'
        if (fse.pathExistsSync(file_path)) {
            let stat = fse.statSync(file_path);
            return [stat, fse.createReadStream(file_path)];
        } else {
            return null;
        }
    }

    getSettings(): object {
        let set_path = this.env_vars.persistent_data_path + 'settings.json';
        if (fse.pathExistsSync(set_path)) {
            try {
                let json = fse.readJSONSync(set_path);
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
        fse.writeJsonSync(set_path, json_obj);
    }

    start(): void {
        let was_enabled = this.enabled;
        this.enabled = true;
        if (!was_enabled) this.process.start();
    }

    restart(signal?: NodeJS.Signals): void {
        if (this.enabled) {
            let sig = signal || 'SIGTERM';
            this.process.restart(sig);
        }
    }

    stop(): void {
        let was_enabled = this.enabled;
        this.enabled = false;
        if (was_enabled) this.process.stop();
    }
}
