import * as archiver from 'archiver';
import { Fields, Files } from 'formidable';
import * as fs from 'fs-extra';
import { IncomingMessage, ServerResponse } from 'http';
import * as http_proxy from 'http-proxy';
import * as path from 'path';
import * as yauzl from 'yauzl';

import { getVersion, Paths } from './commonData';
import {
    ResponseCode,
    sendArchiverResponse,
    sendJsonResponse,
    sendMessageResponse,
    sendParamResponse,
} from './httpRespond';
import { HttpServer } from './httpServer';
import { logger } from './logger';
import { PackageManager } from './packageManager';
import { ParamManager } from './paramManager';

const extMap = {
    '.ico': 'image/x-icon',
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.json': 'application/json',
    '.css': 'text/css',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.wav': 'audio/wav',
    '.mp3': 'audio/mpeg',
    '.svg': 'image/svg+xml',
    '.pdf': 'application/pdf',
    '.doc': 'application/msword',
    '.ttf': 'font/sfnt',
};

const pckgManager = new PackageManager(process.cwd() + '/packages', getVersion());
const paramManager = new ParamManager(process.cwd() + '/params/');

const httpServer = new HttpServer();
const aliases = {
    '/': '/settings.html',
};

httpServer.on('filerequest', (req: IncomingMessage, res: ServerResponse) => {
    if (req.url.match(/package/)) {
        let startIndex = req.url.search(/package/);
        let url = req.url.slice(startIndex);
        let folders = url.split('/');
        if (folders.length <= 2) {
            sendMessageResponse(res, ResponseCode.BAD_REQ, 'HTTPApi: invalid request');
        } else {
            let pckgName = folders[1];
            let filePath = '/' + folders.slice(2).join('/');
            if (pckgManager.contains(pckgName)) {
                let parsed = path.parse(filePath);
                let read = pckgManager.packages[pckgName].accessOnlineFile(filePath);
                if (read) {
                    res.writeHead(ResponseCode.OK, {
                        'Content-Type': extMap[parsed.ext],
                        'Content-Length': read[0].size,
                    });
                    read[1].pipe(res);
                } else {
                    sendMessageResponse(res, ResponseCode.NOT_FOUND, `HTTPApi: file ${filePath} not found`);
                }
            } else {
                sendMessageResponse(res, ResponseCode.NOT_FOUND, `HTTPApi: package ${pckgName} not found`);
            }
        }
    } else {
        let filePath =
            req.url in aliases ? './html' + path.normalize(aliases[req.url]) : './html' + path.normalize(req.url);
        let parsed = path.parse(filePath);
        if (fs.pathExistsSync(filePath)) {
            let stat = fs.statSync(filePath);
            res.writeHead(ResponseCode.OK, {
                'Content-Type': extMap[parsed.ext],
                'Content-Length': stat.size,
            });
            let readStream = fs.createReadStream(filePath);
            readStream.pipe(res);
        } else {
            sendMessageResponse(res, ResponseCode.NOT_FOUND, `HTTPApi: file ${filePath} not found`);
        }
    }
});

httpServer.on('proxy', (req: IncomingMessage, res: ServerResponse, isPublic: boolean) => {
    const pathItems = req.url.split('/');
    const proxyIndex = pathItems.indexOf('proxy');
    if (proxyIndex === -1 || pathItems.length < proxyIndex + 2) {
        sendMessageResponse(res, ResponseCode.INTERNAL_ERROR, `Wrong proxy format`);
    } else {
        const packageName = pathItems[proxyIndex + 1];
        if (packageName in pckgManager.packages) {
            let targetPort: number;
            if (isPublic) {
                targetPort = pckgManager.packages[packageName].envVars.httpPortPublic;
            } else {
                targetPort = pckgManager.packages[packageName].envVars.httpPort;
            }
            const targetPath = '/' + pathItems.slice(proxyIndex + 2).join('/');
            const proxy = http_proxy.createProxyServer();
            proxy.web(req, res, {
                target: `http://localhost:${targetPort}${targetPath}`,
                ignorePath: true,
            });
        } else {
            sendMessageResponse(res, ResponseCode.NOT_FOUND, `Cannot find package to proxy`);
        }
    }
});

