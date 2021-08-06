import * as cp from 'child_process';
import { EventEmitter } from 'events';
import { WriteStream } from 'fs';
import * as fs from 'fs-extra';
import * as readline from 'readline';
import { Duplex, Readable, Stream } from 'stream';

import { Enviroment } from './commonData';
import { logger } from './logger';

type MonitorOptions = {
    env: Enviroment;
    cwd: string;
    restart_delay: number;
    spin_time?: number;
    log_path: string;
};

export class CamScripterMonitor extends EventEmitter {
    path: string;
    restart_delay: number;
    spin_time: number;
    enable: boolean;
    env: Enviroment;
    cwd: string;
    log_path: string;
    process_control: cp.ChildProcess;
    process_stream: Duplex;
    process_log: readline.ReadLine;
    file_stream: WriteStream;
    timeout: NodeJS.Timeout;
    constructor(path: string, options: MonitorOptions) {
        super();
        this.enable = false;
        this.path = path;
        this.env = options.env;
        this.cwd = options.cwd;
        this.restart_delay = options.restart_delay; //ms
        this.spin_time = options.spin_time;
        this.log_path = options.log_path;
    }

    start() {
        if (this.enable) {
            throw 'Process was already set to run';
        } else {
            this._newChildProcess();
            this.enable = true;
            this.emit('start');
        }
    }
    stop() {
        if (this.process_control && this.process_control.exitCode === null) {
            this.process_control.removeAllListeners();
            this.process_control.kill('SIGTERM');
            clearTimeout(this.timeout);
            this.enable = false;
            let current_process = this.process_control;
            let murder_timeout = setTimeout(() => {
                this.brutalize(current_process);
            }, 1500);
        } else if (this.process_control && this.enable) {
            clearTimeout(this.timeout);
            this.enable = false;
        } else {
            throw 'This process has been set to stop';
        }
        this.emit('stop');
    }

    restart(signal: NodeJS.Signals) {
        if (this.enable) {
            if (!this.process_control) {
                throw 'There has to a process running to soft restart!';
            } else if (this.process_control.exitCode === null) {
                this.process_control.kill(signal);
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
        clearTimeout(this.timeout);
        this.emit('killed');
    }

    _newChildProcess() {
        this.process_stream = new Stream.PassThrough();
        this.process_log = readline.createInterface({
            input: this.process_stream,
            output: process.stdout,
        });
        this.process_log.on('line', (line) => {
            let date = new Date();
            fs.appendFileSync(
                this.log_path,
                date.toISOString() + ': ' + line + '\n'
            );
        });

        this.process_control = cp.fork(this.path, {
            cwd: this.cwd,
            stdio: [null, 'pipe', 'pipe', 'ipc'],
            env: {
                HTTP_PORT: this.env.http_socket.toString(),
                HTTP_PORT_PUBLIC: this.env.http_socket_public.toString(),
                INSTALL_PATH: this.env.install_path.toString(),
                PERSISTENT_DATA_PATH: this.env.persistent_data_path.toString(),
            },
        });
        this.process_control.stderr.pipe(this.process_stream);
        this.process_control.stdout.pipe(this.process_stream);
        this.process_control.on('error', (err) => {
            logger.logError('Error in process ' + this.path + ': ' + err);
        });

        this.process_control.on('close', (code, signal) => {
            this.process_control.removeAllListeners();
            this.timeout = setTimeout(() => {
                if (this.enable) {
                    this._newChildProcess();
                    this.emit('restart');
                }
            }, this.restart_delay);
        });
    }
}
