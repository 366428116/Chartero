import { showMessage } from '../utils';
import { AttachmentRecord } from './data';

// 防止阅读器侧边栏搜索到主条目下的笔记
export const patchedZoteroSearch = (origin: Function) =>
    async function (this: Zotero.Search, asTempTable: boolean) {
        const ids: number[] = await origin.apply(this, asTempTable), // 原始搜索结果
            conditions = this.getConditions(); // 当前搜索的条件
        if (
            !asTempTable &&
            !conditions[2] &&
            conditions[0]?.condition == "libraryID" &&
            conditions[0]?.operator == "is" &&
            conditions[1]?.condition == "itemType" &&
            conditions[1]?.operator == "is" &&
            conditions[1]?.value == "note"
        ) {
            const mainItemKey = (
                await addon.history.getMainItem(parseInt(conditions[0].value))
            ).key; // 必须在这个if语句内，否则可能产生递归！
            // window.console.trace(ids, conditions, mainItemKey);
            return ids.filter(
                (id) => Zotero.Items.get(id).parentItemKey != mainItemKey
            );
        } else return ids;
    }

export async function protectData(event: string, ids: number[] | string[]) {
    const restore = (item: Zotero.DataObject) => {
        Zotero.debug(addon.locale.deletingItem);
        Zotero.debug(item);
        // 恢复被删的条目
        item.deleted = false;
        item.saveTx({ skipDateModifiedUpdate: true, skipNotifier: true });
    },
        items = ids.map((id) => Zotero.Items.get(id)), // 触发事件的条目
        mainItems = items.filter(addon.history.isMainItem); // 筛选出的主条目

    switch (event) {
        case "trash":
            mainItems.forEach(restore); // 恢复所有被删的主条目
            for (const it of items)
                if (await addon.history.isHistoryNote(it))
                    restore(it); // 恢复主条目下所有笔记
            break;

        case "modify":
            mainItems.forEach((it) => {
                // TODO: 若archiveLocation已被修改，则此处无法获取，考虑patch setField
            });
            for (const it of items)
                if (await addon.history.isHistoryNote(it))
                    window.alert(addon.locale.modifyingNote);
            break; // TODO：此处并不能阻止修改，且保存时需skipNotify

        default:
            break;
    }
}

export async function importLegacyHistory(str: string) {
    try {
        const json = JSON.parse(str);
        if (typeof json.lib != 'number' && typeof json.items != 'object')
            throw new Error(addon.locale.historyParseError);

        const total = Object.keys(json.items).length,
            mainItem: Zotero.Item =
                await addon.history.getMainItem();
        Zotero.showZoteroPaneProgressMeter(
            addon.locale.migratingLegacy,
            true
        );
        window.focus();
        let i = 0;
        for (const key in json.items) {
            const item = Zotero.Items.getByLibraryAndKey(1, key);
            if (!item) continue;

            const oldJson = json.items[key],
                newJson = {
                    numPages: oldJson.n,
                    pages: {} as _ZoteroTypes.anyObj,
                },
                noteItem = new Zotero.Item('note');
            for (const page in oldJson.p)
                newJson.pages[page] = { p: oldJson.p[page].t };

            const record = new AttachmentRecord(newJson);
            addon.history.compress(record);
            // noteItem.setNote(
            //     `chartero#${key}\n${JSON.stringify(record)}`
            // );
            // noteItem.parentID = mainItem.id;
            // noteItem.addRelatedItem(item as Zotero.Item);
            // await noteItem.saveTx();

            Zotero.updateZoteroPaneProgressMeter((++i * 100) / total);
        }
        addon.history.loadAll();
        showMessage(
            addon.locale.migrationFinished,
            'chrome://chartero/content/icons/accept.png'
        );
    } catch (error) {
        window.alert(error);
    } finally {
        Zotero.hideZoteroPaneOverlays();
    }
}