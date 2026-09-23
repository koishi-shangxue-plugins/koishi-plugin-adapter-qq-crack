import { Dict, h } from 'koishi';
import * as QQ from './types';

export type QQMarkdownRequest = Omit<QQ.Message.Request, 'msg_id' | 'msg_seq' | 'event_id'>;
export interface QQMarkdownPayload
{
  request: QQMarkdownRequest;
  autoStream?: boolean;
}

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord
{
  return typeof value === 'object' && value !== null;
}

function isStringArray(value: unknown): value is string[]
{
  return Array.isArray(value) && value.every(item => typeof item === 'string');
}

function appendParagraphBreak(content: string)
{
  return content && !content.endsWith('\n') ? `${content}\n` : content;
}

export function extractMarkdownText(children: readonly h[])
{
  let content = '';
  for (const child of children)
  {
    if (child.type === 'text')
    {
      if (typeof child.attrs.content !== 'string')
        continue;
      let text = child.attrs.content;
      while (text.startsWith('<markdown>'))
        text = text.slice(10);
      while (text.endsWith('</markdown>'))
        text = text.slice(0, -11);
      content += text;
    } else if (child.type === 'br')
    {
      content += '\n';
    } else if (child.type === 'p')
    {
      content = appendParagraphBreak(content);
      content += extractMarkdownText(child.children);
      content = appendParagraphBreak(content);
    } else
    {
      content += extractMarkdownText(child.children);
    }
  }
  return content;
}

function createRequest(message: QQMarkdownRequest): QQMarkdownRequest
{
  return message;
}

function createPayload(request: QQMarkdownRequest, autoStream?: boolean): QQMarkdownPayload
{
  return { request, autoStream };
}

function createMarkdownRequest(markdown: QQ.Message.Markdown, keyboard?: Partial<QQ.MessageKeyboard>, content?: string, stream?: QQ.Message.Stream): QQMarkdownRequest
{
  return createRequest({
    msg_type: QQ.Message.Type.MARKDOWN,
    ...(content !== undefined ? { content } : {}),
    markdown,
    ...(keyboard ? { keyboard } : {}),
    ...(stream ? { stream } : {}),
  });
}

function parseMarkdownParam(value: unknown): QQ.Message.MarkdownParam | undefined
{
  if (!isRecord(value) || typeof value.key !== 'string' || !isStringArray(value.values))
  {
    return;
  }
  return {
    key: value.key,
    values: value.values,
  };
}

function parseMarkdownParams(value: unknown)
{
  if (!Array.isArray(value))
  {
    return;
  }
  const result: QQ.Message.MarkdownParam[] = [];
  for (const item of value)
  {
    const parsed = parseMarkdownParam(item);
    if (!parsed) return;
    result.push(parsed);
  }
  return result;
}

function parseMarkdown(value: unknown)
{
  if (!isRecord(value))
  {
    return;
  }
  const result: QQ.Message.Markdown = {};
  if (typeof value.content === 'string')
  {
    result.content = value.content;
  }
  if (typeof value.custom_template_id === 'string')
  {
    result.custom_template_id = value.custom_template_id;
  }
  const params = parseMarkdownParams(value.params);
  if (value.params !== undefined && !params)
  {
    return;
  }
  if (params)
  {
    result.params = params;
  }
  if (!result.content && !result.custom_template_id)
  {
    return;
  }
  return result;
}

function parseButtonPermission(value: unknown)
{
  if (!isRecord(value) || typeof value.type !== 'number')
  {
    return;
  }
  const result: QQ.Button['action']['permission'] = {
    type: value.type,
  };
  if (isStringArray(value.specify_user_ids))
  {
    result.specify_user_ids = value.specify_user_ids;
  }
  if (isStringArray(value.specify_role_ids))
  {
    result.specify_role_ids = value.specify_role_ids;
  }
  return result;
}

