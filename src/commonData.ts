import * as fs from 'fs-extra';
import { ServerResponse } from 'http';

export enum ResponseCode {
    OK = 200,
    BAD_REQ = 400,
    NOT_FOUND = 404,
    INTERNAL_ERROR = 500,
}

export function sendMessageResponse(
    res: ServerResponse,
    code: ResponseCode,
    message: string
) {
    res.setHeader('Content-Type', 'text/plain');
    res.setHeader('Access-Control-Allow-Origin', '*');
    if (code == ResponseCode.INTERNAL_ERROR) {
        logger.logError(message);
    } else if (code != ResponseCode.OK) {
        logger.logWarning(message);
    }
    res.statusCode = code;
    res.end(message);
}

export function sendJsonResponse(
    res: ServerResponse,
    code: ResponseCode,
    json_obj: object
) {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');
    let message = JSON.stringify(json_obj);
    if (code == ResponseCode.INTERNAL_ERROR) {
        logger.logError(message);
    } else if (code != ResponseCode.OK) {
        logger.logWarning(message);
    }
    res.statusCode = code;
    res.end(message);
}

export function sendParamResponse(
    res: ServerResponse,
    code: ResponseCode,
    param_name: string,
    json_obj: object
) {
    res.setHeader('Content-Type', 'text/plain');
    res.setHeader('Access-Control-Allow-Origin', '*');
    let data = param_name + '=' + JSON.stringify(json_obj);
    res.statusCode = code;
    res.end(data);
}

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

export enum Paths {
    SYSLOG = './systemlog.txt',
    PACKAGE = './package.json',
}

const logger = new CustomLogger({
    path: Paths.SYSLOG,
    level: LogPriority.HTTP,
});

export { logger };

export function getVersion(): string[] {
    if (fs.existsSync(Paths.PACKAGE)) {
        let raw_pckg = fs.readFileSync(Paths.PACKAGE);
        let pckg = JSON.parse(raw_pckg.toString());
        return pckg['version'].split('.');
    }
    throw 'No version file found!';
}

export type Enviroment = {
    http_socket: number;
    http_socket_public: number;
    persistent_data_path: string;
    install_path: string;
};
