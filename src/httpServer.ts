import { EventEmitter } from 'events';
import * as formidable from 'formidable';
import { createServer, IncomingMessage, Server, ServerResponse } from 'http';
import * as path from 'path';
import { URL } from 'url';

import { logger } from './logger';

type RequestHandle = {
    (url: URL, req: IncomingMessage, res: ServerResponse): void;
};

type DataHandle = {
    (url: URL, req: IncomingMessage, res: ServerResponse, files: formidable.Files, fields: formidable.Fields): void;
};

export class HttpServer extends EventEmitter {
    private server: Server;
    private running: boolean;
    private requestHandles: { [key: string]: RequestHandle };
    private requestHandlesList: string[];
    private dataHandles: { [key: string]: DataHandle };
    private dataHandlesList: string[];
    private serverOrigin: string;

    constructor() {
        super();
        this.running = false;
        this.serverOrigin = 'http://0.0.0.0:52520';
        this.dataHandles = {};
        this.dataHandlesList = [];
        this.requestHandles = {};
        this.requestHandlesList = [];
        this.server = createServer();

        this.server.on('request', (req: IncomingMessage, res: ServerResponse) => {
            logger.logInfo('Http-Server: Incomming request ' + req.url);
            const url = new URL(req.url ?? '', this.serverOrigin);
            const ext = path.parse(url.pathname).ext;
            if (url.pathname.match(/\/proxy\//)) {
                this.emit('proxy', req, res, false);
            } else if (url.pathname.match(/\/proxy_public\//)) {
                this.emit('proxy', req, res, true);
            } else if (ext === '.cgi') {
                this.handleCGI(req, res);
            } else {
                this.emit('filerequest', req, res);
            }
        });
    }

    start(host: string, port: number): void {
        if (!this.running) {
            this.running = true;
            this.server.listen(port, host);
            this.serverOrigin = `http://${host}:${port}`;
        }
    }

    registerRequestCGI(path: string, handle: RequestHandle): void {
        this.requestHandlesList.push(path);
        this.requestHandles[path] = handle;
    }
    registerDataCGI(path: string, handle: DataHandle): void {
        this.dataHandlesList.push(path);
        this.dataHandles[path] = handle;
    }

    private handleCGI(req: IncomingMessage, res: ServerResponse) {
        const url = new URL(req.url ?? '', this.serverOrigin);
        logger.logVerbose('Http-Server: CGI Request' + req.url);
        let matched = false;
        for (let cgiUrl of this.dataHandlesList) {
            if (url.pathname.match(cgiUrl)) {
                let form = formidable({
                    multiples: false,
                    uploadDir: process.cwd() + '/tmp',
                });
                form.parse(req, (err, fields, files) => {
                    this.dataHandles[cgiUrl](url, req, res, files, fields);
                });
                matched = true;
                break;
            }
        }
        for (let cgiUrl of this.requestHandlesList) {
            if (url.pathname.match(cgiUrl)) {
                this.requestHandles[cgiUrl](url, req, res);
                matched = true;
                break;
            }
        }
        if (!matched) {
            logger.logWarning('Http-Server: No valid CGI');
            res.end('CGI ' + url.pathname + " can't be resolved");
        }
    }
}