function parseButtonRenderData(value: unknown)
{
  if (!isRecord(value) || typeof value.label !== 'string')
  {
    return;
  }
  const result: QQ.Button['render_data'] = {
    label: value.label,
  };
  if (typeof value.visited_label === 'string')
  {
    result.visited_label = value.visited_label;
  }
  if (typeof value.style === 'number')
  {
    result.style = value.style;
  }
  return result;
}

function parseButtonModal(value: unknown)
{
  if (!isRecord(value)) return;
  const result: QQ.ButtonModal = {};
  if (typeof value.content === 'string') result.content = value.content;
  if (typeof value.confirm_text === 'string') result.confirm_text = value.confirm_text;
  if (typeof value.cancel_text === 'string') result.cancel_text = value.cancel_text;
  return Object.keys(result).length ? result : undefined;
}

function parseButtonAction(value: unknown)
{
  if (!isRecord(value) || typeof value.type !== 'number' || typeof value.data !== 'string')
  {
    return;
  }
  const permission = parseButtonPermission(value.permission);
  if (!permission)
  {
    return;
  }
  const result: QQ.Button['action'] = {
    type: value.type,
    permission,
    data: value.data,
  };
  if (typeof value.reply === 'boolean')
  {
    result.reply = value.reply;
  }
  if (typeof value.enter === 'boolean')
  {
    result.enter = value.enter;
  }
  if (typeof value.anchor === 'number')
  {
    result.anchor = value.anchor;
  }
  const modal = parseButtonModal(value.modal);
  if (modal)
  {
    result.modal = modal;
  }
  if (typeof value.click_limit === 'number')
  {
    result.click_limit = value.click_limit;
  }
  if (typeof value.at_bot_show_channel_list === 'boolean')
  {
    result.at_bot_show_channel_list = value.at_bot_show_channel_list;
  }
  if (typeof value.unsupport_tips === 'string')
  {
    result.unsupport_tips = value.unsupport_tips;
  }
  return result;
}

function parseButton(value: unknown)
{
  if (!isRecord(value))
  {
    return;
  }
  const render_data = parseButtonRenderData(value.render_data);
  const action = parseButtonAction(value.action);
  if (!render_data || !action)
  {
    return;
  }
  const result: QQ.Button = {
    render_data,
    action,
  };
  if (typeof value.id === 'string')
  {
    result.id = value.id;
  }
  if (typeof value.group_id === 'string')
  {
    result.group_id = value.group_id;
  }
  return result;
}

function parseKeyboardRows(value: unknown)
{
  if (!Array.isArray(value))
  {
    return;
  }
  const rows: QQ.InlineKeyboardRow[] = [];
  for (const row of value)
  {
    if (!isRecord(row) || !Array.isArray(row.buttons))
    {
      return;
    }
    const buttons: QQ.Button[] = [];
    for (const button of row.buttons)
    {
      const parsed = parseButton(button);
      if (!parsed) return;
      buttons.push(parsed);
    }
    rows.push({ buttons });
  }
  return rows;
}

function parseKeyboardContent(value: unknown)
{
  if (!isRecord(value))
  {
    return;
  }
  const rows = parseKeyboardRows(value.rows);
  if (!rows)
  {
    return;
  }
  return { rows };
}

function parseKeyboard(value: unknown)
{
  if (!isRecord(value))
  {
    return;
  }
  const result: Partial<QQ.MessageKeyboard> = {};
  if (typeof value.id === 'string')
  {
    result.id = value.id;
  }
  const content = parseKeyboardContent(value.content);
  if (content)
  {
    result.content = content;
  }
  if (!result.id && !result.content)
  {
    return;
  }
  return result;
}

function parseStream(value: unknown)
{
  if (!isRecord(value) || typeof value.state !== 'number')
  {
    return;
  }
  const result: QQ.Message.Stream = {
    state: value.state,
  };
  if (typeof value.id === 'string')
  {
    result.id = value.id;
  }
  if (typeof value.index === 'number')
  {
    result.index = value.index;
  }
  if (typeof value.reset === 'boolean')
  {
    result.reset = value.reset;
  }
  return result;
}

