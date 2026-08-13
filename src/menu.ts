import { isDeepStrictEqual } from 'node:util';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { Universal } from 'koishi';
import type { QQBot } from './bot';
import { logDebug } from './logger';
import * as QQ from './types';

const GROUP_PANEL_REMARK = 'koishi-adapter-qq-crack';
const PANEL_WRITE_INTERVAL = 6500;
const PRIVATE_MENU_MAX_ITEMS = 10;
const GROUP_PANEL_MAX_ITEMS = 20;

interface MenuSyncState
{
  privateMenu: QQ.MenuItemConfig[];
  groupPanels: QQ.PanelItemConfig[];
  privateSlashCommands: Universal.Command[];
  groupSlashCommands: Universal.Command[];
}

interface GroupPanelSnapshot
{
  record: QQ.PanelRecord;
  items: QQ.PanelItem[];
  changed: boolean;
}

// 将适配器配置转换为 QQ 自定义菜单结构
function toSubMenuItem(config: QQ.SubMenuItemConfig): QQ.SubMenuItem
{
  const item: QQ.SubMenuItem = {
    name: config.name,
    type: config.type,
  };
  if (config.type === 'send_message')
  {
    item.send_message = config.value ?? '';
  } else
  {
    item.link = config.value ?? '';
  }
  return item;
}

function toMenuItem(config: QQ.MenuItemConfig): QQ.MenuItem
{
  const item: QQ.MenuItem = {
    name: config.name,
    type: config.type,
  };
  if (config.type === 'send_message')
  {
    item.send_message = config.value ?? '';
  } else if (config.type === 'link')
  {
    item.link = config.value ?? '';
  } else if (config.type === 'menu')
  {
    item.sub_menu_items = (config.subMenuItems ?? []).map(toSubMenuItem);
  } else
  {
    item.switch = {
      switch_id: config.value ?? config.name,
      default: !!config.switchDefault,
    };
  }
  return item;
}

function toPanelItem(config: QQ.PanelItemConfig): QQ.PanelItem
{
  const item: QQ.PanelItem = {
    name: config.name,
    desc: config.description ?? '',
    type: config.type,
    only_admin: !!config.onlyAdmin,
  };
  if (config.type === 'link')
  {
    item.link = config.value ?? '';
  }
  return item;
}

function commandText(name: string)
{
  return name.startsWith('/') ? name : `/${name}`;
}

function truncateText(value: string, max: number)
{
  return Array.from(value).slice(0, max).join('');
}

function commandDescription(command: Universal.Command)
{
  return command.description[''] || command.description['zh-CN'] || command.name;
}

function commandToSubMenuItem(command: Universal.Command): QQ.SubMenuItem
{
  return {
    name: truncateText(command.name, 13),
    type: 'send_message',
    send_message: commandText(command.name),
  };
}

// 私聊菜单按指令层级生成：父指令作为菜单项，子指令作为子菜单
function commandsToPrivateMenuItems(commands: Universal.Command[]): QQ.MenuItem[]
{
  return commands.slice(0, PRIVATE_MENU_MAX_ITEMS).map((command) =>
  {
    const children = command.children.slice(0, 5);
    if (children.length)
    {
      return {
        name: truncateText(command.name, 9),
        type: 'menu',
        sub_menu_items: children.map(commandToSubMenuItem),
      };
    }
    return {
      name: truncateText(command.name, 9),
      type: 'send_message',
      send_message: commandText(command.name),
    };
  });
}

// 群聊面板只注册一级指令，避免子指令数量过大
function commandsToPanelItems(commands: Universal.Command[]): QQ.PanelItem[]
{
  return commands.slice(0, GROUP_PANEL_MAX_ITEMS).map((command) =>
  {
    return {
      name: truncateText(commandText(command.name), 14),
      desc: truncateText(commandDescription(command), 30),
      type: 'command',
      only_admin: false,
    };
  });
}

