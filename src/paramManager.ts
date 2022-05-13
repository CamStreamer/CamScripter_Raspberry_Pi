import * as chokidar from 'chokidar';
import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';

import { logger } from './logger';

export class ParamManager extends EventEmitter {
    storage: string;
    params: { [key: string]: ParamGroup };
    watch_dog: chokidar.FSWatcher;
    ready: boolean;
    constructor(folder: string) {
        super();
        this.storage = folder;
        this.watch_dog = chokidar.watch(folder);
        this.ready = false;
        this.params = {};

        this.watch_dog.on('add', (pathFile) => {
            let parsed = path.parse(pathFile);
            if (parsed.ext === '.json') {
                this.params[parsed.name] = new ParamGroup(parsed.name, pathFile);
            }
            this.emit('new', parsed.name);
        });

        this.watch_dog.on('change', (pathFile) => {
            let parsed = path.parse(pathFile);
            if (parsed.ext === '.json') {
                logger.logInfo('Refreshing: ' + parsed.name);
                this.params[parsed.name].refresh();
                this.emit('change', parsed.name);
            }
        });

        this.watch_dog.on('ready', () => {
            let filenames = fs.readdirSync(this.storage);
            filenames.forEach((file) => {
                let parsed = path.parse(file);
                if (parsed.ext === '.json') {
                    logger.logDebug('Param loaded: ' + parsed.name);
                    this.params[parsed.name] = new ParamGroup(parsed.name, this.storage + file);
                }
            });
            this.ready = true;
            this.emit('ready');
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
    file_name: string;
    constructor(name: string, file_name: string) {
        super();
        let raw_json = fs.readFileSync(file_name);
        this.file_name = file_name;
        this.name = name;
        this.value = JSON.parse(raw_json.toString());
    }

    update(value: object): void {
        fs.writeFileSync(this.file_name, JSON.stringify(value));
        this.value = value;
    }

    refresh(): void {
        let raw_json = fs.readFileSync(this.file_name);
        this.value = JSON.parse(raw_json.toString());
        logger.logDebug('Parameter ' + this.name + ' new value: ' + JSON.stringify(this.value));
        this.emit('refresh');
    }
}
