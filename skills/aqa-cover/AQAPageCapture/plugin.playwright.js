(function webpackUniversalModuleDefinition(root, factory) {
	if(typeof exports === 'object' && typeof module === 'object')
		module.exports = factory();
	else if(typeof define === 'function' && define.amd)
		define([], factory);
	else if(typeof exports === 'object')
		exports["AQAPageCapturePlugin"] = factory();
	else
		root["AQAPageCapturePlugin"] = factory();
})(typeof self !== 'undefined' ? self : typeof globalThis !== 'undefined' ? globalThis : {}, () => {
return /******/ (() => { // webpackBootstrap
/******/ 	"use strict";
/******/ 	var __webpack_modules__ = ({

/***/ 124:
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   C: () => (/* binding */ ChromeExternalMessagingAction)
/* harmony export */ });
var ChromeExternalMessagingAction;
(function (ChromeExternalMessagingAction) {
    ChromeExternalMessagingAction["CREATE_FLOW"] = "bg-ext-create-flow";
    ChromeExternalMessagingAction["DO_SNAPSHOT"] = "bg-ext-do-snapshot";
    ChromeExternalMessagingAction["DOWNLOAD"] = "bg-ext-download-flow";
    ChromeExternalMessagingAction["HEALTH_CHECK"] = "bg-ext-health-check";
    ChromeExternalMessagingAction["NETWORK_ADD_RESOURCE"] = "bg-ext-add-network-resource";
    ChromeExternalMessagingAction["UPLOAD"] = "bg-ext-upload";
})(ChromeExternalMessagingAction || (ChromeExternalMessagingAction = {}));


/***/ }),

/***/ 424:
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   _: () => (/* binding */ DeviceId)
/* harmony export */ });
var DeviceId;
(function (DeviceId) {
    DeviceId["DESKTOP_1"] = "device_0";
    DeviceId["DESKTOP_2"] = "device_1";
    DeviceId["DESKTOP_3"] = "device_2";
    DeviceId["MOBILE_1"] = "device_3";
    DeviceId["CUSTOM"] = "custom";
})(DeviceId || (DeviceId = {}));


/***/ }),

/***/ 479:
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   A: () => (/* binding */ AQAPageCapturePluginCore)
/* harmony export */ });
/* harmony import */ var models_Devices__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(424);

class AQAPageCapturePluginCore {
    constructor(options) {
        this.extensionID = 'llaaiankjgnonjipogopofnpahaoccfo';
        this.version = '1.0';
        this.devices = {
            '1280x1024': models_Devices__WEBPACK_IMPORTED_MODULE_0__/* .DeviceId */ ._.DESKTOP_1,
            '1366x668': models_Devices__WEBPACK_IMPORTED_MODULE_0__/* .DeviceId */ ._.DESKTOP_2,
            '1536x864': models_Devices__WEBPACK_IMPORTED_MODULE_0__/* .DeviceId */ ._.DESKTOP_3,
        };
        this.errors = {
            CREATE_FLOW: 'Unable to create flow',
            CREATE_FLOW_WITH_NAME: 'Unable to create flow with name ',
            CREATE_FLOW_MISSING_NAME: 'Missing name param on createFlow',
            EXTENSION_NOT_FOUND: 'Chrome extension not available. Ensure it has been correctly loaded using with --load-extension option',
            SNAPSHOT: 'Unable to generate page snapshot',
            UNABLE_TO_CONNECT: 'Unable to connect to the AQAPageCapture extension',
            UPLOAD_ZIP: 'Unable to upload zip',
        };
        this.ignoreErrors = false;
        this.disarm = false;
        this.uploadFlowData = {
            name: '',
            suite: '',
            team: '',
            xTeam: '',
            description: undefined,
            testId: undefined,
        };
        if (options.ignoreErrors) {
            this.ignoreErrors = true;
        }
        if (options.disarm) {
            this.disarm = true;
        }
        if (!options.suite) {
            this.throwError('Missing AQA "suite" setting.');
        }
        this.uploadFlowData.suite = options.suite;
        if (!options.team) {
            this.throwError('Missing AQA "team" setting.');
        }
        this.uploadFlowData.team = options.team;
        if (!options.xTeam) {
            this.throwError('Missing AQA api key.');
        }
        this.uploadFlowData.xTeam = options.xTeam;
        this.uploadFlowData.testId = options.testId;
    }
    static nameTimeStamp() {
        const time = new Date();
        const a = `${time.getMonth() + 1}-${time.getDate()}_${time.getHours()}:${time.getMinutes()}:${time.getSeconds()}`;
        return a;
    }
    static log(msg) {
        // eslint-disable-next-line no-console
        console.info('AQAPageCapture:', msg);
    }
    throwError(message) {
        if (this.disarm)
            return;
        if (!this.ignoreErrors) {
            throw new Error(`AQAPageCapture: ${message}`);
        }
        else {
            console.error(`AQAPageCapture: ${message}`);
        }
    }
}