// 平台返回字段可能缺省，比较前先归一到稳定结构
function normalizeSubMenuItems(items?: QQ.SubMenuItem[]): QQ.SubMenuItem[]
{
  return (items ?? []).map((item) =>
  {
    const result: QQ.SubMenuItem = {
      name: item.name,
      type: item.type,
    };
    if (item.type === 'send_message')
    {
      result.send_message = item.send_message ?? '';
    } else
    {
      result.link = item.link ?? '';
    }
    return result;
  });
}

function normalizeMenuItems(items?: QQ.MenuItem[]): QQ.MenuItem[]
{
  return (items ?? []).map((item) =>
  {
    const result: QQ.MenuItem = {
      name: item.name,
      type: item.type,
    };
    if (item.type === 'send_message')
    {
      result.send_message = item.send_message ?? '';
    } else if (item.type === 'link')
    {
      result.link = item.link ?? '';
    } else if (item.type === 'menu')
    {
      result.sub_menu_items = normalizeSubMenuItems(item.sub_menu_items);
    } else
    {
      result.switch = {
        switch_id: item.switch?.switch_id ?? '',
        default: !!item.switch?.default,
      };
    }
    return result;
  });
}

function normalizePanelItems(items?: QQ.PanelItem[]): QQ.PanelItem[]
{
  return (items ?? []).map((item) =>
  {
    const result: QQ.PanelItem = {
      name: item.name,
      desc: item.desc ?? '',
      type: item.type,
      only_admin: !!item.only_admin,
    };
    if (item.type === 'link')
    {
      result.link = item.link ?? '';
    }
    return result;
  });
}

function menuItemKey(item: QQ.MenuItem)
{
  return JSON.stringify(normalizeMenuItems([item])[0]);
}

function panelItemKey(item: QQ.PanelItem)
{
  return JSON.stringify(normalizePanelItems([item])[0]);
}

// 合并模式保留原有菜单，只把不重复的配置项追加到剩余空位
function mergeMenuItems(existing: QQ.MenuItem[], desired: QQ.MenuItem[]): QQ.MenuItem[]
{
  const result = [...existing];
  const seen = new Set(result.map(menuItemKey));
  for (const item of desired)
  {
    if (result.length >= PRIVATE_MENU_MAX_ITEMS) break;
    const key = menuItemKey(item);
    if (seen.has(key)) continue;
    result.push(item);
    seen.add(key);
  }
  return result;
}

function mergePanelItems(existing: QQ.PanelItem[], desired: QQ.PanelItem[]): QQ.PanelItem[]
{
  const result = [...existing];
  const seen = new Set(result.map(panelItemKey));
  for (const item of desired)
  {
    if (result.length >= GROUP_PANEL_MAX_ITEMS) break;
    const key = panelItemKey(item);
    if (seen.has(key)) continue;
    result.push(item);
    seen.add(key);
  }
  return result;
}

function removeMenuItems(items: QQ.MenuItem[], removed: QQ.MenuItem[]): QQ.MenuItem[]
{
  const removedKeys = new Set(removed.map(menuItemKey));
  return items.filter(item => !removedKeys.has(menuItemKey(item)));
}

function removePanelItems(items: QQ.PanelItem[], removed: QQ.PanelItem[]): QQ.PanelItem[]
{
  const removedKeys = new Set(removed.map(panelItemKey));
  return items.filter(item => !removedKeys.has(panelItemKey(item)));
}

function isMenuEqual(current: QQ.Menu | undefined, desired: QQ.MenuItem[])
{
  return isDeepStrictEqual(normalizeMenuItems(current?.items), normalizeMenuItems(desired));
}

function isQuantityLimitError(error: unknown)
{
  if (!error || typeof error !== 'object') return false;
  const response = (error as { response?: { data?: { err_code?: number; code?: number; }; }; }).response;
  return response?.data?.err_code === 40030013 || response?.data?.code === 30013;
}

export class MenuManager
{
  private syncPromise?: Promise<void>;
  private disposed = false;
  private lastPanelWriteAt = 0;
  private stateLoaded = false;
  private state: MenuSyncState = {
    privateMenu: [],
    groupPanels: [],
    privateSlashCommands: [],
    groupSlashCommands: [],
  };

  constructor(private readonly bot: QQBot) { }

