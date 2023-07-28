import * as chokidar from 'chokidar';
import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';

import { logger } from './logger';

export class ParamManager extends EventEmitter {
    storage: string;
    params: { [key: string]: ParamGroup };
    watchDog: chokidar.FSWatcher;
    ready: boolean;
    constructor(folder: string) {
        super();
        this.storage = folder;
        this.ready = false;
        this.params = {};

        this.init();
    }

    private async init() {
        await this.createDefaultConfiguration();

        this.watchDog = chokidar.watch(this.storage);
        this.watchDog.on('add', (pathFile) => {
            let parsed = path.parse(pathFile);
            if (parsed.ext === '.json') {
                this.params[parsed.name] = new ParamGroup(parsed.name, pathFile);
            }
            this.emit('new', parsed.name);
        });

        this.watchDog.on('change', (pathFile) => {
            let parsed = path.parse(pathFile);
            if (parsed.ext === '.json') {
                logger.logInfo('Refreshing: ' + parsed.name);
                this.params[parsed.name].refresh();
                this.emit('change', parsed.name);
            }
        });

        this.watchDog.on('ready', () => {
            let filenames = fs.readdirSync(this.storage);
            filenames.forEach((file) => {
                let parsed = path.parse(file);
                if (parsed.ext === '.json') {
                    logger.logDebug('Param loaded: ' + parsed.name);
                    this.params[parsed.name] = new ParamGroup(parsed.name, path.join(this.storage, file));
                }
            });
            this.ready = true;
            this.emit('ready');
        });
    }

    private async createDefaultConfiguration() {
        try {
            const configExitsts = await this.configurationExist('packageconfigurations');
            if (!configExitsts) {
                logger.logDebug("Parameter packageconfigurations doesn't exist, creating default configuration.");
                fs.writeFileSync(path.join(this.storage, 'packageconfigurations.json'), '{}');
            }
        } catch (err) {
            logger.logError(err.toString());
        }
    }

    private configurationExist(paramName) {
        return new Promise<boolean>((resolve) => {
            fs.access(path.join(this.storage, paramName + '.json'), (err) => {
                if (err) {
                    resolve(false);
                } else {
                    resolve(true);
                }
            });
        });
    }

    get(group: string): object {
        if (group in this.params) {
            return this.params[group].value;
        } else {
            return {};
        }
    }

    update(group: string, value: object): void {
        if (group in this.params) {
            this.params[group].update(value);
        } else {
            throw 'Param group does not exist!';
        }
    }
}

export class ParamGroup extends EventEmitter {
    name: string;
    value: object;
    fileName: string;
    constructor(name: string, fileName: string) {
        super();
        let rawJson = fs.readFileSync(fileName);
        this.fileName = fileName;
        this.name = name;
        this.value = JSON.parse(rawJson.toString());
    }

    update(value: object): void {
        fs.writeFileSync(this.fileName, JSON.stringify(value));
        this.value = value;
    }

    refresh(): void {
        let rawJson = fs.readFileSync(this.fileName);
        this.value = JSON.parse(rawJson.toString());
        logger.logDebug(`Parameter ${this.name} new value: ${JSON.stringify(this.value)}`);
        this.emit('refresh');
    }
}
