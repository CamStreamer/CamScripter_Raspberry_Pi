#!/usr/bin/env node
"use strict";
const path = require('path');
var shelly = require("shelljs");
shelly.exec(path.normalize(__dirname + "/../systemd_unregister.sh"));