  async sync()
  {
    if (this.disposed) return;
    if (this.syncPromise) return this.syncPromise;
    this.syncPromise = this.run().finally(() =>
    {
      this.syncPromise = undefined;
    });
    return this.syncPromise;
  }

  dispose()
  {
    this.disposed = true;
  }

  private async run()
  {
    this.state = await this.loadState();
    this.stateLoaded = true;
    // 两个接口相互独立，避免单聊菜单失败后跳过群聊面板同步
    await this.syncPrivateMenu().catch((error) =>
    {
      this.bot.logger.warn('同步单聊自定义菜单失败：%o', error);
    });
    if (this.disposed) return;
    await this.syncGroupPanels().catch((error) =>
    {
      if (isQuantityLimitError(error))
      {
        logDebug(this.bot.config, '同步群聊指令面板失败：%o', error);
      } else
      {
        this.bot.logger.warn('同步群聊指令面板失败：%o', error);
      }
    });
  }

  async syncSlashCommands(commands: Universal.Command[])
  {
    if (this.disposed) return;
    if (!this.stateLoaded)
    {
      this.state = await this.loadState();
      this.stateLoaded = true;
    }
    await this.syncPrivateSlashCommands(commands).catch((error) =>
    {
      this.bot.logger.warn('同步私聊斜杠指令失败：%o', error);
    });
    if (this.disposed) return;
    await this.syncGroupSlashCommands(commands).catch((error) =>
    {
      if (isQuantityLimitError(error))
      {
        logDebug(this.bot.config, '同步群聊斜杠指令失败：%o', error);
      } else
      {
        this.bot.logger.warn('同步群聊斜杠指令失败：%o', error);
      }
    });
  }

  private async syncPrivateMenu()
  {
    if (this.bot.config.privateSlash) return;
    const currentConfig = this.bot.config.privateMenu ?? [];
    const previousConfig = this.state.privateMenu;
    const desiredItems = currentConfig.map(toMenuItem);

    if (this.bot.config.privateMenuOverride)
    {
      const current = await this.bot.internal.getMenu();
      logDebug(this.bot.config, 'private menu current: %o, desired: %o', current?.menu, desiredItems);
      // 覆盖模式：平台菜单完全以配置项为准
      if (!isMenuEqual(current?.menu, desiredItems))
      {
        const desired: QQ.Menu = { items: desiredItems };
        await this.bot.internal.setMenu({ menu: desired });
        logDebug(this.bot.config, 'private menu overridden: %o', desired);
      }
      if (this.disposed) return;
      this.state.privateMenu = currentConfig;
      await this.saveState();
      return;
    }

    // 合并模式：配置和上次本地快照一致时，不再调用平台接口
    if (isDeepStrictEqual(currentConfig, previousConfig)) return;

    const previousItems = previousConfig.map(toMenuItem);
    const current = await this.bot.internal.getMenu();
    logDebug(this.bot.config, 'private menu current: %o, desired: %o', current?.menu, desiredItems);

    const existingItems = current?.menu?.items ?? [];
    const remainingItems = removeMenuItems(existingItems, previousItems);
    const mergedItems = mergeMenuItems(remainingItems, desiredItems);
    if (!isDeepStrictEqual(normalizeMenuItems(mergedItems), normalizeMenuItems(existingItems)))
    {
      await this.bot.internal.setMenu({
        menu: {
          items: mergedItems,
        },
      });
      logDebug(this.bot.config, 'private menu merged: %o', mergedItems);
    }
    if (this.disposed) return;
    this.state.privateMenu = currentConfig;
    await this.saveState();
  }

  private async syncGroupPanels()
  {
    if (this.bot.config.groupSlash) return;
    if (this.bot.config.groupPanelsOverride)
    {
      await this.syncGroupPanelsOverride();
    } else
    {
      await this.syncGroupPanelsMerge();
    }
  }

