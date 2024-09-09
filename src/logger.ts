import * as fs from 'fs-extra';

import { Paths } from './commonData';

export enum LogLevel {
    ERROR = 0,
    WARNING,
    INFO,
    DEBUG,
    VERBOSE,
}

export type LoggerOptions = {
    path: string;
    level: LogLevel;
    maxFileSizeBytes?: number;
};

export function errToString(err: unknown) {
    if (err instanceof Error) {
        return err.stack ?? err.toString();
    } else {
        return 'Unknown error';
    }
}

export class CustomLogger {
    private lastLogSizeCheck?: number;

    constructor(private options: LoggerOptions) {}

    logError(text: string): void {
        if (this.options.level < LogLevel.ERROR) {
            return;
        }
        console.log(text);
        this.log2File(text);
    }

    logWarning(text: string): void {
        if (this.options.level < LogLevel.WARNING) {
            return;
        }
        console.log(text);
        this.log2File(text);
    }

    logInfo(text: string): void {
        if (this.options.level < LogLevel.INFO) {
            return;
        }
        console.log(text);
        this.log2File(text);
    }

    logDebug(text: string): void {
        if (this.options.level < LogLevel.DEBUG) {
            return;
        }

        console.log(text);
        this.log2File(text);
    }

    logVerbose(text: string): void {
        if (this.options.level < LogLevel.VERBOSE) {
            return;
        }
        console.log(text);
        this.log2File(text);
    }

    private log2File(text: string): void {
        try {
            if (
                this.options.maxFileSizeBytes !== undefined &&
                (this.lastLogSizeCheck === undefined || Date.now() - this.lastLogSizeCheck >= 3600 * 1000)
            ) {
                this.lastLogSizeCheck = Date.now();
                const stat = fs.statSync(this.options.path, { throwIfNoEntry: false });
                if (stat && stat.size > this.options.maxFileSizeBytes) {
                    fs.truncateSync(this.options.path, this.options.maxFileSizeBytes);
                }
            }
            fs.appendFileSync(this.options.path, this.getIsoLocalString() + ': ' + text + '\n');
        } catch (err) {
            console.log('Log Err: ' + err);
        }
    }

    private getIsoLocalString() {
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
    level: LogLevel.DEBUG,
    maxFileSizeBytes: 5 * 1024 * 1024,
});

export { logger };
