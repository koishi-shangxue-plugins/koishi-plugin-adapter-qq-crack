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
  privateSlashCommands: Universal.Command[];
  groupSlashCommands: Universal.Command[];
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

function isMenuEqual(current: QQ.Menu | undefined, desired: QQ.MenuItem[])
{
  return isDeepStrictEqual(normalizeMenuItems(current?.items), normalizeMenuItems(desired));
}

function getErrorCode(error: unknown)
{
  if (!error || typeof error !== 'object') return;
  const detail = error as {
    code?: number;
    err?: number;
    response?: { data?: { err_code?: number; code?: number; err?: number; }; };
  };
  const data = detail.response?.data;
  return data?.err_code ?? detail.err ?? data?.code ?? detail.code ?? data?.err;
}

function isQuantityLimitError(error: unknown)
{
  return getErrorCode(error) === 40030013;
}

function isPanelNotFoundError(error: unknown)
{
  return getErrorCode(error) === 40030006;
}

export class MenuManager
{
  private syncPromise?: Promise<void>;
  private disposed = false;
  private lastPanelWriteAt = 0;
  private panelWriteQueue: Promise<void> = Promise.resolve();
  private stateLoaded = false;
  private state: MenuSyncState = {
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
        this.bot.logger.warn('同步群聊指令面板失败：QQ 指令面板数量超出限制');
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
        this.bot.logger.warn('同步群聊斜杠指令失败：QQ 指令面板数量超出限制');
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
    if (!currentConfig.length) return;
    const desiredItems = currentConfig.map(toMenuItem);
    const current = await this.bot.internal.getMenu();
    logDebug(this.bot.config, 'private menu current: %o, desired: %o', current?.menu, desiredItems);
    if (!isMenuEqual(current?.menu, desiredItems))
    {
      const desired: QQ.Menu = { items: desiredItems };
      await this.bot.internal.setMenu({ menu: desired });
      logDebug(this.bot.config, 'private menu overridden: %o', desired);
    }
  }

  private async syncGroupPanels()
  {
    if (this.bot.config.groupSlash) return;
    const currentConfig = this.bot.config.groupPanels ?? [];
    if (!currentConfig.length) return;
    const desiredItems = currentConfig.map(toPanelItem);
    await this.syncGroupPanelItems(desiredItems, 'group panel');
  }

  private async syncPrivateSlashCommands(commands: Universal.Command[])
  {
    if (!this.bot.config.privateSlash) return;
    if (!commands.length) return;
    const desiredItems = commandsToPrivateMenuItems(commands);
    if (commands.length > PRIVATE_MENU_MAX_ITEMS)
    {
      this.bot.logger.warn('私聊指令超过菜单上限，仅同步前 %d 个', PRIVATE_MENU_MAX_ITEMS);
    }
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
  }

  private async syncGroupSlashCommands(commands: Universal.Command[])
  {
    if (!this.bot.config.groupSlash) return;
    if (!commands.length) return;
    const desiredItems = commandsToPanelItems(commands);
    if (commands.length > GROUP_PANEL_MAX_ITEMS)
    {
      this.bot.logger.warn('群聊指令超过单个面板上限，仅同步前 %d 个', GROUP_PANEL_MAX_ITEMS);
    }
    await this.syncGroupPanelItems(desiredItems, 'group slash panel');

    if (this.disposed) return;
    this.state.groupSlashCommands = commands;
    await this.saveState();
  }

  private async syncGroupPanelItems(desiredItems: QQ.PanelItem[], label: string)
  {
    const records = await this.listGroupPanels();
    const target = records.find(record => record.target_type === 'all');
    if (!target)
    {
      // 没有全局面板时先释放其他面板配额，再创建配置面板。
      for (const record of records)
      {
        await this.deletePanelRecord(record, label);
        if (this.disposed) return;
      }
      await this.createPanelRecord(desiredItems, label);
      return;
    }

    if (!isDeepStrictEqual(normalizePanelItems(target.panel?.items), normalizePanelItems(desiredItems)))
    {
      await this.modifyPanelRecord(target, desiredItems, label);
    }
    if (this.disposed) return;

    for (const record of records)
    {
      if (record.panel_id === target.panel_id) continue;
      await this.deletePanelRecord(record, label);
      if (this.disposed) return;
    }
  }

  private async createPanelRecord(items: QQ.PanelItem[], label: string)
  {
    await this.waitForPanelWriteSlot();
    if (this.disposed) return;
    const created = await this.bot.internal.createPanel({
      scope: 'group',
      target_type: 'all',
      panel: {
        items,
        remark: GROUP_PANEL_REMARK,
      },
    });
    logDebug(this.bot.config, '%s created: %s', label, created.panel_id);
    return created;
  }

  private async modifyPanelRecord(record: QQ.PanelRecord, items: QQ.PanelItem[], label: string)
  {
    await this.waitForPanelWriteSlot();
    if (this.disposed) return;
    await this.bot.internal.modifyPanel(record.panel_id, {
      panel: {
        items,
        remark: record.panel?.remark ?? GROUP_PANEL_REMARK,
      },
    });
    logDebug(this.bot.config, '%s modified: %s %o', label, record.panel_id, items);
  }

  private async deletePanelRecord(record: QQ.PanelRecord, label: string)
  {
    await this.waitForPanelWriteSlot();
    if (this.disposed) return;
    try
    {
      await this.bot.internal.deletePanel(record.panel_id);
      logDebug(this.bot.config, '%s deleted: %s', label, record.panel_id);
    } catch (error)
    {
      // 面板已被平台替换或删除时，继续同步其余面板。
      if (!isPanelNotFoundError(error)) throw error;
      logDebug(this.bot.config, '%s already missing: %s', label, record.panel_id);
    }
  }

  private async waitForPanelWriteSlot()
  {
    const previous = this.panelWriteQueue;
    let release!: () => void;
    this.panelWriteQueue = new Promise<void>((resolve) =>
    {
      release = resolve;
    });
    await previous;
    try
    {
      const wait = Math.max(0, this.lastPanelWriteAt + PANEL_WRITE_INTERVAL - Date.now());
      if (wait > 0)
      {
        await this.bot.ctx.sleep(wait);
      }
      this.lastPanelWriteAt = Date.now();
    } finally
    {
      release();
    }
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
