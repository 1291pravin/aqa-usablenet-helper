import { Page } from '@playwright/test';

export declare const enum DeviceId {
	DESKTOP_1 = "device_0",
	DESKTOP_2 = "device_1",
	DESKTOP_3 = "device_2",
	MOBILE_1 = "device_3",
	CUSTOM = "custom"
}
export type PresetDeviceId = DeviceId.DESKTOP_1 | DeviceId.DESKTOP_2 | DeviceId.DESKTOP_3 | DeviceId.MOBILE_1;
export declare const enum ChromeExternalMessagingAction {
	CREATE_FLOW = "bg-ext-create-flow",
	DO_SNAPSHOT = "bg-ext-do-snapshot",
	DOWNLOAD = "bg-ext-download-flow",
	HEALTH_CHECK = "bg-ext-health-check",
	NETWORK_ADD_RESOURCE = "bg-ext-add-network-resource",
	UPLOAD = "bg-ext-upload"
}
export interface ChromeExtMsgUploadToAqa {
	action: ChromeExternalMessagingAction.UPLOAD;
	payload: {
		name: string;
		suite: string;
		team: string;
		xTeam: string;
		description?: string;
		testId?: string;
	};
}
export type AQAPageCapturePluginOptions = Pick<ChromeExtMsgUploadToAqa["payload"], "suite" | "team" | "xTeam"> & {
	testId?: string;
	disarm?: boolean;
	ignoreErrors?: boolean;
};
export type DeviceLabel = "1280x1024" | "1366x668" | "1536x864";
declare class AQAPageCapturePluginCore {
	readonly extensionID = "llaaiankjgnonjipogopofnpahaoccfo";
	version: string;
	readonly devices: Record<DeviceLabel, PresetDeviceId>;
	readonly errors: {
		CREATE_FLOW: string;
		CREATE_FLOW_WITH_NAME: string;
		CREATE_FLOW_MISSING_NAME: string;
		EXTENSION_NOT_FOUND: string;
		SNAPSHOT: string;
		UNABLE_TO_CONNECT: string;
		UPLOAD_ZIP: string;
	};
	ignoreErrors: boolean;
	disarm: boolean;
	uploadFlowData: ChromeExtMsgUploadToAqa["payload"];
	constructor(options: AQAPageCapturePluginOptions);
	static nameTimeStamp(): string;
	static log(msg: string): void;
	throwError(message: string): void;
}
declare class AQAPageCapturePlugin extends AQAPageCapturePluginCore {
	private readonly driver;
	constructor(driver: Page, options: AQAPageCapturePluginOptions);
	static computeSize(body: string): number;
	static init(driver: Page, options: AQAPageCapturePluginOptions): Promise<AQAPageCapturePlugin>;
	initNetworkConnection(): Promise<void>;
	checkExtensionAvailable(): Promise<void>;
	createFlow(options: {
		name: string;
		description?: string;
		device?: DeviceLabel;
	}): Promise<void>;
	doSnapshot(pageName?: string): Promise<void>;
	uploadZip(): Promise<void>;
	downloadFlowSnapshot(): Promise<void>;
}

export {
	AQAPageCapturePlugin as default,
};

export {};
