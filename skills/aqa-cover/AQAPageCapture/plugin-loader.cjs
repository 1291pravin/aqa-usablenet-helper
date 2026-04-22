// CJS wrapper to load the UMD-bundled plugin.playwright.js properly.
// The UMD module expects `this` to be defined (window/global), which fails
// when imported as ESM (where top-level `this` is undefined).
const plugin = require('./plugin.playwright.cjs');
module.exports = plugin;