  private async syncGroupPanelsOverride()
  {
    const desiredItems = (this.bot.config.groupPanels ?? []).map(toPanelItem);
    const records = await this.listGroupPanels();
    // 覆盖模式：群聊场景只保留一个与配置项完全一致的全局面板
    const matching = desiredItems.length
      ? records.find(record => record.target_type === 'all' && isDeepStrictEqual(normalizePanelItems(record.panel?.items), normalizePanelItems(desiredItems)))
      : undefined;

    let createdPanelId: string | undefined;
    if (desiredItems.length && !matching)
    {
      if (this.disposed) return;
      await this.waitForPanelWriteSlot();
      if (this.disposed) return;
      const created = await this.createGroupPanelWithFallback(desiredItems);
      createdPanelId = created.panel_id;
      logDebug(this.bot.config, 'group panel created: %s', createdPanelId);
    }

    for (const record of records)
    {
      if (this.disposed) return;
      if (matching && record.panel_id === matching.panel_id) continue;
      if (createdPanelId && record.panel_id === createdPanelId) continue;
      await this.waitForPanelWriteSlot();
      if (this.disposed) return;
      await this.bot.internal.deletePanel(record.panel_id);
      logDebug(this.bot.config, 'group panel deleted: %s', record.panel_id);
    }
    if (this.disposed) return;
    this.state.groupPanels = this.bot.config.groupPanels ?? [];
    await this.saveState();
  }

  private async syncGroupPanelsMerge()
  {
    const currentConfig = this.bot.config.groupPanels ?? [];
    const previousConfig = this.state.groupPanels;
    const desiredItems = currentConfig.map(toPanelItem);
    const previousItems = previousConfig.map(toPanelItem);

    // 合并模式：配置和上次本地快照一致时，不再调用平台接口
    if (isDeepStrictEqual(currentConfig, previousConfig)) return;

    const records = await this.listGroupPanels();
    const snapshots: GroupPanelSnapshot[] = records
      .filter(record => record.target_type === 'all')
      .map(record => ({
        record,
        items: record.panel?.items ?? [],
        changed: false,
      }));

    // 先从平台面板中移除上次由配置项添加、这次已被删除的指令
    for (const snapshot of snapshots)
    {
      const nextItems = removePanelItems(snapshot.items, previousItems);
      if (nextItems.length !== snapshot.items.length)
      {
        snapshot.items = nextItems;
        snapshot.changed = true;
      }
    }

    // 优先选择仍有空位的全局面板，避免第一个面板已满时错过可追加位置
    const target = snapshots.find(snapshot => snapshot.items.length < GROUP_PANEL_MAX_ITEMS)
      ?? snapshots[0];

    if (!target && desiredItems.length)
    {
      const items = desiredItems.slice(0, GROUP_PANEL_MAX_ITEMS);
      if (this.disposed) return;
      await this.waitForPanelWriteSlot();
      if (this.disposed) return;
      const created = await this.createGroupPanelWithFallback(items);
      logDebug(this.bot.config, 'group panel created: %s', created.panel_id);
      if (this.disposed) return;
      this.state.groupPanels = currentConfig;
      await this.saveState();
      return;
    }

    if (target)
    {
      const mergedItems = mergePanelItems(target.items, desiredItems);
      if (!isDeepStrictEqual(normalizePanelItems(mergedItems), normalizePanelItems(target.items)))
      {
        target.items = mergedItems;
        target.changed = true;
      }
    }

    for (const snapshot of snapshots)
    {
      if (!snapshot.changed || this.disposed) continue;
      await this.waitForPanelWriteSlot();
      if (this.disposed) return;
      await this.bot.internal.modifyPanel(snapshot.record.panel_id, {
        panel: {
          items: snapshot.items,
          remark: snapshot.record.panel?.remark ?? '',
        },
      });
      logDebug(this.bot.config, 'group panel merged: %s %o', snapshot.record.panel_id, snapshot.items);
    }

    if (this.disposed) return;
    this.state.groupPanels = currentConfig;
    await this.saveState();
  }

