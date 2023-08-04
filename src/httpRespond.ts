import * as fs from 'fs-extra';
import { ServerResponse } from 'http';

import { logger } from './logger';

export enum ResponseCode {
    OK = 200,
    BAD_REQ = 400,
    NOT_FOUND = 404,
    INTERNAL_ERROR = 500,
}

export function sendMessageResponse(res: ServerResponse, code: ResponseCode, message: string) {
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

export function sendJsonResponse(res: ServerResponse, code: ResponseCode, jsonObj: object) {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');
    let message = JSON.stringify(jsonObj);
    if (code == ResponseCode.INTERNAL_ERROR) {
        logger.logError(message);
    } else if (code != ResponseCode.OK) {
        logger.logWarning(message);
    }
    res.statusCode = code;
    res.end(message);
}

export function sendParamResponse(res: ServerResponse, code: ResponseCode, paramName: string, jsonObj: object) {
    res.setHeader('Content-Type', 'text/plain');
    res.setHeader('Access-Control-Allow-Origin', '*');
    let data = paramName + '=' + JSON.stringify(jsonObj);
    res.statusCode = code;
    res.end(data);
}

export function sendFileResponse(res: ServerResponse, code: ResponseCode, contentType: string, filePath: string) {
    const stat = fs.statSync(filePath);
    res.writeHead(code, {
        'Content-Type': contentType,
        'Content-Length': stat.size,
    });
    const readStream = fs.createReadStream(filePath);
    readStream.pipe(res);
}
