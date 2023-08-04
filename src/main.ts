import * as archiver from 'archiver';
import { Fields, Files } from 'formidable';
import * as fs from 'fs-extra';
import { IncomingMessage, OutgoingHttpHeaders, ServerResponse } from 'http';
import * as http_proxy from 'http-proxy';
import * as path from 'path';
import * as yauzl from 'yauzl';

import { getVersion, Paths } from './commonData';
import { HttpProxy, Target } from './httpProxy';
import {
    ResponseCode,
    sendFileResponse,
    sendJsonResponse,
    sendMessageResponse,
    sendParamResponse,
} from './httpRespond';
import { HttpServer } from './httpServer';
import { logger } from './logger';
import { PackageManager } from './packageManager';
import { ParamManager } from './paramManager';

const extMap = {
    '.htm': 'text/html',
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.wav': 'audio/wav',
    '.mp3': 'audio/mpeg',
    '.ico': 'image/x-icon',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.bmp': 'image/bmp',
    '.svg': 'image/svg+xml',
    '.tif': 'image/tiff',
    '.tiff': 'image/tiff',
    '.json': 'application/json',
    '.pdf': 'application/pdf',
    '.doc': 'application/msword',
    '.otf': 'font/otf',
    '.ttf': 'font/sfnt',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
};

const pckgManager = new PackageManager(`${process.cwd()}/packages`, `${process.cwd()}/logs`, getVersion());
const paramManager = new ParamManager(`${process.cwd()}/params`);

const httpServer = new HttpServer();
const aliases = {
    '/': '/settings.html',
    '/local/camscripter/settings.html': '/settings.html',
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
                    const headers: OutgoingHttpHeaders = {
                        'Content-Length': read[0].size,
                    };
                    if (extMap[parsed.ext]) {
                        headers['Content-Type'] = extMap[parsed.ext];
                    }
                    res.writeHead(ResponseCode.OK, headers);
                    read[1].pipe(res);
                } else {
                    sendMessageResponse(res, ResponseCode.NOT_FOUND, `HTTPApi: file ${filePath} not found`);
                }
            } else {
                sendMessageResponse(res, ResponseCode.NOT_FOUND, `HTTPApi: package ${pckgName} not found`);
            }
        }
    } else {
        let filePath = `./html${path.normalize(req.url)}`;
        if (req.url in aliases) {
            filePath = `./html${path.normalize(aliases[req.url])}`;
        }
        const parsed = path.parse(filePath);
        if (fs.pathExistsSync(filePath)) {
            sendFileResponse(res, ResponseCode.OK, extMap[parsed.ext], filePath);
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

httpServer.registerDataCGI('/package/data.cgi', async (url, req, res, files: Files, fields: Fields) => {
    const pckgName = url.searchParams.get('package_name');
    const action = url.searchParams.get('action');
    const compressionLevel = parseInt(url.searchParams.get('compression_level'));

    if (!(pckgName in pckgManager.packages)) {
        sendMessageResponse(res, ResponseCode.BAD_REQ, `Package ${pckgName} doesn't exist`);
        return;
    }

    const pckg = pckgManager.packages[pckgName];
    const localdataPath = pckg.envVars.persistentDataPath;
    switch (action) {
        case 'IMPORT':
            let returnCode = ResponseCode.OK;
            let returnMessage = 'OK';
            for (let i in files) {
                const fileName = path.parse(files[i]['name']);
                const filePath = files[i]['path'];
                const tmpPckgDir = `${process.cwd()}/tmp_data/${fileName.name}`;
                try {
                    if (fileName.ext === '.zip') {
                        logger.logInfo(`HTTPApi: localdata imported under name ${fileName.base}`);
                        await fs.remove(tmpPckgDir);
                        await extractArchive(filePath, tmpPckgDir);
                        await fs.remove(localdataPath);
                        await fs.copy(tmpPckgDir, localdataPath);
                        logger.logDebug(`Data imported for package ${pckgName}`);
                    } else {
                        logger.logWarning(
                            'HTTPApi: package/data.cgi wrong extension recieved. Only zip archive is allowed.'
                        );
                    }
                } catch (err) {
                    returnCode = ResponseCode.INTERNAL_ERROR;
                    returnMessage = err.message;
                } finally {
                    fs.remove(tmpPckgDir);
                    fs.remove(filePath);
                }
            }
            sendMessageResponse(res, returnCode, returnMessage);
            break;
        case 'EXPORT':
            const archie = archiver('zip', {
                zlib: { level: compressionLevel || 9 },
            });
            const zipFilePath = `${process.cwd()}/tmp/${pckgName}_localdata.zip`;
            const output = fs.createWriteStream(zipFilePath);
            output.on('close', async () => {
                logger.logDebug(`Data archive for package ${pckgName} created: ${archie.pointer()}B`);
                sendFileResponse(res, ResponseCode.OK, 'application/zip', zipFilePath);
                await fs.remove(zipFilePath);
            });
            archie.pipe(output);
            archie.directory(localdataPath, false);
            await archie.finalize();
            break;
        default:
            sendMessageResponse(res, ResponseCode.BAD_REQ, 'Invalid action');
    }
});

httpServer.registerRequestCGI('/package/settings.cgi', (url, req, res) => {
    const pckgName = url.searchParams.get('package_name');
    const action = url.searchParams.get('action');
    if (!pckgName || !action) {
        sendMessageResponse(res, ResponseCode.BAD_REQ, 'Crucial attributes missing!');
    } else {
        switch (action) {
            case 'get':
                if (pckgManager.contains(pckgName)) {
                    const pckg = pckgManager.packages[pckgName];
                    sendJsonResponse(res, ResponseCode.OK, pckg.getSettings());
                } else {
                    sendMessageResponse(res, ResponseCode.NOT_FOUND, 'Package not found');
                }
                break;
            case 'set':
                if (pckgManager.contains(pckgName)) {
                    try {
                        let settingsData = [];
                        req.on('data', (chunk) => {
                            settingsData.push(chunk);
                        });
                        req.on('end', () => {
                            const pckg = pckgManager.packages[pckgName];
                            pckg.setSettings(JSON.parse(Buffer.concat(settingsData).toString()));
                            sendMessageResponse(res, ResponseCode.OK, 'OK');
                        });
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
    const target: Target = {
        protocol: req.headers['x-target-camera-protocol'] as string,
        host: req.headers['x-target-camera-ip'] as string,
        port: parseInt(req.headers['x-target-camera-port'] as string),
        path: req.headers['x-target-camera-path'] as string,
        username: req.headers['x-target-camera-user'] as string,
        password: req.headers['x-target-camera-pass'] as string,
    };
    delete req.headers['x-target-camera-protocol'];
    delete req.headers['x-target-camera-ip'];
    delete req.headers['x-target-camera-port'];
    delete req.headers['x-target-camera-path'];
    delete req.headers['x-target-camera-user'];
    delete req.headers['x-target-camera-pass'];

    const proxy = new HttpProxy();
    proxy.request(target, req, res);
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
