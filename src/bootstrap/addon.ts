import * as toolBase from 'zotero-plugin-toolkit/dist/basic';
import { MenuManager } from 'zotero-plugin-toolkit/dist/managers/menu';
import { ReaderInstanceManager } from 'zotero-plugin-toolkit/dist/managers/readerInstance';
import { LibraryTabPanelManager } from 'zotero-plugin-toolkit/dist/managers/libraryTabPanel';
import { ReaderTabPanelManager } from 'zotero-plugin-toolkit/dist/managers/readerTabPanel';
import { PatcherManager } from 'zotero-plugin-toolkit/dist/managers/patch';
import { UITool } from 'zotero-plugin-toolkit/dist/tools/ui';
import { config, name as packageName } from '../../package.json';
import ReadingHistory from './modules/history/history';
import { hideDeleteMenuForHistory, patchedZoteroSearch } from './modules/history/misc';
import { registerPanels } from './modules/sidebar';
import buildRecentMenu from './modules/recent';
import { onHistoryRecord, onItemSelect, onNotify, openOverview, openReport } from './events';
import { addDebugMenu } from './modules/debug';
import addItemColumns from './modules/columns';
import { showMessage } from './modules/utils';

type DefaultPrefs = Omit<
    typeof config.defaultSettings,
    'excludedTags'
> & {
    excludedTags: number[];
};

export default class Addon extends toolBase.BasicTool {
    readonly ui: UITool;
    readonly menu: MenuManager;
    readonly patcher: PatcherManager;
    readonly reader: ReaderInstanceManager;
    readonly libTab: LibraryTabPanelManager;
    readonly readerTab: ReaderTabPanelManager;
    readonly history: ReadingHistory;
    readonly locale: typeof import('../../addon/locale/zh-CN/chartero.json');

    readonly rootURI = rootURI;
    overviewTabID?: string;
    private notifierID?: string;
    private readonly prefsObserverIDs: Symbol[] = [];

    constructor() {
        super();
        if (!__dev__) {
            this.basicOptions.log.prefix = `[${config.addonName}]`;
            this.basicOptions.log.disableConsole = true;
        }
        this.basicOptions.debug.disableDebugBridgePassword = __dev__;
        this.menu = new MenuManager(this);
        this.libTab = new LibraryTabPanelManager(this);
        this.readerTab = new ReaderTabPanelManager(this);
        this.reader = new ReaderInstanceManager(this);
        this.ui = new UITool(this);
        this.history = new ReadingHistory(this, onHistoryRecord);
        this.patcher = new PatcherManager(this);
        this.locale = JSON.parse(
            Zotero.File.getContentsFromURL(
                'chrome://chartero/locale/chartero.json'
            )
        );
        this.ui.basicOptions.ui.enableElementDOMLog = __dev__;
    }

    async translateLocaleStrings(): Promise<typeof this.locale> {
        if (!Zotero.PDFTranslate?.api?.translate) {
            showMessage(
                'PDFTranslate not found, using default locale!',
                'chrome://chartero/content/icons/exclamation.png'
            );
            return this.locale;
        }
        const locale = JSON.parse(
            Zotero.File.getContentsFromURL(rootURI + 'locale/zh-CN/chartero.json')
        ), translate = (str: string) =>
            str.startsWith('http') ? str : Zotero.PDFTranslate.api.translate(str, {
                pluginID: config.addonID,
                langfrom: 'zh-CN',
                langto: Zotero.locale
            }).then(
                (res: _ZoteroTypes.anyObj) => res.status == 'success' ? res.result : str
            );
        for (const key in locale)
            if (typeof locale[key] == 'string')
                locale[key] = await translate(locale[key]);
            else if (Array.isArray(locale[key]))
                locale[key] = await Promise.all(
                    locale[key].map(translate)
                );
            else
                for (const k in locale[key])
                    locale[key][k] = await translate(locale[key][k]);
        showMessage('Locale strings translated successfully!', 'chrome://chartero/content/icons/accept.png');
        return locale;
    }

    getPref<K extends keyof DefaultPrefs>(key: K) {
        // 若获取不到则使用默认值
        const pref = Zotero.Prefs.get(`${packageName}.${key}`) ?? JSON.stringify(
            config.defaultSettings[key]
        );
        if (__dev__)
            this.log(`Getting pref ${key}:`, pref);
        switch (typeof config.defaultSettings[key]) {
            case 'object':
                return JSON.parse(pref as string) as DefaultPrefs[K];
            case 'number':
                return Number(pref) as DefaultPrefs[K];
            default:
                return pref as DefaultPrefs[K];
        }
    }

