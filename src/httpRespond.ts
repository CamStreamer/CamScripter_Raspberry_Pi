import { ServerResponse } from 'http';
import * as fs from 'fs-extra';
import { logger } from './logger';
import { Archiver } from 'archiver';

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

export function sendArchiverResponse(
    res: ServerResponse,
    code: ResponseCode,
    file_path: string
) {
    res.setHeader('Content-Type', 'application/zip');
    let stat = fs.statSync(file_path);
    res.setHeader('Content-Length', stat.size);
    res.statusCode = code;
    let stream = fs.createReadStream(file_path);
    stream.pipe(res);
}
