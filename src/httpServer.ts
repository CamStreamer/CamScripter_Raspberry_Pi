import { createServer, IncomingMessage, ServerResponse, Server } from 'http';
import { URL } from 'url';
import * as formidable from 'formidable';
import { logger } from './commonData';
import * as path from 'path';
import { EventEmitter } from 'events';
import * as http_proxy from 'http-proxy'


type RequestHandle = {
    (url: URL, res: ServerResponse): void;
}

type DataHandle = {
    (url: URL, res: ServerResponse, files: formidable.Files, fields: formidable.Fields): void;
}

export class HttpServer extends EventEmitter {
    server: Server;
    running: boolean;
    request_handles: { [key: string]: RequestHandle };
    request_handles_list: string[];
    data_handles: { [key: string]: DataHandle };
    data_handles_list: string[];
    ext_map: { [key: string]: string };
    server_origin: string;
    proxy: http_proxy;

    constructor() {
        super();
        this.running = false;
        this.server_origin = 'http://0.0.0.0:52520';
        this.data_handles = {};
        this.data_handles_list = [];
        this.request_handles = {};
        this.request_handles_list = [];
        this.server = createServer();
        this.proxy = http_proxy.createProxyServer();

        this.proxy.on('proxyReq', (proxyReq, req, res, options) => {
            let items = req.url.split('/');
            proxyReq.path = '/' + items.slice(3).join('/');
        });

        this.server.on('request', (req: IncomingMessage, res: ServerResponse) => {
            logger.logHttp('Http-Server: Incomming request ' + req.url);
            let url = new URL(req.url, this.server_origin);
            let ext = path.parse(url.pathname).ext;
            if (url.pathname.match(/proxy/)) {
                let start_i = req.url.search(/proxy/);
                let rest = req.url.slice(start_i);
                this.emit('proxy', rest, req, res, this.proxy, false);
            } else if (url.pathname.match(/proxy_public/)) {
                let start_i = req.url.search(/proxy_public/);
                let rest = req.url.slice(start_i);
                this.emit('proxy', rest, req, res, this.proxy, true);
            } else if (ext === '.cgi') {
                this._handleCGI(req, res);
            } else {
                this.emit('filerequest', req.url, res);
            }
        });

    }

    _handleCGI(req: IncomingMessage, res: ServerResponse) {
        let url = new URL(req.url, this.server_origin);
        logger.logSilly('Http-Server: CGI Request' + req.url);
        let matched = false;
        for (let cgi_url of this.data_handles_list) {
            if (url.pathname.match(cgi_url)) {
                let form = formidable({
                    multiples: false,
                    uploadDir: process.cwd() + '/tmp'
                });
                form.parse(req, (err, fields, files) => {
                    this.data_handles[cgi_url](url, res, files, fields);
                });
                matched = true;
                break;
            }
        }
        for (let cgi_url of this.request_handles_list) {
            if (url.pathname.match(cgi_url)) {
                this.request_handles[cgi_url](url, res);
                matched = true;
                break;
            }
        }
        if (!matched) {
            logger.logWarning('Http-Server: No valid CGI');
            res.end('CGI ' + url.pathname + " can't be resolved");
        }
    }

    start(port: number): void {
        if (!this.running) {
            this.running = true;
            this.server.listen(port, '0.0.0.0');
            this.server_origin = 'http://0.0.0.0:' + port;
        }
    }

    registerRequestCGI(path: string, handle: RequestHandle): void {
        this.request_handles_list.push(path);
        this.request_handles[path] = handle;
    }
    registerDataCGI(path: string, handle: DataHandle): void {
        this.data_handles_list.push(path);
        this.data_handles[path] = handle;
    }
}