function parseAutoStream(attrs: Dict)
{
  if (typeof attrs.stream === 'boolean')
  {
    return attrs.stream;
  }
}

function parseWrapper(value: unknown)
{
  if (!isRecord(value))
  {
    return;
  }
  if ('markdown' in value || 'keyboard' in value || 'id' in value || 'templateId' in value)
  {
    return value;
  }
}

function parseJsonMessage(attrs: Dict, children: readonly h[])
{
  const stream = parseStream(attrs.stream);
  const autoStream = stream ? undefined : parseAutoStream(attrs);
  const wrapper = parseWrapper(attrs.content) || parseWrapper(attrs.markdown);
  const keyboardSource = wrapper?.keyboard ?? attrs.keyboard;
  const templateId = typeof attrs.id === 'string'
    ? attrs.id
    : typeof attrs.templateId === 'string'
      ? attrs.templateId
      : typeof wrapper?.id === 'string'
        ? wrapper.id
        : typeof wrapper?.templateId === 'string'
          ? wrapper.templateId
          : typeof keyboardSource === 'string'
            ? keyboardSource
            : typeof attrs.content === 'string'
              ? attrs.content
              : extractMarkdownText(children).trim();
  const keyboard = parseKeyboard(keyboardSource) || (templateId ? { id: templateId } : undefined);
  if (!keyboard?.id)
  {
    return;
  }
  return createPayload(createRequest({
    msg_type: QQ.Message.Type.MARKDOWN,
    content: '',
    keyboard,
    ...(stream ? { stream } : {}),
  }), autoStream);
}

function getMarkdownContent(attrs: Dict, children: readonly h[])
{
  const content = typeof attrs.content === 'string'
    ? attrs.content
    : extractMarkdownText(children) || ' ';
  return { content };
}

function parseTemplateMarkdown(attrs: Dict, children: readonly h[])
{
  const stream = parseStream(attrs.stream);
  const autoStream = stream ? undefined : parseAutoStream(attrs);
  const wrapper = parseWrapper(attrs.content) || parseWrapper(attrs.markdown);
  const keyboard = parseKeyboard(attrs.keyboard ?? wrapper?.keyboard);
  const directMarkdown = parseMarkdown(attrs);
  if (directMarkdown?.custom_template_id)
  {
    return createPayload(createMarkdownRequest(directMarkdown, keyboard, undefined, stream), autoStream);
  }
  const { content } = getMarkdownContent(attrs, children);
  const markdownSource = wrapper?.markdown ?? attrs.markdown;
  if (!markdownSource)
  {
    return createPayload(createMarkdownRequest({
      content,
    }, undefined, undefined, stream), autoStream);
  }
  const markdown = parseMarkdown(markdownSource);
  if (!markdown?.custom_template_id)
  {
    return;
  }
  return createPayload(createMarkdownRequest(markdown, keyboard, undefined, stream), autoStream);
}

function parseRawMarkdown(attrs: Dict, children: readonly h[])
{
  const stream = parseStream(attrs.stream);
  const autoStream = stream ? undefined : parseAutoStream(attrs);
  const wrapper = parseWrapper(attrs.content) || parseWrapper(attrs.markdown);
  const keyboard = parseKeyboard(attrs.keyboard ?? wrapper?.keyboard);
  const directMarkdown = parseMarkdown(attrs);
  if (directMarkdown?.content)
  {
    return createPayload(createMarkdownRequest(directMarkdown, keyboard, undefined, stream), autoStream);
  }
  const { content } = getMarkdownContent(attrs, children);
  const markdownSource = wrapper?.markdown ?? attrs.markdown;
  if (!markdownSource)
  {
    return createPayload(createMarkdownRequest({
      content,
    }, keyboard, undefined, stream), autoStream);
  }
  const markdown = parseMarkdown(markdownSource);
  if (!markdown?.content)
  {
    return;
  }
  return createPayload(createMarkdownRequest(markdown, keyboard, undefined, stream), autoStream);
}

