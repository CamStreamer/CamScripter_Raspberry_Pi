import { getVersion } from './commonData';
import { HttpApi } from './httpApi';
import { logger } from './logger';
import { PackageManager } from './packageManager';
import { ParamManager } from './paramManager';

const pckgManager = new PackageManager(`${process.cwd()}/packages`, `${process.cwd()}/logs`, getVersion());
const paramManager = new ParamManager(`${process.cwd()}/params`);

paramManager.on('ready', () => {
    marry(pckgManager, paramManager);
});
pckgManager.on('ready', () => {
    marry(pckgManager, paramManager);
});

async function marry(pckgManager: PackageManager, paramManager: ParamManager) {
    if (pckgManager.isReady() && paramManager.isReady()) {
        pckgManager.connect(paramManager.getParams()['packageconfigurations']);
        logger.logInfo('Starting Camscripter Server');
        const host = process.argv.length > 2 ? process.argv[2] : '0.0.0.0';
        const port = process.argv.length > 3 ? parseInt(process.argv[3]) : 52520;
        new HttpApi(host, port, pckgManager, paramManager);
        logger.logInfo(`Camscripter listening on ${host}:${port}`);
    }
}

process.on('uncaughtException', (err) => {
    logger.logError('uncaughtException: ' + err.stack ?? err.toString());
});

process.on('unhandledRejection - ', (err: Error) => {
    logger.logError('unhandledRejection: ' + err.stack ?? err.toString());
});
