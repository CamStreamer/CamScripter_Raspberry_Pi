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

export class CustomLogger {
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
        this.log2Path(logger.path, text);
    }

    logWarning(text: string): void {
        if (this.level < LogPriority.WARNING) return;
        console.log(text);
        this.log2Path(logger.path, text);
    }

    logInfo(text: string): void {
        if (this.level < LogPriority.INFO) return;
        console.log(text);
        this.log2Path(logger.path, text);
    }

    logHttp(text: string): void {
        if (this.level < LogPriority.HTTP) return;
        console.log(text);
        this.log2Path(logger.path, text);
    }

    logDebug(text: string): void {
        if (this.level < LogPriority.DEBUG) return;

        console.log(text);
        this.log2Path(logger.path, text);
    }

    logSilly(text: string): void {
        if (this.level < LogPriority.SILLY) return;
        console.log(text);
        this.log2Path(logger.path, text);
    }

    private log2Path(path: string, text: string): void {
        try {
            fs.appendFileSync(path, CustomLogger.getIsoLocalString() + ': ' + text + '\n');
        } catch (err) {
            console.log('Log Err: ' + err);
        }
    }

    static getIsoLocalString() {
        const date = new Date();
        let isoLocalString = date
            .toLocaleString('sv', {
                year: 'numeric',
                month: 'numeric',
                day: 'numeric',
                hour: 'numeric',
                minute: 'numeric',
                second: 'numeric',
            })
            .replace(' ', 'T');
        isoLocalString += '.' + date.getMilliseconds();
        return isoLocalString;
    }
}

const logger = new CustomLogger({
    path: Paths.SYSLOG,
    level: LogPriority.HTTP,
});

export { logger };
