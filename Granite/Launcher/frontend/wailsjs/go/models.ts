export namespace main {
	
	export class SteamStatus {
	    installed: boolean;
	    running: boolean;
	    loggedIn: boolean;
	    accountId: number;
	    steamId64: string;
	    personaName: string;
	    accountName: string;
	    avatarUrl: string;
	
	    static createFrom(source: any = {}) {
	        return new SteamStatus(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.installed = source["installed"];
	        this.running = source["running"];
	        this.loggedIn = source["loggedIn"];
	        this.accountId = source["accountId"];
	        this.steamId64 = source["steamId64"];
	        this.personaName = source["personaName"];
	        this.accountName = source["accountName"];
	        this.avatarUrl = source["avatarUrl"];
	    }
	}
	export class FileStatus {
	    launcherDir: string;
	    gamePath: string;
	    gameOk: boolean;
	    injectorOk: boolean;
	    moduleOk: boolean;
	    iniExists: boolean;
	    gameRunning: boolean;
	    busy: boolean;
	    steam: SteamStatus;
	
	    static createFrom(source: any = {}) {
	        return new FileStatus(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.launcherDir = source["launcherDir"];
	        this.gamePath = source["gamePath"];
	        this.gameOk = source["gameOk"];
	        this.injectorOk = source["injectorOk"];
	        this.moduleOk = source["moduleOk"];
	        this.iniExists = source["iniExists"];
	        this.gameRunning = source["gameRunning"];
	        this.busy = source["busy"];
	        this.steam = this.convertValues(source["steam"], SteamStatus);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class LocalizedText {
	    zh: string;
	    en: string;
	
	    static createFrom(source: any = {}) {
	        return new LocalizedText(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.zh = source["zh"];
	        this.en = source["en"];
	    }
	}
	export class ToggleDef {
	    index: number;
	    category: string;
	    section: string;
	    key: string;
	    label: LocalizedText;
	    description: LocalizedText;
	    defaultValue: boolean;
	
	    static createFrom(source: any = {}) {
	        return new ToggleDef(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.index = source["index"];
	        this.category = source["category"];
	        this.section = source["section"];
	        this.key = source["key"];
	        this.label = this.convertValues(source["label"], LocalizedText);
	        this.description = this.convertValues(source["description"], LocalizedText);
	        this.defaultValue = source["defaultValue"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class SettingsData {
	    host: string;
	    port: string;
	    toggles: boolean[];
	
	    static createFrom(source: any = {}) {
	        return new SettingsData(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.host = source["host"];
	        this.port = source["port"];
	        this.toggles = source["toggles"];
	    }
	}
	export class Preferences {
	    dark: boolean;
	    locale: string;
	
	    static createFrom(source: any = {}) {
	        return new Preferences(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.dark = source["dark"];
	        this.locale = source["locale"];
	    }
	}
	export class InitialState {
	    preferences: Preferences;
	    settings: SettingsData;
	    toggleDefs: ToggleDef[];
	    files: FileStatus;
	    loadWarning?: LocalizedText;
	    pathWarning?: LocalizedText;
	
	    static createFrom(source: any = {}) {
	        return new InitialState(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.preferences = this.convertValues(source["preferences"], Preferences);
	        this.settings = this.convertValues(source["settings"], SettingsData);
	        this.toggleDefs = this.convertValues(source["toggleDefs"], ToggleDef);
	        this.files = this.convertValues(source["files"], FileStatus);
	        this.loadWarning = this.convertValues(source["loadWarning"], LocalizedText);
	        this.pathWarning = this.convertValues(source["pathWarning"], LocalizedText);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	
	
	export class SaveConnectionResult {
	    ok: boolean;
	    host: string;
	    port: string;
	    iniExists: boolean;
	    hostError?: LocalizedText;
	    portError?: LocalizedText;
	    message: LocalizedText;
	
	    static createFrom(source: any = {}) {
	        return new SaveConnectionResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.ok = source["ok"];
	        this.host = source["host"];
	        this.port = source["port"];
	        this.iniExists = source["iniExists"];
	        this.hostError = this.convertValues(source["hostError"], LocalizedText);
	        this.portError = this.convertValues(source["portError"], LocalizedText);
	        this.message = this.convertValues(source["message"], LocalizedText);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class SaveModuleResult {
	    ok: boolean;
	    changed: number;
	    iniExists: boolean;
	    toggles: boolean[];
	    message: LocalizedText;
	
	    static createFrom(source: any = {}) {
	        return new SaveModuleResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.ok = source["ok"];
	        this.changed = source["changed"];
	        this.iniExists = source["iniExists"];
	        this.toggles = source["toggles"];
	        this.message = this.convertValues(source["message"], LocalizedText);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class SelectGameResult {
	    cancelled: boolean;
	    ok: boolean;
	    saved: boolean;
	    gamePath: string;
	    files: FileStatus;
	    message?: LocalizedText;
	
	    static createFrom(source: any = {}) {
	        return new SelectGameResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.cancelled = source["cancelled"];
	        this.ok = source["ok"];
	        this.saved = source["saved"];
	        this.gamePath = source["gamePath"];
	        this.files = this.convertValues(source["files"], FileStatus);
	        this.message = this.convertValues(source["message"], LocalizedText);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	
	export class StartLaunchResult {
	    started: boolean;
	    files?: FileStatus;
	    message?: LocalizedText;
	
	    static createFrom(source: any = {}) {
	        return new StartLaunchResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.started = source["started"];
	        this.files = this.convertValues(source["files"], FileStatus);
	        this.message = this.convertValues(source["message"], LocalizedText);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	

}