function parseRawMarkdownWithoutKeyboard(attrs: Dict, children: readonly h[])
{
  const stream = parseStream(attrs.stream);
  const autoStream = stream ? undefined : parseAutoStream(attrs);
  const { content } = getMarkdownContent(attrs, children);
  return createPayload(createMarkdownRequest({
    content,
  }, undefined, undefined, stream), autoStream);
}

function parseButtonElement(attrs: Dict, children: readonly h[])
{
  const text = typeof attrs.text === 'string' ? attrs.text : extractMarkdownText(children);
  const render_data: QQ.Button['render_data'] = {
    label: text,
  };
  if (typeof attrs.visited_label === 'string')
  {
    render_data.visited_label = attrs.visited_label;
  }
  if (typeof attrs.style === 'number')
  {
    render_data.style = attrs.style;
  }
  let permission: QQ.Button['action']['permission'] | undefined;
  if (isRecord(attrs.permission) && typeof attrs.permission.type === 'number')
  {
    permission = {
      type: attrs.permission.type,
    };
    if (isStringArray(attrs.permission.specify_user_ids))
    {
      permission.specify_user_ids = attrs.permission.specify_user_ids;
    }
    if (isStringArray(attrs.permission.specify_role_ids))
    {
      permission.specify_role_ids = attrs.permission.specify_role_ids;
    }
  }
  const actionSource = isRecord(attrs.action) ? attrs.action : undefined;
  const modal = parseButtonModal(actionSource?.modal);
  const action = actionSource && typeof actionSource.type === 'number' && typeof actionSource.data === 'string'
    ? {
      type: actionSource.type,
      permission: permission ?? { type: 2 },
      data: actionSource.data,
      ...(typeof actionSource.reply === 'boolean' ? { reply: actionSource.reply } : {}),
      ...(typeof actionSource.enter === 'boolean' ? { enter: actionSource.enter } : {}),
      ...(typeof actionSource.anchor === 'number' ? { anchor: actionSource.anchor } : {}),
      ...(modal ? { modal } : {}),
      ...(typeof actionSource.click_limit === 'number' ? { click_limit: actionSource.click_limit } : {}),
      ...(typeof actionSource.at_bot_show_channel_list === 'boolean' ? { at_bot_show_channel_list: actionSource.at_bot_show_channel_list } : {}),
      ...(typeof actionSource.unsupport_tips === 'string' ? { unsupport_tips: actionSource.unsupport_tips } : {}),
    }
    : (() =>
    {
      const type = typeof attrs.type === 'string' ? attrs.type : 'action';
      const href = typeof attrs.href === 'string' ? attrs.href : undefined;
      const defaultData = type === 'link' ? (href || '') : type === 'input' ? text : typeof attrs.id === 'string' ? attrs.id : text;
      if (!defaultData)
      {
        return;
      }
      return {
        type: type === 'link' ? 0 : type === 'input' ? 2 : 1,
        permission: { type: 2 },
        data: defaultData,
        ...(type === 'input' ? { enter: true } : {}),
        ...(type === 'link' && href ? { data: href } : {}),
      };
    })();
  if (!action)
  {
    return;
  }
  return {
    ...(typeof attrs.id === 'string' ? { id: attrs.id } : {}),
    ...(typeof attrs.group_id === 'string' ? { group_id: attrs.group_id } : {}),
    render_data,
    action,
  } satisfies QQ.Button;
}

export function parseQQMarkdownElement(element: h)
{
  const { type, attrs, children } = element;
  if (type === 'qq:rawmarkdown-without-keyboard')
  {
    return parseRawMarkdownWithoutKeyboard(attrs, children);
  }
  if (type === 'qq:json')
  {
    return parseJsonMessage(attrs, children);
  }
  if (type === 'qq:markdown')
  {
    return parseTemplateMarkdown(attrs, children);
  }
  if (type === 'qq:rawmarkdown')
  {
    return parseRawMarkdown(attrs, children);
  }
}