httpServer.registerDataCGI('/param.cgi', (url, req, res, files, fields) => {
    let action = url.searchParams.get('action') || fields['action'].toString();
    switch (action) {
        case 'update':
            for (let f in fields) {
                if (f === 'action') continue;
                let splitted = f.toLowerCase().split('.');
                if (splitted[0] != 'camscripter' || splitted.length !== 2) {
                    sendMessageResponse(res, ResponseCode.BAD_REQ, 'Vapix-Sim: Unsupported parameters');
                } else {
                    let paramName = splitted[1];
                    let value = fields[f];
                    if (typeof value === 'string') paramManager.update(paramName, JSON.parse(value));
                }
            }
            sendMessageResponse(res, ResponseCode.OK, 'OK');
            break;

        case 'list':
            let groupName = url.searchParams.get('group').toLowerCase();
            let splitted = groupName.split('.');
            if (splitted[0] != 'camscripter' || splitted.length !== 2) {
                sendMessageResponse(res, ResponseCode.BAD_REQ, 'Vapix-Sim: Unsupported parameters');
            } else {
                let paramName = splitted[1];
                sendParamResponse(res, ResponseCode.OK, groupName, paramManager.get(paramName));
            }
            break;
        default:
            sendMessageResponse(res, ResponseCode.BAD_REQ, 'Vapix-Sim: Unsupported action');
    }
});

httpServer.registerRequestCGI('/systemlog.cgi', (url, req, res) => {
    const pckgName = url.searchParams.get('package_name');
    if (pckgName) {
        if (pckgName === 'system') {
            const filePath = Paths.SYSLOG;
            if (fs.pathExistsSync(filePath)) {
                const stat = fs.statSync(filePath);
                res.writeHead(ResponseCode.OK, {
                    'Content-Type': 'text/plain',
                    'Content-Length': stat.size,
                });
                const readStream = fs.createReadStream(filePath, { end: stat.size });
                readStream.pipe(res);
            } else {
                sendMessageResponse(res, ResponseCode.NOT_FOUND, 'Vapix-Sim - file not found');
            }
        } else if (pckgManager.contains(pckgName)) {
            const logFile = pckgManager.packages[pckgName].accessLogFile();
            if (logFile) {
                res.writeHead(ResponseCode.OK, {
                    'Content-Type': 'text/plain',
                    'Content-Length': logFile.stat.size,
                });
                logFile.stream.pipe(res);
            } else {
                res.writeHead(ResponseCode.OK, {
                    'Content-Type': 'text/plain',
                    'Content-Length': 0,
                });
                res.end();
            }
        } else {
            sendMessageResponse(res, ResponseCode.BAD_REQ, 'Vapix-Sim: Uknown package');
        }
    } else {
        sendMessageResponse(res, ResponseCode.BAD_REQ, 'Vapix-Sim: No valid systemlog selected');
    }
});

httpServer.registerRequestCGI('/version.cgi', (url, req, res) => {
    sendMessageResponse(res, ResponseCode.OK, getVersion().join('.'));
});

httpServer.registerDataCGI('/package/install.cgi', async (url, req, res, files: Files, fields: Fields) => {
    let returnCode = ResponseCode.OK;
    let returnMessage = 'OK';
    for (let i in files) {
        const name = path.parse(files[i]['name']);
        const fpath = files[i]['path'];
        if (name.ext === '.zip') {
            try {
                logger.logInfo('HTTPApi: Install request ' + name.base);
                const tmpPckgDir = process.cwd() + '/tmp_pckgs/' + name.name;
                await fs.remove(tmpPckgDir);
                await extractArchive(fpath, tmpPckgDir);
                await pckgManager.installPackage(process.cwd() + '/tmp_pckgs/' + name.name);
            } catch (err) {
                console.log(err);
                returnCode = ResponseCode.INTERNAL_ERROR;
                returnMessage = err.message;
            } finally {
                await fs.remove(process.cwd() + '/tmp_pckgs/' + name.name);
                await fs.remove(fpath);
            }
        } else {
            logger.logError('HTTPApi: wrong extention recieved ');
            await fs.remove(fpath);
        }
    }
    sendMessageResponse(res, returnCode, returnMessage);
});

