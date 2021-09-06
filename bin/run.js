#!/usr/bin/env node
"use strict";
const { fork } = require('child_process');
const path = require('path');
console.log("CamScripter Launch");
fork(path.normalize(__dirname + "/../dist/main.js"),{ detached: false, cwd: path.normalize(__dirname + "/../")});