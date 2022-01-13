# CamScripter Raspberry Pi

## Modules

Most module's names should be selfdesciptive and have direct analogue in classical CSc.

Camscripter Monitor is class dedicated to control of a package run.

## Differences from classical version

Unlike classical CSc where consistency of application state is ensured only as long as the data flows through proper channels (application .`cgi's`), data in CSc RPi is watched by monitoring process, thus the run of CSc RPi is sensitive to changes made by external applications or user themself.

## Scripts

- systemd_register - registers camscripter service into systemd
- systemd_unregister - unregisters camscripter service and shuts down currently running service. service reload should be called by the user.
- prepare_env - runs after installation, sets up proper directory structure.

## Publication

Please mind that `.npmignore` and `.gitignore` files should be kept separate as there are different requirements for what is uploaded to npm and what should be uploaded to GitHub.
Publication should trigger build process so it does not need to performed manualy (as of today this works only with npm not yarn!!)
Mind that the publication process triggers the run of the application on your device.
There is good possibility to implement automated testing.