  private async syncPrivateSlashCommands(commands: Universal.Command[])
  {
    if (!this.bot.config.privateSlash) return;
    const desiredItems = commandsToPrivateMenuItems(commands);
    const previousCommands = this.state.privateSlashCommands;

    if (this.bot.config.privateMenuOverride)
    {
      const current = await this.bot.internal.getMenu();
      logDebug(this.bot.config, 'private slash menu current: %o, desired: %o', current?.menu, desiredItems);
      if (!isMenuEqual(current?.menu, desiredItems))
      {
        await this.bot.internal.setMenu({ menu: { items: desiredItems } });
        logDebug(this.bot.config, 'private slash menu overridden: %o', desiredItems);
      }
      if (this.disposed) return;
      this.state.privateSlashCommands = commands;
      await this.saveState();
      return;
    }

    if (isDeepStrictEqual(commands, previousCommands)) return;
    const previousItems = commandsToPrivateMenuItems(previousCommands);
    const current = await this.bot.internal.getMenu();
    logDebug(this.bot.config, 'private slash menu current: %o, desired: %o', current?.menu, desiredItems);

    const existingItems = current?.menu?.items ?? [];
    const remainingItems = removeMenuItems(existingItems, previousItems);
    const mergedItems = mergeMenuItems(remainingItems, desiredItems);
    if (!isDeepStrictEqual(normalizeMenuItems(mergedItems), normalizeMenuItems(existingItems)))
    {
      await this.bot.internal.setMenu({ menu: { items: mergedItems } });
      logDebug(this.bot.config, 'private slash menu merged: %o', mergedItems);
    }
    if (this.disposed) return;
    this.state.privateSlashCommands = commands;
    await this.saveState();
  }

  private async syncGroupSlashCommands(commands: Universal.Command[])
  {
    if (!this.bot.config.groupSlash) return;
    const desiredItems = commandsToPanelItems(commands);
    const previousCommands = this.state.groupSlashCommands;

    if (this.bot.config.groupPanelsOverride)
    {
      await this.syncGroupSlashOverride(desiredItems);
    } else
    {
      if (isDeepStrictEqual(commands, previousCommands)) return;
      const previousItems = commandsToPanelItems(previousCommands);
      await this.syncGroupSlashMerge(desiredItems, previousItems);
    }

    if (this.disposed) return;
    this.state.groupSlashCommands = commands;
    await this.saveState();
  }

  private async syncGroupSlashOverride(desiredItems: QQ.PanelItem[])
  {
    const records = await this.listGroupPanels();
    const matching = desiredItems.length
      ? records.find(record => record.target_type === 'all' && isDeepStrictEqual(normalizePanelItems(record.panel?.items), normalizePanelItems(desiredItems)))
      : undefined;

    let createdPanelId: string | undefined;
    if (desiredItems.length && !matching)
    {
      if (this.disposed) return;
      await this.waitForPanelWriteSlot();
      if (this.disposed) return;
      const created = await this.createGroupPanelWithFallback(desiredItems);
      createdPanelId = created.panel_id;
      logDebug(this.bot.config, 'group slash panel created: %s', createdPanelId);
    }

    for (const record of records)
    {
      if (this.disposed) return;
      if (matching && record.panel_id === matching.panel_id) continue;
      if (createdPanelId && record.panel_id === createdPanelId) continue;
      await this.waitForPanelWriteSlot();
      if (this.disposed) return;
      await this.bot.internal.deletePanel(record.panel_id);
      logDebug(this.bot.config, 'group slash panel deleted: %s', record.panel_id);
    }
  }

