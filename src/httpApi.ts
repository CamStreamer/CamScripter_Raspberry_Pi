import * as archiver from 'archiver';
import * as formidable from 'formidable';
import * as fs from 'fs-extra';
import { IncomingMessage, OutgoingHttpHeaders, ServerResponse } from 'http';
import * as http_proxy from 'http-proxy';
import * as path from 'path';
import { URL } from 'url';
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
import { errToString, logger } from './logger';
import { PackageManager } from './packageManager';
import { ParamManager } from './paramManager';
import { MdnsResponse, Zeroconf } from './zeroconf';

const extMap: Record<string, string> = {
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

export class HttpApi {
    private readonly aliases: Record<string, string> = {
        '/': '/settings.html',
    };

    constructor(host: string, port: number, private pckgManager: PackageManager, private paramManager: ParamManager) {
        const httpServer = new HttpServer();

        httpServer.on('filerequest', this.onFileRequest.bind(this));
        httpServer.on('proxy', this.onProxyRequest.bind(this));
        httpServer.registerDataCGI('/param.cgi', this.onParamRequest.bind(this));
        httpServer.registerRequestCGI('/systemlog.cgi', this.onSystemLogRequest.bind(this));
        httpServer.registerRequestCGI('/version.cgi', this.onVersionRequest.bind(this));
        httpServer.registerDataCGI('/package/install.cgi', this.onPackageInstallRequest.bind(this));
        httpServer.registerRequestCGI('/package/remove.cgi', this.onPackageRemoveRequest.bind(this));
        httpServer.registerRequestCGI('/package/list.cgi', this.onPackageListRequest.bind(this));
        httpServer.registerDataCGI('/package/data.cgi', this.onPackageDataRequest.bind(this));
        httpServer.registerRequestCGI('/package/settings.cgi', this.onPackageSettingsRequest.bind(this));
        httpServer.registerRequestCGI('/proxy.cgi', this.onCameraProxyRequest.bind(this));
        httpServer.registerRequestCGI('/network_camera_list.cgi', this.onNetworkCameraListRequest.bind(this));

        httpServer.start(host, port);
    }

    private onFileRequest(req: IncomingMessage, res: ServerResponse) {
        if (req.url === undefined) {
            sendMessageResponse(res, ResponseCode.BAD_REQ, 'HTTPApi: invalid request');
            return;
        }

        if (req.url.match(/\/package\//)) {
            const startIndex = req.url.search(/package/);
            const url = req.url.slice(startIndex);
            const folders = url.split('/');
            if (folders.length <= 2) {
                sendMessageResponse(res, ResponseCode.BAD_REQ, 'HTTPApi: invalid request');
            } else {
                const pckgName = folders[1];
                const filePath = '/' + folders.slice(2).join('/');
                if (this.pckgManager.contains(pckgName)) {
                    const parsed = path.parse(filePath);
                    const read = this.pckgManager.getPackages()[pckgName].accessOnlineFile(filePath);
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
            if (req.url in this.aliases) {
                filePath = `./html${path.normalize(this.aliases[req.url])}`;
            } else if (req.url.indexOf('/camscripter/') !== -1) {
                filePath = `./html${path.normalize(req.url.substring(req.url.indexOf('/camscripter/') + 12))}`;
            }

            const parsed = path.parse(filePath);
            if (fs.pathExistsSync(filePath)) {
                sendFileResponse(res, ResponseCode.OK, extMap[parsed.ext], filePath);
            } else {
                sendMessageResponse(res, ResponseCode.NOT_FOUND, `HTTPApi: file ${filePath} not found`);
            }
        }
    }

    private onProxyRequest(req: IncomingMessage, res: ServerResponse, isPublic: boolean) {
        if (req.url === undefined) {
            sendMessageResponse(res, ResponseCode.BAD_REQ, 'HTTPApi: invalid request');
            return;
        }

        const pathItems = req.url.split('/');
        const proxyIndex = pathItems.indexOf('proxy');
        if (proxyIndex === -1 || pathItems.length < proxyIndex + 2) {
            sendMessageResponse(res, ResponseCode.INTERNAL_ERROR, `Wrong proxy format`);
        } else {
            const packages = this.pckgManager.getPackages();
            const packageName = pathItems[proxyIndex + 1];
            if (packageName in packages) {
                let targetPort: number;
                if (isPublic) {
                    targetPort = packages[packageName].envVars.httpPortPublic;
                } else {
                    targetPort = packages[packageName].envVars.httpPort;
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
    }

    private onParamRequest(
        url: URL,
        req: IncomingMessage,
        res: ServerResponse,
        files: formidable.Files,
        fields: formidable.Fields
    ) {
        const action = url.searchParams.get('action') ?? fields['action'].toString();
        switch (action) {
            case 'update': {
                for (const f in fields) {
                    if (f === 'action') {
                        continue;
                    }
                    const splitted = f.toLowerCase().split('.');
                    if (splitted[0] !== 'camscripter' || splitted.length !== 2) {
                        sendMessageResponse(res, ResponseCode.BAD_REQ, 'Vapix-Sim: Unsupported parameters');
                    } else {
                        const paramName = splitted[1];
                        const value = fields[f];
                        if (typeof value === 'string') {
                            this.paramManager.update(paramName, JSON.parse(value));
                        }
                    }
                }
                sendMessageResponse(res, ResponseCode.OK, 'OK');
                break;
            }
            case 'list': {
                const groupName = url.searchParams.get('group')?.toLowerCase() ?? '';
                const splitted = groupName.split('.');
                if (splitted[0] !== 'camscripter' || splitted.length !== 2) {
                    sendMessageResponse(res, ResponseCode.BAD_REQ, 'Vapix-Sim: Unsupported parameters');
                } else {
                    const paramName = splitted[1];
                    sendParamResponse(res, ResponseCode.OK, groupName, this.paramManager.get(paramName));
                }
                break;
            }
            default: {
                sendMessageResponse(res, ResponseCode.BAD_REQ, 'Vapix-Sim: Unsupported action');
            }
        }
    }

    private onSystemLogRequest(url: URL, req: IncomingMessage, res: ServerResponse) {
        const pckgName = url.searchParams.get('package_name');
        if (pckgName !== null) {
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
            } else if (this.pckgManager.contains(pckgName)) {
                const logFile = this.pckgManager.getPackages()[pckgName].accessLogFile();
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
    }

    private onVersionRequest(url: URL, req: IncomingMessage, res: ServerResponse) {
        sendMessageResponse(res, ResponseCode.OK, getVersion().join('.'));
    }

    private async onPackageInstallRequest(
        url: URL,
        req: IncomingMessage,
        res: ServerResponse,
        files: formidable.Files,
        fields: formidable.Fields
    ) {
        let returnCode = ResponseCode.OK;
        let returnMessage = 'OK';
        for (const i in files) {
            const file = Array.isArray(files[i]) ? files[i][0] : files[i];
            const name = path.parse(file['name'] ?? '');
            const filePath = file['path'];
            if (name.ext === '.zip') {
                try {
                    logger.logInfo('HTTPApi: Install request ' + name.base);
                    const tmpPckgDir = process.cwd() + '/tmp_pckgs/' + name.name;
                    await fs.remove(tmpPckgDir);
                    await this.extractArchive(filePath, tmpPckgDir);
                    await this.pckgManager.installPackage(process.cwd() + '/tmp_pckgs/' + name.name);
                } catch (err) {
                    console.log(err);
                    returnCode = ResponseCode.INTERNAL_ERROR;
                    returnMessage = err instanceof Error ? err.message : 'Unknown error';
                } finally {
                    await fs.remove(process.cwd() + '/tmp_pckgs/' + name.name);
                    await fs.remove(filePath);
                }
            } else {
                logger.logError('HTTPApi: wrong extention recieved ');
                await fs.remove(filePath);
            }
        }
        sendMessageResponse(res, returnCode, returnMessage);
    }

    private onPackageRemoveRequest(url: URL, req: IncomingMessage, res: ServerResponse) {
        try {
            const pckgName = url.searchParams.get('package_name');
            if (pckgName === null) {
                sendJsonResponse(res, ResponseCode.BAD_REQ, {
                    message: 'No name provided!',
                });
            } else if (this.pckgManager.contains(pckgName)) {
                this.pckgManager.uninstallPackage(pckgName);
                sendJsonResponse(res, ResponseCode.OK, {});
            } else {
                sendJsonResponse(res, ResponseCode.NOT_FOUND, { message: 'Not Found' });
            }
        } catch (err) {
            console.log(err);
            const errMessage = err instanceof Error ? err.message : 'Unknown error';
            sendJsonResponse(res, ResponseCode.NOT_FOUND, { message: `Package uninstall error: ${errMessage}` });
        }
    }

    private onPackageListRequest(url: URL, req: IncomingMessage, res: ServerResponse) {
        try {
            sendJsonResponse(res, ResponseCode.OK, this.pckgManager.listManifests());
        } catch (err) {
            console.log(err);
            const errMessage = err instanceof Error ? err.message : 'Unknown error';
            sendJsonResponse(res, ResponseCode.NOT_FOUND, { message: `Package list error: ${errMessage}` });
        }
    }

    private async onPackageDataRequest(
        url: URL,
        req: IncomingMessage,
        res: ServerResponse,
        files: formidable.Files,
        fields: formidable.Fields
    ) {
        const pckgName = url.searchParams.get('package_name');
        const action = url.searchParams.get('action');
        const compressionLevel = parseInt(url.searchParams.get('compression_level') ?? '9');
        if (pckgName === null || action === null) {
            sendMessageResponse(res, ResponseCode.BAD_REQ, 'Crucial attributes missing!');
            return;
        }

        const packages = this.pckgManager.getPackages();
        if (!(pckgName in packages)) {
            sendMessageResponse(res, ResponseCode.BAD_REQ, `Package ${pckgName} doesn't exist`);
            return;
        }

        const pckg = packages[pckgName];
        const localdataPath = pckg.envVars.persistentDataPath;
        switch (action) {
            case 'IMPORT': {
                let returnCode = ResponseCode.OK;
                let returnMessage = 'OK';
                for (const i in files) {
                    const file = Array.isArray(files[i]) ? files[i][0] : files[i];
                    const fileName = path.parse(file['name'] ?? '');
                    const filePath = file['path'];
                    const tmpPckgDir = `${process.cwd()}/tmp_data/${fileName.name}`;
                    try {
                        if (fileName.ext === '.zip') {
                            logger.logInfo(`HTTPApi: localdata imported under name ${fileName.base}`);
                            await fs.remove(tmpPckgDir);
                            await this.extractArchive(filePath, tmpPckgDir);
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
                        returnMessage = err instanceof Error ? err.message : 'Unknown error';
                    } finally {
                        await fs.remove(tmpPckgDir);
                        await fs.remove(filePath);
                    }
                }
                sendMessageResponse(res, returnCode, returnMessage);
                break;
            }
            case 'EXPORT': {
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
            }
            default: {
                sendMessageResponse(res, ResponseCode.BAD_REQ, 'Invalid action');
            }
        }
    }

    private onPackageSettingsRequest(url: URL, req: IncomingMessage, res: ServerResponse) {
        const pckgName = url.searchParams.get('package_name');
        const action = url.searchParams.get('action');
        if (pckgName === null || action === null) {
            sendMessageResponse(res, ResponseCode.BAD_REQ, 'Crucial attributes missing!');
        } else {
            switch (action) {
                case 'get':
                    if (this.pckgManager.contains(pckgName)) {
                        const pckg = this.pckgManager.getPackages()[pckgName];
                        sendJsonResponse(res, ResponseCode.OK, pckg.getSettings());
                    } else {
                        sendMessageResponse(res, ResponseCode.NOT_FOUND, 'Package not found');
                    }
                    break;
                case 'set':
                    if (this.pckgManager.contains(pckgName)) {
                        try {
                            const settingsData: Buffer[] = [];
                            req.on('data', (chunk: Buffer) => {
                                settingsData.push(chunk);
                            });
                            req.on('end', () => {
                                const pckg = this.pckgManager.getPackages()[pckgName];
                                pckg.setSettings(JSON.parse(Buffer.concat(settingsData).toString()));
                                sendMessageResponse(res, ResponseCode.OK, 'OK');
                            });
                        } catch (err) {
                            logger.logError(errToString(err));
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
    }

    private async onCameraProxyRequest(url: URL, req: IncomingMessage, res: ServerResponse) {
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
        await proxy.request(target, req, res);
    }

    private async onNetworkCameraListRequest(url: URL, req: IncomingMessage, res: ServerResponse) {
        const zeroconf = new Zeroconf(['_axis-video._tcp.local']);

        const deviceList = await zeroconf.resolve(2000);
        if (deviceList === undefined) {
            sendMessageResponse(res, ResponseCode.INTERNAL_ERROR, 'Zeroconf error');
            return;
        }

        const deviceListFiltered = deviceList
            .map((device: MdnsResponse) => {
                device.addr = device.addr.filter(addr => !addr.startsWith('169.254.'));
                return device;
            })
            .filter((device: MdnsResponse) => {
                return device.domainName.toLowerCase().indexOf('axis') !== -1 && device.addr.length !== 0;
            });

        const deviceListSorted = deviceListFiltered.sort((a: MdnsResponse, b: MdnsResponse) => {
            return a.domainName.localeCompare(b.domainName);
        });

        const deviceListResult = deviceListSorted.map((device: MdnsResponse) => {
            return {
                name: device.domainName.split('._')[0],
                ip: device.addr[0],
            };
        });
        sendJsonResponse(res, ResponseCode.OK, { message: JSON.stringify({ camera_list: deviceListResult }) });
    }

    private extractArchive(archive: string, dirName: string) {
        return new Promise<void>((resolve, reject) => {
            yauzl.open(archive, { lazyEntries: true }, (error, zip) => {
                if (error !== null) {
                    reject(error);
                    return;
                }

                zip.on('entry', (entry: yauzl.Entry) => {
                    zip.openReadStream(entry, (error, readStream) => {
                        if (error !== null) {
                            zip.emit('error', error);
                            return;
                        }

                        // Save current entry. Then read next.
                        const filePath = path.join(dirName, entry.fileName);
                        if (filePath.lastIndexOf('/') === filePath.length - 1) {
                            fs.mkdir(filePath, { recursive: true }, (error) => {
                                if (error !== null) {
                                    zip.emit('error', error);
                                    return;
                                }
                                zip.readEntry();
                            });
                            return;
                        }

                        const parsedPath = path.parse(filePath);
                        fs.mkdir(parsedPath.dir, { recursive: true }, (error) => {
                            if (error !== null) {
                                zip.emit('error', error);
                                return;
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

                zip.on('error', (error) => {
                    reject(error);
                });

                zip.on('end', () => {
                    resolve();
                });

                zip.readEntry();
            });
        });
    }
}
