import * as cp from 'child_process';
import { EventEmitter } from 'events';
import { WriteStream } from 'fs';
import * as fs from 'fs-extra';
import * as readline from 'readline';
import { Duplex, Stream } from 'stream';

import { Enviroment } from './commonData';
import { logger } from './logger';

type MonitorOptions = {
    env: Enviroment;
    cwd: string;
    restartDelay: number;
    spinTime?: number;
    logPath: string;
};

export class CamScripterMonitor extends EventEmitter {
    path: string;
    restartDelay: number;
    spinTime: number;
    enable: boolean;
    env: Enviroment;
    cwd: string;
    logPath: string;
    processControl: cp.ChildProcess;
    processStream: Duplex;
    processLog: readline.ReadLine;
    fileStream: WriteStream;
    restartTimeout: NodeJS.Timeout;
    constructor(path: string, options: MonitorOptions) {
        super();
        this.enable = false;
        this.path = path;
        this.env = options.env;
        this.cwd = options.cwd;
        this.restartDelay = options.restartDelay; //ms
        this.spinTime = options.spinTime;
        this.logPath = options.logPath;
    }

    start() {
        if (this.enable) {
            throw 'Process was already set to run';
        } else {
            this.newChildProcess();
            this.enable = true;
            this.emit('start');
        }
    }
    stop() {
        if (this.processControl && this.processControl.exitCode === null) {
            this.processControl.removeAllListeners();
            this.processControl.kill('SIGTERM');
            clearTimeout(this.restartTimeout);
            this.enable = false;
            const currentProcess = this.processControl;
            setTimeout(() => {
                this.brutalize(currentProcess);
            }, 1500);
        } else if (this.processControl && this.enable) {
            clearTimeout(this.restartTimeout);
            this.enable = false;
        } else {
            throw 'This process has been set to stop';
        }
        this.emit('stop');
    }

    restart(signal: NodeJS.Signals) {
        if (this.enable) {
            if (!this.processControl) {
                throw 'There has to a process running to soft restart!';
            } else if (this.processControl.exitCode === null) {
                this.processControl.kill(signal);
            }
        }
    }

    brutalize(process: cp.ChildProcess) {
        if (process && process.exitCode === null) {
            process.removeAllListeners();
            process.kill('SIGKILL');
        } else if (!this.enable) {
            return;
        }
        clearTimeout(this.restartTimeout);
        this.emit('killed');
    }

    private newChildProcess() {
        this.processStream = new Stream.PassThrough();
        this.processLog = readline.createInterface({
            input: this.processStream,
            output: process.stdout,
        });
        this.processLog.on('line', (line) => {
            let date = new Date();
            fs.appendFileSync(this.logPath, date.toISOString() + ': ' + line + '\n');
        });

        this.processControl = cp.fork(this.path, {
            cwd: this.cwd,
            stdio: [null, 'pipe', 'pipe', 'ipc'],
            env: {
                HTTP_PORT: this.env.httpPort.toString(),
                HTTP_PORT_PUBLIC: this.env.httpPortPublic.toString(),
                INSTALL_PATH: this.env.installPath.toString(),
                PERSISTENT_DATA_PATH: this.env.persistentDataPath.toString(),
            },
        });
        this.processControl.stderr.pipe(this.processStream);
        this.processControl.stdout.pipe(this.processStream);
        this.processControl.on('error', (err) => {
            logger.logError('Error in process ' + this.path + ': ' + err);
        });

        this.processControl.on('close', (code, signal) => {
            this.processControl.removeAllListeners();
            this.restartTimeout = setTimeout(() => {
                if (this.enable) {
                    this.newChildProcess();
                    this.emit('restart');
                }
            }, this.restartDelay);
        });
    }
}