  private async syncGroupSlashMerge(desiredItems: QQ.PanelItem[], previousItems: QQ.PanelItem[])
  {
    const records = await this.listGroupPanels();
    const snapshots: GroupPanelSnapshot[] = records
      .filter(record => record.target_type === 'all')
      .map(record => ({
        record,
        items: record.panel?.items ?? [],
        changed: false,
      }));

    for (const snapshot of snapshots)
    {
      const nextItems = removePanelItems(snapshot.items, previousItems);
      if (nextItems.length !== snapshot.items.length)
      {
        snapshot.items = nextItems;
        snapshot.changed = true;
      }
    }

    const target = snapshots.find(snapshot => snapshot.items.length < GROUP_PANEL_MAX_ITEMS)
      ?? snapshots[0];

    if (!target && desiredItems.length)
    {
      if (this.disposed) return;
      await this.waitForPanelWriteSlot();
      if (this.disposed) return;
      const created = await this.createGroupPanelWithFallback(desiredItems.slice(0, GROUP_PANEL_MAX_ITEMS));
      logDebug(this.bot.config, 'group slash panel created: %s', created.panel_id);
      return;
    }

    if (target)
    {
      const mergedItems = mergePanelItems(target.items, desiredItems);
      if (!isDeepStrictEqual(normalizePanelItems(mergedItems), normalizePanelItems(target.items)))
      {
        target.items = mergedItems;
        target.changed = true;
      }
    }

    for (const snapshot of snapshots)
    {
      if (!snapshot.changed || this.disposed) continue;
      await this.waitForPanelWriteSlot();
      if (this.disposed) return;
      await this.bot.internal.modifyPanel(snapshot.record.panel_id, {
        panel: {
          items: snapshot.items,
          remark: snapshot.record.panel?.remark ?? '',
        },
      });
      logDebug(this.bot.config, 'group slash panel merged: %s %o', snapshot.record.panel_id, snapshot.items);
    }
  }

  private async createGroupPanelWithFallback(items: QQ.PanelItem[])
  {
    try
    {
      return await this.bot.internal.createPanel({
        scope: 'group',
        target_type: 'all',
        panel: {
          items,
          remark: GROUP_PANEL_REMARK,
        },
      });
    } catch (error)
    {
      if (isQuantityLimitError(error) && items.length > 10)
      {
        logDebug(this.bot.config, 'group panel item limit hit, retrying with 10 items');
        return this.createGroupPanelWithFallback(items.slice(0, 10));
      }
      throw error;
    }
  }

  private async waitForPanelWriteSlot()
  {
    const wait = Math.max(0, this.lastPanelWriteAt + PANEL_WRITE_INTERVAL - Date.now());
    if (wait > 0)
    {
      await this.bot.ctx.sleep(wait);
    }
    this.lastPanelWriteAt = Date.now();
  }

  private getStatePath()
  {
    const appId = String(this.bot.config.id || 'default').replace(/[^a-zA-Z0-9_-]/g, '_');
    return join(this.bot.ctx.baseDir, 'data', 'adapter', 'adapter-qq-crack', `menu-state-${appId}.json`);
  }

  private async loadState(): Promise<MenuSyncState>
  {
    try
    {
      const raw = await readFile(this.getStatePath(), 'utf8');
      const data = JSON.parse(raw) as Partial<MenuSyncState>;
      return {
        privateMenu: Array.isArray(data.privateMenu) ? data.privateMenu : [],
        groupPanels: Array.isArray(data.groupPanels) ? data.groupPanels : [],
        privateSlashCommands: Array.isArray(data.privateSlashCommands) ? data.privateSlashCommands : [],
        groupSlashCommands: Array.isArray(data.groupSlashCommands) ? data.groupSlashCommands : [],
      };
    } catch (error)
    {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
      {
        this.bot.logger.warn('读取指令菜单状态失败：%o', error);
      }
      return {
        privateMenu: [],
        groupPanels: [],
        privateSlashCommands: [],
        groupSlashCommands: [],
      };
    }
  }

  private async saveState()
  {
    try
    {
      const path = this.getStatePath();
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, JSON.stringify(this.state, null, 2), 'utf8');
    } catch (error)
    {
      this.bot.logger.warn('保存指令菜单状态失败：%o', error);
    }
  }

  private async listGroupPanels()
  {
    const records: QQ.PanelRecord[] = [];
    const seen = new Set<string>();
    let cursor = '';
    // 最多一页即可拉完时，通常一次返回；仍按分页协议兼容处理
    while (!this.disposed)
    {
      const page = await this.bot.internal.getPanels({
        scope: 'group',
        cursor,
        limit: 50,
      });
      records.push(...(page.records ?? []));
      if (page.is_end || !page.next_cursor) break;
      if (seen.has(page.next_cursor)) break;
      seen.add(page.next_cursor);
      cursor = page.next_cursor;
    }
    return records;
  }
}