/***/ })

/******/ 	});
/************************************************************************/
/******/ 	// The module cache
/******/ 	var __webpack_module_cache__ = {};
/******/ 	
/******/ 	// The require function
/******/ 	function __webpack_require__(moduleId) {
/******/ 		// Check if module is in cache
/******/ 		var cachedModule = __webpack_module_cache__[moduleId];
/******/ 		if (cachedModule !== undefined) {
/******/ 			return cachedModule.exports;
/******/ 		}
/******/ 		// Create a new module (and put it into the cache)
/******/ 		var module = __webpack_module_cache__[moduleId] = {
/******/ 			// no module.id needed
/******/ 			// no module.loaded needed
/******/ 			exports: {}
/******/ 		};
/******/ 	
/******/ 		// Execute the module function
/******/ 		__webpack_modules__[moduleId](module, module.exports, __webpack_require__);
/******/ 	
/******/ 		// Return the exports of the module
/******/ 		return module.exports;
/******/ 	}
/******/ 	
/************************************************************************/
/******/ 	/* webpack/runtime/define property getters */
/******/ 	(() => {
/******/ 		// define getter functions for harmony exports
/******/ 		__webpack_require__.d = (exports, definition) => {
/******/ 			for(var key in definition) {
/******/ 				if(__webpack_require__.o(definition, key) && !__webpack_require__.o(exports, key)) {
/******/ 					Object.defineProperty(exports, key, { enumerable: true, get: definition[key] });
/******/ 				}
/******/ 			}
/******/ 		};
/******/ 	})();
/******/ 	
/******/ 	/* webpack/runtime/hasOwnProperty shorthand */
/******/ 	(() => {
/******/ 		__webpack_require__.o = (obj, prop) => (Object.prototype.hasOwnProperty.call(obj, prop))
/******/ 	})();
/******/ 	
/************************************************************************/
var __webpack_exports__ = {};
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   "default": () => (/* binding */ AQAPageCapturePlugin)
/* harmony export */ });
/* harmony import */ var models_ChromeExternalMessaging__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(124);
/* harmony import */ var models_Devices__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(424);
/* harmony import */ var _plugin_core__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(479);
var __awaiter = (undefined && undefined.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};



/**
 * Use eval to avoid any code transformation from webpack as this function will be executed on browser scope.
 */
