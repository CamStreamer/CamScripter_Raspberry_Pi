# Camscripter Raspberry

## Compatibility
npm v7.24
node v16.x.xx

## Access

Access your device via `ssh`. On Windows you can use SSH client such as [Putty](https://www.putty.org/).
Type in `ssh pi@Your_IP_Address`.

## Installation

Node.js and NPM package manager is required and can be installed by following command: 
```
sudo apt install nodejs npm
```

To install CamScripter on your device run the following command:
```
sudo npm install -g camscripter-raspberry
```
Thus camscripter interface will become available in your command line.
CamScripter will be automaticaly registered as systemd service, which will start with your computer.
If you want to access CamScripter only on temporal basis, you can run `sudo camscripter-unregister` from the root directory.

## Turning on
To access GUI please type http://localhost:52520/settings.html into your browser.
To access CamScripter on remote devices simply replace `localhost` with an appropriate IP address.
To turn Camscripter on temporarily, please type following command into your shell from any directory `sudo camscripter-run`
To turn Camscripter on permanently again, please run a prepared script: `sudo camscripter-register`.
Server can be found on adress 0.0.0.0, port 52520. This means the port 52520 will become accessible from outisde your device as long as CamScripter runs.


## Turning off
Temporary run can be terminated simply by standard means of ending a running process on your device.
Permanent run uses `systemd` to keep itself alive as a system service. To turn it off type: `systemctl stop camscripter.service`. This command will stop the process of CSc-Rbi but will not affect its status as registered service.
To start the process again type `systemctl start camscripter.service`.
For removing CamScripter from systemd services please run `sudo camscripter-unregister`.


## Removal
To remove CamScripter from your device please type :
```
sudo npm uninstall -g camscripter-raspberry
```
As of today `npm` has no mechanism alowing for hooking automated scripts to package uninstall. Therefore you need to run ```camscripter-unregister``` first.
If you removed CamScripter in less formal fashion it might be nessessary to manualy remove Camscripter systemd service file or other leftover artefacts and disable the service.

## Micro Apps
You can find prepackaged example micro apps [here](https://github.com/CamStreamer/CamScripterApp_packages_to_use/tree/master/RaspberryPackages).
If you wish to obtain source code of our example apps, you may do so [here](https://github.com/CamStreamer/CamScripterApp_examples/tree/master/Raspberry).
