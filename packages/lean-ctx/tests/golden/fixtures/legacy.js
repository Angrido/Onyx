#!/usr/bin/env node
"use strict";

const fs = require("fs");
const { format } = require("./format");

/**
 * Reads a JSON file.
 * @param {string} file
 */
function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

class Cache {
  entries = new Map();
  static limit = 100;

  get(key) {
    return this.entries.get(key);
  }

  set = (key, value) => {
    this.entries.set(key, value);
  };
}

exports.formatAll = function formatAll(values) {
  return values.map(format);
};

module.exports = { readJson, Cache };

if (require.main === module) {
  console.log(readJson(process.argv[2]));
}
