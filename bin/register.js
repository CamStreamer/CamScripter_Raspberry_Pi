#!/usr/bin/env node
"use strict";
const shell = require('shelljs');
const path = require('path');
shell.exec(path.normalize(__dirname + "/../systemd_register.sh"));