import * as fs from 'fs-extra';

import { Paths } from './commonData';

export enum LogPriority {
    ERROR = 0,
    WARNING = 1,
    INFO,
    DEBUG,
    HTTP,
    SILLY,
}

class CustomLogger {
    path: string;
    level: LogPriority;
    constructor(options) {
        this.path = 'path' in options ? options.path : './systemlog.txt';
        this.level = 'level' in options ? options.level : LogPriority.SILLY;
        fs.writeFileSync(this.path, '');
    }
    logError(text: string): void {
        if (this.level < LogPriority.ERROR) return;
        console.log(text);
        this._log2Path(logger.path, text);
    }
    logWarning(text: string): void {
        if (this.level < LogPriority.WARNING) return;
        console.log(text);
        this._log2Path(logger.path, text);
    }
    logInfo(text: string): void {
        if (this.level < LogPriority.INFO) return;
        console.log(text);
        this._log2Path(logger.path, text);
    }
    logHttp(text: string): void {
        if (this.level < LogPriority.HTTP) return;
        console.log(text);
        this._log2Path(logger.path, text);
    }
    logDebug(text: string): void {
        if (this.level < LogPriority.DEBUG) return;

        console.log(text);
        this._log2Path(logger.path, text);
    }
    logSilly(text: string): void {
        if (this.level < LogPriority.SILLY) return;
        console.log(text);
        this._log2Path(logger.path, text);
    }
    _log2Path(path: string, text: string): void {
        try {
            let date = new Date();
            fs.appendFileSync(path, date.toISOString() + ': ' + text + '\n');
        } catch (err) {
            console.log('Log Err: ' + err);
        }
    }
}
const logger = new CustomLogger({
    path: Paths.SYSLOG,
    level: LogPriority.HTTP,
});

export { logger };