httpServer.registerRequestCGI('/package/remove.cgi', (url, req, res) => {
    try {
        let pckgName = url.searchParams.get('package_name');
        if (!pckgName) {
            sendJsonResponse(res, ResponseCode.BAD_REQ, {
                message: 'No name provided!',
            });
        } else if (pckgManager.contains(pckgName)) {
            pckgManager.uninstallPackage(pckgName);
            sendJsonResponse(res, ResponseCode.OK, {});
        } else {
            sendJsonResponse(res, ResponseCode.NOT_FOUND, { message: 'Not Found' });
        }
    } catch (err) {
        console.log(err);
        sendJsonResponse(res, ResponseCode.NOT_FOUND, { message: `Package uninstall error: ${err.message}` });
    }
});

httpServer.registerRequestCGI('/package/list.cgi', (url, req, res) => {
    try {
        sendJsonResponse(res, ResponseCode.OK, pckgManager.listManifests());
    } catch (err) {
        console.log(err);
        sendJsonResponse(res, ResponseCode.NOT_FOUND, { message: `Package list error: ${err.message}` });
    }
});

httpServer.registerDataCGI('/package/ldata.cgi', async (url, req, res, files: Files, fields: Fields) => {
    let pckgName = url.searchParams.get('package_name');
    let action = url.searchParams.get('action');
    let compressionLevel = parseInt(url.searchParams.get('compression_level'));
    switch (action) {
        case 'IMPORT':
            let returnCode = ResponseCode.OK;
            let returnMessage = 'OK';
            for (let i in files) {
                let name = path.parse(files[i]['name']);
                let fpath = files[i]['path'];
                if (name.ext === '.zip') {
                    try {
                        logger.logInfo('HTTPApi: localdata imported under name ' + name.base);
                        const tmpPckgDir = process.cwd() + '/tmp_data/' + name.name;
                        await fs.remove(tmpPckgDir);
                        await extractArchive(fpath, tmpPckgDir);
                        let pckg = pckgManager.packages[pckgName];
                        let localdataPath = pckg.envVars.persistentDataPath;
                        fs.removeSync(localdataPath);
                        fs.copySync(process.cwd() + '/tmp_data/' + name.name, localdataPath);
                    } catch (err) {
                        returnCode = ResponseCode.INTERNAL_ERROR;
                        returnMessage = err;
                    } finally {
                        fs.removeSync(process.cwd() + '/tmp_data/' + name.name);
                    }
                } else {
                    logger.logError('HTTPApi: wrong extention recieved ');
                }
                fs.removeSync(fpath);
            }
            sendMessageResponse(res, returnCode, returnMessage);
            break;
        case 'EXPORT':
            let archie = archiver('zip', {
                zlib: { level: compressionLevel },
            });
            let pckg = pckgManager.packages[pckgName];
            let localdataPath = pckg.envVars.persistentDataPath;
            archie.directory(localdataPath, false);
            await sendArchiverResponse(res, ResponseCode.OK, archie);
            break;
        default:
            sendMessageResponse(res, ResponseCode.BAD_REQ, 'Invalid action');
    }
});