    setPref<K extends keyof DefaultPrefs>(key: K, value?: DefaultPrefs[K]) {
        // 若未指定则设为默认值
        value ??= <DefaultPrefs[K]>config.defaultSettings[key];
        if (__dev__)
            this.log(`Setting pref ${key}:`, value);
        Zotero.Prefs.set(
            `${packageName}.${key}`,
            typeof value == 'object' ? JSON.stringify(value) : value
        );
    }

    // 仅供初始化调用
    private addPrefsObserver(fn: () => void, key: keyof DefaultPrefs) {
        this.prefsObserverIDs.push(
            Zotero.Prefs.registerObserver(`${packageName}.${key}`, fn)
        );
    }

    /**
     * 初始化插件时调用
     */
    init() {
        this.log('Initializing Chartero addon...');
        // 注册设置面板
        Zotero.PreferencePanes.register({
            pluginID: config.addonID,
            src: rootURI + 'content/preferences.xhtml',
            stylesheets: [rootURI + 'content/preferences.css'],
            image: `chrome://${config.addonName}/content/icons/icon32.png`,
            helpURL: this.locale.helpURL,
            label: config.addonName,
        });

        document.getElementById('zotero-itemmenu')?.addEventListener(
            'popupshowing',
            hideDeleteMenuForHistory
        );
        addItemColumns();

        // 注册Overview菜单
        this.menu.register('menuView', {
            tag: 'menuitem',
            label: this.locale.overview,
            commandListener: openOverview,
            icon: `chrome://${config.addonName}/content/icons/icon@16px.png`,
        });
        // this.menu.register('menuView', {
        //     tag: 'menuitem',
        //     label: '2023年度总结',
        //     commandListener: openReport,
        //     icon: `chrome://${config.addonName}/content/icons/icon@16px.png`,
        // });
        buildRecentMenu();
        if (__dev__)
            addDebugMenu();

        // 监听条目选择事件
        Zotero.uiReadyPromise.then(() =>
            ZoteroPane.itemsView.onSelect.addListener(onItemSelect)
        );
        this.notifierID = Zotero.Notifier.registerObserver(
            { notify: onNotify },
            ['tab', 'setting', 'item']
        );
        registerPanels();

        this.addPrefsObserver(() => {
            if (this.getPref('scanPeriod') < 1)
                addon.setPref('scanPeriod', 1);
            this.history.unregister();
            this.history.register(this.getPref('scanPeriod'));
        }, 'scanPeriod');
        this.addPrefsObserver(() => {
            const summaryFrame = document.getElementById('chartero-summary-iframe'),
                summaryWin = (summaryFrame as HTMLIFrameElement)?.contentWindow;
            summaryWin?.postMessage('updateExcludedTags');
            addon.log('Updating excluded tags');
        }, 'excludedTags');

        this.history.register(addon.getPref("scanPeriod"));
        this.patcher.register(
            Zotero.Search.prototype,
            "search",
            patchedZoteroSearch
        );
        this.log('Chartero initialized successfully!');

        // 这两个图标要先在主窗口加载出来才能在reader里显示
        this.ui.appendElement({
            tag: 'div',
            styles: {
                backgroundImage: "url('chrome://chartero/content/icons/images-toggled.png')"
            },
            children: [{
                tag: 'div',
                styles: {
                    backgroundImage: "url('chrome://chartero/content/icons/images.png')"
                }
            }]
        }, document.lastChild as HTMLElement);
    }

    unload() {
        this.overviewTabID && Zotero_Tabs.close(this.overviewTabID);
        this.notifierID && Zotero.Notifier.unregisterObserver(this.notifierID);
        this.prefsObserverIDs.forEach(id => Zotero.Prefs.unregisterObserver(id));
        ZoteroPane.itemsView.onSelect.removeListener(onItemSelect);
        document.getElementById('zotero-itemmenu')?.removeEventListener(
            'popupshowing',
            hideDeleteMenuForHistory
        );
        toolBase.unregister(this);
    }

    async test(it1: Zotero.Item, it2: Zotero.Item) {
        const att1 = await it1.getBestAttachment(),
            att2 = await it2.getBestAttachment(),
            text1 = att1 && await att1.attachmentText,
            text2 = att2 && await att2.attachmentText;
        // if (text1 && text2)
        //     this.log(jaccardSimilarity(text1, text2));
    }
}
