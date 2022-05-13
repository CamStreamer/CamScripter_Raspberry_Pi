import * as AdmZip from 'adm-zip';
import * as archiver from 'archiver';

import { Fields, Files } from 'formidable';
import * as fs from 'fs-extra';
import { IncomingMessage, ServerResponse } from 'http';
import * as http_proxy from 'http-proxy';
import { arch } from 'os';
import * as path from 'path';

import { getVersion, Paths } from './commonData';
import {
    ResponseCode,
    sendJsonResponse,
    sendMessageResponse,
    sendParamResponse,
    sendArchiverResponse,
} from './httpRespond';
import { HttpServer } from './httpServer';
import { logger } from './logger';
import { PackageManager } from './packageManager';
import { ParamManager } from './paramManager';

const ext_map = {
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

const pckg_manager = new PackageManager(
    process.cwd() + '/packages',
    getVersion()
);
const param_manager = new ParamManager(process.cwd() + '/params/');

const http_server = new HttpServer();
const aliases = {
    '/': '/settings.html',
};

//filehandlers
http_server.on('filerequest', (raw_url: string, res: ServerResponse) => {
    if (raw_url.match(/package/)) {
        let start_i = raw_url.search(/package/);
        let url = raw_url.slice(start_i);
        let folders = url.split('/');
        if (folders.length <= 2) {
            sendMessageResponse(
                res,
                ResponseCode.BAD_REQ,
                'HTTPApi: invalid request'
            );
        } else {
            let pckg_name = folders[1];
            let file_path = '/' + folders.slice(2).join('/');
            if (pckg_manager.contains(pckg_name)) {
                let parsed = path.parse(file_path);
                let read =
                    pckg_manager.packages[pckg_name].accessOnlineFile(
                        file_path
                    );
                if (read) {
                    res.writeHead(ResponseCode.OK, {
                        'Content-Type': ext_map[parsed.ext],
                        'Content-Length': read[0].size,
                    });
                    read[1].pipe(res);
                } else {
                    sendMessageResponse(
                        res,
                        ResponseCode.NOT_FOUND,
                        `HTTPApi: file ${file_path} not found`
                    );
                }
            } else {
                sendMessageResponse(
                    res,
                    ResponseCode.NOT_FOUND,
                    `HTTPApi: package ${pckg_name} not found`
                );
            }
        }
    } else {
        let file_path =
            raw_url in aliases
                ? './html' + path.normalize(aliases[raw_url])
                : './html' + path.normalize(raw_url);
        let parsed = path.parse(file_path);
        if (fs.pathExistsSync(file_path)) {
            let stat = fs.statSync(file_path);
            res.writeHead(ResponseCode.OK, {
                'Content-Type': ext_map[parsed.ext],
                'Content-Length': stat.size,
            });
            let readStream = fs.createReadStream(file_path);
            readStream.pipe(res);
        } else {
            sendMessageResponse(
                res,
                ResponseCode.NOT_FOUND,
                `HTTPApi: file ${file_path} not found`
            );
        }
    }
});

http_server.on(
    'proxy',
    (
        rest: string,
        req: IncomingMessage,
        res: ServerResponse,
        proxy_mirror: http_proxy,
        is_public: boolean
    ) => {
        let items = rest.split('/');
        if (items.length < 2) {
            sendMessageResponse(
                res,
                ResponseCode.INTERNAL_ERROR,
                `Wrong proxy format`
            );
        } else {
            let package_name = items[1];
            if (package_name in pckg_manager.packages) {
                let target_port: number;
                if (is_public) {
                    target_port =
                        pckg_manager.packages[package_name].env_vars
                            .http_port_public;
                } else {
                    target_port =
                        pckg_manager.packages[package_name].env_vars
                            .http_port;
                }
                req.url = '/' + rest;
                proxy_mirror.web(req, res, {
                    target: 'http://localhost:' + target_port,
                });
            } else {
                sendMessageResponse(
                    res,
                    ResponseCode.NOT_FOUND,
                    `Cannot find package to proxy`
                );
            }
        }
    }
);

//VAPIX
http_server.registerDataCGI('/param.cgi', (url, res, files, fields) => {
    let action = url.searchParams.get('action') || fields['action'].toString();
    switch (action) {
        case 'update':
            for (let f in fields) {
                if (f === 'action') continue;
                let splitted = f.toLowerCase().split('.');
                if (splitted[0] != 'camscripter' || splitted.length !== 2) {
                    sendMessageResponse(
                        res,
                        ResponseCode.BAD_REQ,
                        'Vapix-Sim: Unsupported parameters'
                    );
                } else {
                    let param_name = splitted[1];
                    let value = fields[f];
                    if (typeof value === 'string')
                        param_manager.update(param_name, JSON.parse(value));
                }
            }
            sendMessageResponse(res, ResponseCode.OK, 'OK');
            break;

        case 'list':
            let group_name = url.searchParams.get('group').toLowerCase();
            let splitted = group_name.split('.');
            if (splitted[0] != 'camscripter' || splitted.length !== 2) {
                sendMessageResponse(
                    res,
                    ResponseCode.BAD_REQ,
                    'Vapix-Sim: Unsupported parameters'
                );
            } else {
                let param_name = splitted[1];
                sendParamResponse(
                    res,
                    ResponseCode.OK,
                    group_name,
                    param_manager.get(param_name)
                );
            }
            break;
        default:
            sendMessageResponse(
                res,
                ResponseCode.BAD_REQ,
                'Vapix-Sim: Unsupported action'
            );
    }
});

http_server.registerRequestCGI('/systemlog.cgi', (url, res) => {
    let pckg_name = url.searchParams.get('package_name');
    if (pckg_name) {
        if (pckg_name === 'system') {
            let file_path = Paths.SYSLOG;
            if (fs.pathExistsSync(file_path)) {
                let stat = fs.statSync(file_path);
                res.writeHead(ResponseCode.OK, {
                    'Content-Type': 'text/plain',
                    'Content-Length': stat.size,
                });
                let readStream = fs.createReadStream(file_path);
                readStream.pipe(res);
            } else {
                sendMessageResponse(
                    res,
                    ResponseCode.NOT_FOUND,
                    'Vapix-Sim - file not found'
                );
            }
        } else if (pckg_manager.contains(pckg_name)) {
            let read = pckg_manager.packages[pckg_name].accessLogFile();
            if (read) {
                res.writeHead(ResponseCode.OK, {
                    'Content-Type': 'text/plain',
                    'Content-Length': read[0].size,
                });
                read[1].pipe(res);
            } else {
                sendMessageResponse(
                    res,
                    ResponseCode.NOT_FOUND,
                    'Vapix-Sim: No log file found'
                );
            }
        } else {
            sendMessageResponse(
                res,
                ResponseCode.BAD_REQ,
                'Vapix-Sim: Uknown package'
            );
        }
    } else {
        sendMessageResponse(
            res,
            ResponseCode.BAD_REQ,
            'Vapix-Sim: No valid systemlog selected'
        );
    }
});

http_server.registerRequestCGI('/version.cgi', (url, res) => {
    sendMessageResponse(res, ResponseCode.OK, getVersion().join('.'));
});

//CAMSCRIPTER
http_server.registerDataCGI(
    '/package/install.cgi',
    (url, res, files: Files, fields: Fields) => {
        let return_code = ResponseCode.OK;
        let return_message = 'OK';
        for (let i in files) {
            let name = path.parse(files[i]['name']);
            let fpath = files[i]['path'];
            if (name.ext === '.zip') {
                logger.logInfo('HTTPApi: Install request ' + name.base);
                let zip = new AdmZip(fpath);
                zip.extractAllTo(process.cwd() + '/tmp_pckgs/' + name.name);
                try {
                    pckg_manager.installPackage(
                        process.cwd() + '/tmp_pckgs/' + name.name
                    );
                } catch (err) {
                    return_code = ResponseCode.INTERNAL_ERROR;
                    return_message = err;
                } finally {
                    fs.removeSync(process.cwd() + '/tmp_pckgs/' + name.name);
                }
            } else {
                logger.logError('HTTPApi: wrong extention recieved ');
            }
            fs.removeSync(fpath);
        }
        sendMessageResponse(res, return_code, return_message);
    }
);

http_server.registerRequestCGI('/package/list.cgi', (url, res) => {
    sendJsonResponse(res, ResponseCode.OK, pckg_manager.listManifests());
});

http_server.registerDataCGI('/package/ldata.cgi', async (url, res, files: Files, fields: Fields) => {
    let pckg_name = url.searchParams.get('package_name');
    let action = url.searchParams.get('action');
    let compression_level = parseInt(url.searchParams.get('compression_level'));
    switch (action) {
        case "IMPORT":
            let return_code = ResponseCode.OK;
            let return_message = 'OK';
            for (let i in files) {
                let name = path.parse(files[i]['name']);
                let fpath = files[i]['path'];
                if (name.ext === '.zip') {
                    logger.logInfo('HTTPApi: localdata imported under name ' + name.base);
                    let zip = new AdmZip(fpath);
                    zip.extractAllTo(process.cwd() + '/tmp_data/' + name.name);
                    try {
                        let pckg = pckg_manager.packages[pckg_name];
                        let localdata_path = pckg.env_vars.persistent_data_path;
                        fs.removeSync(localdata_path);
                        fs.copySync(process.cwd() + '/tmp_data/' + name.name, localdata_path);
                    } catch (err) {
                        return_code = ResponseCode.INTERNAL_ERROR;
                        return_message = err;
                    } finally {
                        fs.removeSync(process.cwd() + '/tmp_data/' + name.name);
                    }
                } else {
                    logger.logError('HTTPApi: wrong extention recieved ');
                }
                fs.removeSync(fpath);
            }
            sendMessageResponse(res, return_code, return_message);
            break;
        case "EXPORT":
            let archie = archiver('zip', { zlib: { level: compression_level } })
            let pckg = pckg_manager.packages[pckg_name];
            let localdata_path = pckg.env_vars.persistent_data_path;
            archie.directory(localdata_path, false);
            await sendArchiverResponse(res, ResponseCode.OK, archie);
            break;
        default:
            sendMessageResponse(res, ResponseCode.BAD_REQ, "Invalid action")
    }
});

http_server.registerRequestCGI('/package/remove.cgi', (url, res) => {
    let pckg_name = url.searchParams.get('package_name');
    if (!pckg_name) {
        sendJsonResponse(res, ResponseCode.BAD_REQ, {
            message: 'No name provided!',
        });
    } else if (pckg_manager.contains(pckg_name)) {
        pckg_manager.uninstallPackage(pckg_name);
        sendJsonResponse(res, ResponseCode.OK, {});
    } else {
        sendJsonResponse(res, ResponseCode.NOT_FOUND, { message: 'Not Found' });
    }
});

http_server.registerDataCGI(
    '/package/settings.cgi',
    (url, res, files, fields) => {
        let pckg_name = url.searchParams.get('package_name');
        let action = url.searchParams.get('action');
        if (!pckg_name || !action) {
            sendMessageResponse(
                res,
                ResponseCode.BAD_REQ,
                'Crucial attributes missing!'
            );
        } else {
            switch (action) {
                case 'get':
                    if (pckg_manager.contains(pckg_name)) {
                        let pack = pckg_manager.packages[pckg_name];
                        sendJsonResponse(
                            res,
                            ResponseCode.OK,
                            pack.getSettings()
                        );
                    } else {
                        sendMessageResponse(
                            res,
                            ResponseCode.NOT_FOUND,
                            'Package not found'
                        );
                    }
                    break;
                case 'set':
                    if (pckg_manager.contains(pckg_name)) {
                        try {
                            let pack = pckg_manager.packages[pckg_name];
                            for (let i in fields) {
                                pack.setSettings(JSON.parse(i));
                            }
                            sendMessageResponse(res, ResponseCode.OK, 'OK');
                        } catch (err) {
                            logger.logError(err);
                            sendMessageResponse(
                                res,
                                ResponseCode.INTERNAL_ERROR,
                                'File Writing Error'
                            );
                        }
                    } else {
                        sendMessageResponse(
                            res,
                            ResponseCode.NOT_FOUND,
                            'Package not found'
                        );
                    }
                    break;
                default:
                    sendMessageResponse(
                        res,
                        ResponseCode.BAD_REQ,
                        'Invalid action'
                    );
            }
        }
    }
);

process.on('unhandledRejection - ', (err: Error) => {
    logger.logError('unhandledRejection' + err.message);
});

param_manager.on('ready', () => {
    marry(pckg_manager, param_manager);
});
pckg_manager.on('ready', () => {
    marry(pckg_manager, param_manager);
});

async function marry(pckg_man: PackageManager, param_man: ParamManager) {
    if (pckg_man.ready && param_man.ready) {
        pckg_manager.connect(param_manager.params['packageconfigurations']);
        logger.logInfo('Starting Camscripter Server');
        http_server.start(52520);
        logger.logInfo('Camscripter listening on 0.0.0.0:52520');
    }
}