/* @preserve */
function PlaywrightSendExtensionMessage([_messageData, extensionID]) {
    // eslint-disable-next-line no-eval
    return eval(`new Promise((resolve) => {
    if (!chrome || !chrome.runtime || !chrome.runtime.sendMessage) {
      resolve({ success: false, error: 'chrome.runtime is not defined.' });
    }
    chrome.runtime.sendMessage("${extensionID}", ${JSON.stringify(_messageData)}, (_response) => {
      if (chrome.runtime.lastError) {
        resolve({ success: false, error: chrome.runtime.lastError });
      }
      if(_response){
        resolve(_response);
      }else{
        resolve({ success: false, error: "extension provided an undefined response" });
      }
    });
  });`);
}
class AQAPageCapturePlugin extends _plugin_core__WEBPACK_IMPORTED_MODULE_2__/* ["default"] */ .A {
    constructor(driver, options) {
        super(options);
        this.driver = driver;
    }
    static computeSize(body) {
        const encoder = new TextEncoder();
        return encoder.encode(body).length;
    }
    /**
     * Plugin initializer.
     */
    static init(driver, options) {
        return __awaiter(this, void 0, void 0, function* () {
            const classInstance = new AQAPageCapturePlugin(driver, options);
            yield classInstance.initNetworkConnection();
            return classInstance;
        });
    }
    /**
     * Handles connection to the browser network.
     * Intercepts and sends the remote images and fonts to the extension.
     */
    initNetworkConnection() {
        return __awaiter(this, void 0, void 0, function* () {
            if (this.disarm)
                return;
            yield this.checkExtensionAvailable();
            this.driver.on('response', (response) => __awaiter(this, void 0, void 0, function* () {
                try {
                    const request = response.request();
                    if (['font', 'image'].includes(request.resourceType()) && !request.url().startsWith('data:')) {
                        const isFinished = yield response.finished();
                        if (isFinished === null) {
                            const body = yield response.body();
                            const base64Body = body.toString('base64');
                            const messageData = {
                                action: models_ChromeExternalMessaging__WEBPACK_IMPORTED_MODULE_0__/* .ChromeExternalMessagingAction */ .C.NETWORK_ADD_RESOURCE,
                                resource: {
                                    url: response.url(),
                                    content: base64Body,
                                    encoding: 'base64',
                                    size: AQAPageCapturePlugin.computeSize(base64Body),
                                    contentType: response.headers()['content-type'],
                                },
                            };
                            yield this.driver.evaluate(PlaywrightSendExtensionMessage, [messageData, this.extensionID]);
                        }
                    }
                    // eslint-disable-next-line no-empty
                }
                catch (e) { }
            }));
        });
    }
    /**
     * PageCapture chrome extension intarfaces.
     */
    checkExtensionAvailable() {
        return __awaiter(this, void 0, void 0, function* () {
            if (this.disarm)
                return;
            const messageData = {
                action: models_ChromeExternalMessaging__WEBPACK_IMPORTED_MODULE_0__/* .ChromeExternalMessagingAction */ .C.HEALTH_CHECK,
            };
            const response = yield this.driver.evaluate(PlaywrightSendExtensionMessage, [messageData, this.extensionID]);
            if (!response.success) {
                this.throwError(this.errors.EXTENSION_NOT_FOUND);
            }
        });
    }
    createFlow(options) {
        return __awaiter(this, void 0, void 0, function* () {
            if (this.disarm)
                return;
            if (!(options === null || options === void 0 ? void 0 : options.name)) {
                this.throwError(this.errors.CREATE_FLOW_MISSING_NAME);
            }
            this.uploadFlowData.name = `${options.name} (${AQAPageCapturePlugin.nameTimeStamp()})`;
            this.uploadFlowData.description = options.description;
            const device = (options === null || options === void 0 ? void 0 : options.device) ? this.devices[options === null || options === void 0 ? void 0 : options.device] : models_Devices__WEBPACK_IMPORTED_MODULE_1__/* .DeviceId */ ._.CUSTOM;
            const messageData = {
                action: models_ChromeExternalMessaging__WEBPACK_IMPORTED_MODULE_0__/* .ChromeExternalMessagingAction */ .C.CREATE_FLOW,
                payload: Object.assign(Object.assign({}, options), { name: this.uploadFlowData.name, device }),
            };
            const response = yield this.driver.evaluate(PlaywrightSendExtensionMessage, [messageData, this.extensionID]);
            if (!response.success) {
                this.throwError(`${this.errors.CREATE_FLOW_WITH_NAME} ${this.uploadFlowData.name}`);
            }
        });
    }
    doSnapshot(pageName) {
        return __awaiter(this, void 0, void 0, function* () {
            if (this.disarm)
                return;
            if (pageName) {
                AQAPageCapturePlugin.log(`taking "${pageName}" snapshot...`);
            }
            else {
                AQAPageCapturePlugin.log('taking snapshot...');
            }
            const messageData = {
                action: models_ChromeExternalMessaging__WEBPACK_IMPORTED_MODULE_0__/* .ChromeExternalMessagingAction */ .C.DO_SNAPSHOT,
                payload: {
                    pageName,
                },
            };
            const response = yield this.driver.evaluate(PlaywrightSendExtensionMessage, [messageData, this.extensionID]);
            if (!response.success) {
                this.throwError(response.error);
            }
            else {
                AQAPageCapturePlugin.log('...done!');
            }
        });
    }
    uploadZip() {
        return __awaiter(this, void 0, void 0, function* () {
            if (this.disarm)
                return;
            const { testId, suite, name } = this.uploadFlowData;
            if (testId) {
                AQAPageCapturePlugin.log(`updating test ${testId} on suite ${suite} with flow named "${name}"...`);
            }
            else {
                AQAPageCapturePlugin.log(`creating test on suite ${suite} with flow named "${name}"...`);
            }
            const messageData = {
                action: models_ChromeExternalMessaging__WEBPACK_IMPORTED_MODULE_0__/* .ChromeExternalMessagingAction */ .C.UPLOAD,
                payload: this.uploadFlowData,
            };
            const response = yield this.driver.evaluate(PlaywrightSendExtensionMessage, [messageData, this.extensionID]);
            if (!response.success) {
                if (response.error) {
                    this.throwError(`${this.errors.UPLOAD_ZIP}: ${response.error}`);
                }
                else {
                    this.throwError(this.errors.UPLOAD_ZIP);
                }
            }
            else {
                AQAPageCapturePlugin.log('...done!');
            }
        });
    }
    downloadFlowSnapshot() {
        return __awaiter(this, void 0, void 0, function* () {
            if (this.disarm)
                return;
            const messageData = {
                action: models_ChromeExternalMessaging__WEBPACK_IMPORTED_MODULE_0__/* .ChromeExternalMessagingAction */ .C.DOWNLOAD,
            };
            yield this.driver.evaluate(PlaywrightSendExtensionMessage, [messageData, this.extensionID]);
        });
    }
}

__webpack_exports__ = __webpack_exports__["default"];
/******/ 	return __webpack_exports__;
/******/ })()
;
});