httpServer.registerDataCGI('/package/settings.cgi', (url, req, res, files, fields) => {
    let pckgName = url.searchParams.get('package_name');
    let action = url.searchParams.get('action');
    if (!pckgName || !action) {
        sendMessageResponse(res, ResponseCode.BAD_REQ, 'Crucial attributes missing!');
    } else {
        switch (action) {
            case 'get':
                if (pckgManager.contains(pckgName)) {
                    let pack = pckgManager.packages[pckgName];
                    sendJsonResponse(res, ResponseCode.OK, pack.getSettings());
                } else {
                    sendMessageResponse(res, ResponseCode.NOT_FOUND, 'Package not found');
                }
                break;
            case 'set':
                if (pckgManager.contains(pckgName)) {
                    try {
                        let pack = pckgManager.packages[pckgName];
                        for (let i in fields) {
                            pack.setSettings(JSON.parse(i));
                        }
                        sendMessageResponse(res, ResponseCode.OK, 'OK');
                    } catch (err) {
                        logger.logError(err);
                        sendMessageResponse(res, ResponseCode.INTERNAL_ERROR, 'File Writing Error');
                    }
                } else {
                    sendMessageResponse(res, ResponseCode.NOT_FOUND, 'Package not found');
                }
                break;
            default:
                sendMessageResponse(res, ResponseCode.BAD_REQ, 'Invalid action');
        }
    }
});

httpServer.registerRequestCGI('/proxy.cgi', async (url, req, res) => {
    const targetProtocol = req.headers['x-target-camera-protocol'];
    const targetIp = req.headers['x-target-camera-ip'] as string;
    const targetPort = req.headers['x-target-camera-port'] as string;
    const targetUser = req.headers['x-target-camera-user'] as string;
    const targetPass = req.headers['x-target-camera-pass'] as string;
    const targetPath = req.headers['x-target-camera-path'] as string;

    const proxy = http_proxy.createProxyServer();
    proxy.web(req, res, {
        target: `${targetProtocol}://${targetIp}:${targetPort}${targetPath}`,
        auth: `${targetUser}:${targetPass}`,
        ignorePath: true,
    });

    proxy.on('proxyRes', function (proxyRes, req, res) {
        if (proxyRes.statusCode === 401) {
            proxyRes.statusCode = 400;
            proxyRes.statusMessage = 'Bad Request';
        }
    });
});

function extractArchive(archive: string, dirName: string) {
    return new Promise<void>((resolve) => {
        yauzl.open(archive, { lazyEntries: true }, (error, zip) => {
            zip.on('end', () => {
                resolve();
            });
            zip.on('entry', (entry) => {
                zip.openReadStream(entry, (error, readStream) => {
                    if (error) {
                        return zip.emit('error', error);
                    }

                    // Save current entry. Then read next.
                    const filePath = path.join(dirName, entry.fileName);
                    if (filePath.lastIndexOf('/') === filePath.length - 1) {
                        fs.mkdirSync(filePath, { recursive: true });
                        zip.readEntry();
                        return;
                    }

                    const parsedPath = path.parse(filePath);
                    fs.mkdir(parsedPath.dir, { recursive: true }, (error) => {
                        if (error) {
                            return zip.emit('error', error);
                        }

                        const mode = entry.externalFileAttributes >>> 16;
                        const options = mode !== 0 ? { mode } : {}; // Preserve file attributes on Unix systems
                        const outputStream = fs.createWriteStream(filePath, options);
                        outputStream.on('error', (error) => {
                            zip.emit('error', error);
                        });
                        outputStream.on('finish', () => {
                            zip.readEntry();
                        });

                        readStream.on('error', (error) => {
                            zip.emit('error', error);
                        });
                        readStream.pipe(outputStream);
                    });
                });
            });

            zip.readEntry();
        });
    });
}

process.on('uncaughtException', (err) => {
    logger.logError('uncaughtException: ' + err.stack ?? err.toString());
});

process.on('unhandledRejection - ', (err: Error) => {
    logger.logError('unhandledRejection: ' + err.stack ?? err.toString());
});

paramManager.on('ready', () => {
    marry(pckgManager, paramManager);
});
pckgManager.on('ready', () => {
    marry(pckgManager, paramManager);
});

async function marry(pckgManager: PackageManager, paramManager: ParamManager) {
    if (pckgManager.ready && paramManager.ready) {
        pckgManager.connect(paramManager.params['packageconfigurations']);
        logger.logInfo('Starting Camscripter Server');
        httpServer.start(52520);
        logger.logInfo('Camscripter listening on 0.0.0.0:52520');
    }
}
