import * as QQ from './types';
import { Context, Dict, h, MessageEncoder } from 'koishi';
import { QQBot } from './bot';
import { QQGuildBot } from './bot/guild';
import { logDebug } from './logger';
import { extractMarkdownText, parseQQMarkdownElement, QQMarkdownRequest } from './markdown';
import { applyAutoStream, clearAutoStream, updateAutoStream } from './stream';
import { fromPrivateChannelId, isPrivateChannelId } from './channel';
import { registerMessageReference, resolveMessageReference } from './reference';
import { parseQQArkElement } from './ark';
import { chunkedUpload } from './chunked-upload';

export const escapeMarkdown = (val: string) =>
  val
    .replace(/([\\`*_[\*_~`\]\-(#!>])/g, '\\$&');

function getErrorCode(error: { response?: { data?: unknown; }; })
{
  const data = error.response?.data;
  if (!data || typeof data !== 'object') return;
  if ('err_code' in data && typeof data.err_code === 'number') return data.err_code;
  if ('code' in data && typeof data.code === 'number') return data.code;
}

function getErrorMessage(error: { message?: string; response?: { data?: unknown; }; })
{
  const data = error.response?.data;
  if (data && typeof data === 'object' && 'message' in data && typeof data.message === 'string')
  {
    return data.message;
  }
  return error.message;
}

// 统一生成更容易定位问题的发送异常信息。
function createSendError(error: { message?: string; response?: { data?: unknown; }; })
{
  const code = getErrorCode(error);
  const message = getErrorMessage(error) || 'unknown error';
  return new Error(code ? `QQ 消息发送失败 [${code}] ${message}` : `QQ 消息发送失败 ${message}`);
}

const markdownDataImagePattern = /!\[[^\]\n]*\]\((data:image\/[\w.+-]+;base64,[^)\s]+)\)/g;

type MarkdownDataImagePart =
  | { type: 'text'; content: string; }
  | { type: 'image'; src: string; };

function splitMarkdownDataImages(content: string)
{
  markdownDataImagePattern.lastIndex = 0;
  const parts: MarkdownDataImagePart[] = [];
  let lastIndex = 0;
  let matched = false;
  let capture: RegExpExecArray;
  while (capture = markdownDataImagePattern.exec(content))
  {
    matched = true;
    if (capture.index > lastIndex)
    {
      parts.push({ type: 'text', content: content.slice(lastIndex, capture.index) });
    }
    parts.push({ type: 'image', src: capture[1] });
    lastIndex = markdownDataImagePattern.lastIndex;
  }
  if (!matched) return;
  if (lastIndex < content.length)
  {
    parts.push({ type: 'text', content: content.slice(lastIndex) });
  }
  return parts;
}

export class QQGuildMessageEncoder<C extends Context = Context> extends MessageEncoder<C, QQGuildBot<C>>
{
  private content: string = '';
  private file: Blob;
  private filename: string;
  fileUrl: string;
  private passiveId: string;
  private passiveEventId: string;
  reference: string;
  private retry = false;
  // 先文后图
  async flush()
  {
    if (!this.content.trim().length && !this.file && !this.fileUrl)
    {
      return;
    }
    const isDirect = this.channelId.includes('_');

    let endpoint = `/channels/${this.channelId}/messages`;
    if (isDirect) endpoint = `/dms/${this.channelId.split('_')[0]}/messages`;
    const useFormData = Boolean(this.file);
    let msg_id = this.options?.session?.messageId;
    if (this.options?.session && (Date.now() - this.options?.session?.timestamp) > MSG_TIMEOUT)
    {
      msg_id = null;
    }
    if (this.passiveId) msg_id = this.passiveId;

    let r: Partial<QQ.Message.Response>;
    logDebug(this.bot, 'use form data %s', useFormData);
    try
    {
      if (useFormData)
      {
        const form = new FormData();
        form.append('content', this.content);
        if (this.options?.session && msg_id)
        {
          form.append('msg_id', msg_id);
        }
        if (this.passiveEventId)
        {
          form.append('event_id', this.passiveEventId);
        }
        if (this.file)
        {
          form.append('file_image', this.file, this.filename);
        }
        // if (this.fileUrl) {
        //   form.append('image', this.fileUrl)
        // }
        r = await this.bot.http.post<QQ.Message>(endpoint, form);
      } else
      {
        const payload: QQ.Message.ChannelRequest = {
          ...{
            content: this.content,
            msg_id,
            image: this.fileUrl,
          },
          ...(this.reference ? {
            message_reference: {
              message_id: resolveMessageReference(this.reference),
            },
          } : {}),
          ...(this.passiveEventId ? {
            event_id: this.passiveEventId,
          } : {}),
        };
        if (isDirect) r = await this.bot.internal.sendDM(this.channelId.split('_')[0], payload);
        else r = await this.bot.internal.sendMessage(this.channelId, payload);
      }
    } catch (e)
    {
      if (this.bot.http.isError(e))
      {
        const code = getErrorCode(e);
        if (code !== undefined && this.bot.parent.config.retryWhen.includes(code) && !this.retry && this.fileUrl)
        {
          this.bot.logger.warn('retry image sending');
          this.retry = true;
          await this.resolveFile(null, true);
          return this.flush();
        }
        if (useFormData)
        {
          this.bot.logger.warn(`POST ${endpoint} response: %o, trace id: %s`, e.response.data, e.response.headers.get('x-tps-trace-id'));
        }
        this.errors.push(createSendError(e));
      } else
      {
        throw e;
      }
    }

    const session = this.bot.session();
    session.type = 'send';
    // await decodeMessage(this.bot, r, session.event.message = {}, session.event)
    session.guildId = this.session.guildId;
    session.channelId = this.channelId;
    session.isDirect = isDirect;

    // https://bot.q.qq.com/wiki/develop/api/gateway/direct_message.html#%E6%B3%A8%E6%84%8F
    /**
     * active msg, http 202: {"code":304023,"message":"push message is waiting for audit now","data":{"message_audit":{"audit_id":"xxx"}}}
     * passive msg, http 200: Partial<QQ.Message>
     */
    if (r?.id)
    {
      registerMessageReference(r.id, r.ext_info?.ref_idx);
      session.messageId = r.id;
      session.app.emit(session, 'send', session);
      this.results.push(session.event.message);
    } else if (r?.code === 304023 && this.bot.config.parent.intents & QQ.Intents.MESSAGE_AUDIT)
    {
      try
      {
        const auditData: QQ.MessageAudited = await this.audit(r.data.message_audit.audit_id);
        session.messageId = auditData.message_id;
        session.app.emit(session, 'send', session);
        this.results.push(session.event.message);
      } catch (e)
      {
        this.bot.logger.error(e);
      }
    }
    this.content = '';
    this.file = null;
    this.filename = null;
    this.fileUrl = null;
    this.reference = null;
    this.retry = false;
  }

  async audit(audit_id: string): Promise<QQ.MessageAudited>
  {
    return new Promise((resolve, reject) =>
    {
      const dispose = this.bot.ctx.on('qq/message-audit-pass', (data) =>
      {
        if (data.audit_id === audit_id)
        {
          dispose();
          dispose2();
          resolve(data);
        }
      });
      const dispose2 = this.bot.ctx.on('qq/message-audit-reject', (data) =>
      {
        if (data.audit_id === audit_id)
        {
          dispose();
          dispose2();
          reject(data);
        }
      });
    });
  }

  async resolveFile(attrs: Dict, download = false)
  {
    if (!download && !await this.bot.ctx.http.isLocal(attrs.src || attrs.url))
    {
      return this.fileUrl = attrs.src || attrs.url;
    }
    const { data, filename, type } = await this.bot.ctx.http.file(this.fileUrl || attrs.src || attrs.url, attrs);
    this.file = new Blob([data], { type });
    this.filename = filename;
    this.fileUrl = null;
  }

  async visit(element: h)
  {
    const { type, attrs, children } = element;
    if (type === 'text')
    {
      this.content += attrs.content;
    } else if (type === 'at')
    {
      switch (attrs.type)
      {
        case 'all':
          this.content += `@everyone`;
          break;
        default:
          this.content += `<@${attrs.id}>`;
      }
    } else if (type === 'br')
    {
      this.content += '\n';
    } else if (type === 'p')
    {
      if (!this.content.endsWith('\n')) this.content += '\n';
      await this.render(children);
      if (!this.content.endsWith('\n')) this.content += '\n';
    } else if (type === 'sharp')
    {
      this.content += `<#${attrs.id}>`;
    } else if (type === 'quote')
    {
      this.reference = attrs.id;
      await this.flush();
    } else if (type === 'passive')
    {
      if (attrs.messageId) this.passiveId = attrs.messageId;
      if (attrs.eventId) this.passiveEventId = attrs.eventId;
    } else if ((type === 'img' || type === 'image') && (attrs.src || attrs.url))
    {
      await this.flush();
      await this.resolveFile(attrs);
      await this.flush();
    } else if (type === 'message')
    {
      await this.flush();
      await this.render(children);
      await this.flush();
    } else
    {
      await this.render(children);
    }
  }
}

const MSG_TIMEOUT = 5 * 60 * 1000 - 2000;// 5 mins

export class QQMessageEncoder<C extends Context = Context> extends MessageEncoder<C, QQBot<C>>
{
  private content: string = '';
  private passiveId: string;
  private passiveSeq: number;
  private passiveEventId: string;
  private useMarkdown = false;
  private plainTextOnly = true;
  private rows: QQ.Button[][] = [];
  private attachedFile: QQ.Message.File.Response;
  private customRequest: QQMarkdownRequest;
  private customAutoStream = false;
  private retry = false;
  private reference: string;

  // 先图后文
  async flush()
  {
    if (!this.content.trim() && !this.rows.flat().length && !this.attachedFile && !this.customRequest) return;
    this.trimButtons();
    let msg_id: string, msg_seq: number, event_id: string;
    if (this.options?.session?.messageId && Date.now() - this.options.session.timestamp < MSG_TIMEOUT)
    {
      this.options.session['seq'] ||= 0;
      msg_id = this.options.session.messageId;
      msg_seq = ++this.options.session['seq'];
    } else if (this.options?.session?.qq?.['id'] && Date.now() - this.options.session.timestamp < MSG_TIMEOUT)
    {
      event_id = this.options.session.qq['id'];
    }
    if (this.passiveId) msg_id = this.passiveId;
    if (this.passiveSeq) msg_seq = this.passiveSeq;
    if (this.passiveEventId) event_id = this.passiveEventId;
    const data: QQ.Message.Request = this.customRequest ? {
      ...this.customRequest,
      msg_id,
      msg_seq,
      event_id,
    } : {
      content: this.content,
      msg_type: QQ.Message.Type.TEXT,
      msg_id,
      msg_seq,
      event_id,
    };
    if (this.reference && !data.message_reference)
    {
      data.message_reference = {
        message_id: resolveMessageReference(this.reference),
      };
    }
    const autoStreamText = Boolean(
      this.bot.config.autoStreamText
      && !this.customRequest
      && !this.useMarkdown
      && !this.attachedFile
      && !this.rows.flat().length
      && this.plainTextOnly
      && this.content.trim().length
    );
    if (!this.customRequest && this.attachedFile)
    {
      if (!data.content.length) delete data.content;
      data.media = this.attachedFile;
      data.msg_type = QQ.Message.Type.MEDIA;
      // QQ group/C2C rich media messages cannot be sent with event_id.
      delete data.event_id;
    }

    if (!this.customRequest && this.useMarkdown && !this.attachedFile)
    {
      data.msg_type = QQ.Message.Type.MARKDOWN;
      delete data.content;
      data.markdown = {
        content: this.content || ' ',
      };
      if (this.rows.length)
      {
        data.keyboard = {
          content: {
            rows: this.exportButtons(),
          },
        };
      }
    }
    if (autoStreamText)
    {
      data.msg_type = QQ.Message.Type.MARKDOWN;
      delete data.content;
      data.markdown = {
        content: escapeMarkdown(this.content) || ' ',
      };
      delete data.keyboard;
    }
    const shouldAutoStream = this.customAutoStream || autoStreamText;
    if (!shouldAutoStream && !data.stream)
    {
      clearAutoStream(this.options.session);
    }
    applyAutoStream(this.options.session, data, shouldAutoStream);
    const session = this.bot.session();
    session.type = 'send';
    // 主动发送时可能没有 isDirect，需要同时根据 private: 频道 ID 判断。
    const isDirect = this.session.isDirect || isPrivateChannelId(this.session.channelId);
    const sendRequest = (payload: QQ.Message.Request) =>
    {
      return isDirect
        ? this.bot.internal.sendPrivateMessage(fromPrivateChannelId(this.session.channelId), payload)
        : this.bot.internal.sendMessage(this.session.channelId, payload);
    };
    const send = async () =>
    {
      try
      {
        const resp = await sendRequest(data);
        if (resp.id && !resp.audit_id)
        {
          registerMessageReference(resp.id, resp.ext_info?.ref_idx);
          updateAutoStream(this.options.session, data, resp.id);
          session.messageId = resp.id;
          session.timestamp = new Date(resp.timestamp).valueOf();
          session.channelId = this.session.channelId;
          session.guildId = this.session.guildId;
          session.app.emit(session, 'send', session);
          this.results.push(session.event.message);
        } else if (resp.audit_id && this.bot.config.intents & QQ.Intents.MESSAGE_AUDIT)
        {
          try
          {
            const auditData: QQ.MessageAudited = await this.audit(resp.audit_id);
            session.messageId = auditData.message_id;
            session.app.emit(session, 'send', session);
            this.results.push(session.event.message);
          } catch (e)
          {
            this.bot.logger.error(e);
          }
        }
      } catch (e)
      {
        if (!this.bot.http.isError(e)) throw e;
        const code = getErrorCode(e);
        if (!this.retry && code === 40054005 && typeof data.msg_seq === 'number')
        {
          data.msg_seq += 1;
          this.bot.logger.warn('%s msg_seq duplicated, retry with msg_seq=%d', this.session.cid, data.msg_seq);
          this.retry = true;
          return send();
        }
        if (!this.retry && code !== undefined && this.bot.config.retryWhen.includes(code))
        {
          this.bot.logger.warn('%s retry message sending, code=%d', this.session.cid, code);
          this.retry = true;
          return send();
        }
        this.errors.push(createSendError(e));
      }
    };
    await send();
    this.content = '';
    this.attachedFile = null;
    this.rows = [];
    this.customRequest = null;
    this.customAutoStream = false;
    this.useMarkdown = false;
    this.plainTextOnly = true;
    this.reference = null;
    this.retry = false;
  }

  async audit(audit_id: string): Promise<QQ.MessageAudited>
  {
    return new Promise((resolve, reject) =>
    {
      const dispose = this.bot.ctx.on('qq/message-audit-pass', (data) =>
      {
        if (data.audit_id === audit_id)
        {
          dispose();
          dispose2();
          resolve(data);
        }
      });
      const dispose2 = this.bot.ctx.on('qq/message-audit-reject', (data) =>
      {
        if (data.audit_id === audit_id)
        {
          dispose();
          dispose2();
          reject(data);
        }
      });
    });
  }

  async sendFile(type: string, attrs: Dict)
  {
    const url = attrs.src || attrs.url;
    let file_type = 0;
    if (type === 'img' || type === 'image') file_type = QQ.Message.File.Type.IMAGE;
    else if (type === 'video') file_type = QQ.Message.File.Type.VIDEO;
    else if (type === 'audio') file_type = QQ.Message.File.Type.AUDIO;
    else if (type === 'file') file_type = QQ.Message.File.Type.FILE;
    else return;

    const isDirect = this.session.isDirect || isPrivateChannelId(this.session.channelId);
    const targetId = isDirect
      ? fromPrivateChannelId(this.session.channelId) || this.options.session.userId
      : this.session.channelId;
    let res: QQ.Message.File.Response;

    try
    {
      const capture = /^data:([\w/.+-]+);base64,(.*)$/.exec(url);
      let fileBuffer: Buffer | null = null;

      if (capture?.[2])
      {
        fileBuffer = Buffer.from(capture[2], 'base64');
      } else if (await this.bot.ctx.http.isLocal(url))
      {
        fileBuffer = Buffer.from((await this.bot.ctx.http.file(url)).data);
      }

      if (fileBuffer)
      {
        let fileName = attrs.filename || attrs.title || attrs.name || 'file';
        if (fileName === 'file')
        {
          try
          {
            const urlPath = new URL(url).pathname;
            const baseName = decodeURIComponent(urlPath.split('/').pop() || '');
            if (baseName && baseName !== '/') fileName = baseName;
          } catch { }
        }
        if (fileName === 'file') fileName = `file_${Date.now()}`;

        res = await chunkedUpload(this.bot, targetId, isDirect, fileBuffer, fileName, file_type);
      } else
      {
        const data: QQ.Message.File.Request = { file_type, srv_send_msg: false, url };
        if (isDirect)
        {
          res = await this.bot.internal.sendFilePrivate(targetId, data);
        } else
        {
          res = await this.bot.internal.sendFileGuild(targetId, data);
        }
      }
    } catch (e)
    {
      if (!this.bot.http.isError(e)) throw e;
      const code = getErrorCode(e);
      if (!this.retry && code !== undefined && this.bot.config.retryWhen.includes(code))
      {
        this.bot.logger.warn('%s retry file sending, code=%d', this.session.cid, code);
        this.retry = true;
        return this.sendFile(type, attrs);
      }
      this.errors.push(createSendError(e));
    }
    this.retry = false;
    return res;
  }

  private appendMarkdown(content: string)
  {
    if (!content) return;
    this.plainTextOnly = false;
    if (!this.useMarkdown)
    {
      this.content = escapeMarkdown(this.content);
      this.useMarkdown = true;
    }
    this.content += content;
  }

  private async renderMarkdownDataImages(content: string)
  {
    const parts = splitMarkdownDataImages(content);
    if (!parts) return false;
    for (const part of parts)
    {
      if (part.type === 'text')
      {
        if (this.attachedFile) await this.flush();
        this.appendMarkdown(part.content);
      } else
      {
        await this.flush();
        const data = await this.sendFile('image', { src: part.src });
        if (data) this.attachedFile = data;
      }
    }
    return true;
  }

  decodeButton(attrs: Dict, label: string)
  {
    const attrAction = (attrs.action && typeof attrs.action === 'object') ? attrs.action : {};
    const attrRenderData = (attrs.render_data && typeof attrs.render_data === 'object') ? attrs.render_data : {};
    const attrPermission = (attrs.permission && typeof attrs.permission === 'object')
      ? attrs.permission
      : (attrAction.permission && typeof attrAction.permission === 'object' ? attrAction.permission : undefined);

    const type = attrs.type ?? attrAction.type;
    const text = typeof attrs.text === 'string' ? attrs.text : undefined;

    let actionData = attrs.data ?? attrAction.data;
    if (actionData === undefined || actionData === null || actionData === '')
    {
      if (type === 'link' || type === 0)
      {
        actionData = attrs.href ?? attrAction.data ?? '';
      } else
      {
        actionData = text || label || (typeof attrs.id === 'string' ? attrs.id : '');
      }
    }

    const displayLabel = attrRenderData.label || label || text || actionData;

    const result: QQ.Button = {
      ...(typeof attrs.id === 'string' ? { id: attrs.id } : {}),
      render_data: {
        label: String(displayLabel || ''),
        visited_label: String(displayLabel || ''),
        style: attrRenderData.style ?? (typeof attrs.style === 'number' ? attrs.style : 1),
      },
      action: {
        type: typeof type === 'number' ? type : (type === 'link' ? 0 : 2),
        permission: attrPermission || { type: 2 },
        data: String(actionData || ''),
        ...(type !== 'link' && type !== 0 ? { enter: true } : {}),
      },
    };

    Object.assign(result.action, attrAction);
    Object.assign(result.render_data, attrRenderData);

    if (!result.render_data.label) result.render_data.label = String(result.action.data || '');
    if (!result.render_data.visited_label) result.render_data.visited_label = result.render_data.label;
    if (result.render_data.style === undefined) result.render_data.style = 1;

    return result;
  }

  lastRow()
  {
    if (!this.rows.length) this.rows.push([]);
    let last = this.rows[this.rows.length - 1];
    if (last.length >= 5)
    {
      this.rows.push([]);
      last = this.rows[this.rows.length - 1];
    }
    return last;
  }

  trimButtons()
  {
    while (this.rows.length && this.rows[this.rows.length - 1].length === 0) this.rows.pop();
  }

  exportButtons()
  {
    return this.rows.map(v => ({
      buttons: v,
    }));
  }

  async visit(element: h)
  {
    const { type, attrs, children } = element;

    if (type === 'markdown')
    {
      const content = extractMarkdownText(children);
      if (await this.renderMarkdownDataImages(content)) return;
      this.appendMarkdown(content);
      return;
    }

    if (type === 'button' || type === 'qq:button')
    {
      this.plainTextOnly = false;
      if (!this.useMarkdown)
      {
        this.content = escapeMarkdown(this.content);
        this.useMarkdown = true;
      }
      const last = this.lastRow();
      last.push(this.decodeButton(attrs, extractMarkdownText(children)));
      return;
    }

    const arkPayload = parseQQArkElement(element);
    const customPayload = parseQQMarkdownElement(element);
    if (arkPayload)
    {
      await this.flush();
      this.customRequest = arkPayload.request;
      clearAutoStream(this.options.session);
      await this.flush();
    } else if (customPayload)
    {
      const content = customPayload.request.markdown?.content;
      if (
        customPayload.request.msg_type === QQ.Message.Type.MARKDOWN
        && content
        && !customPayload.request.keyboard
        && !customPayload.request.stream
        && await this.renderMarkdownDataImages(content)
      )
      {
        return;
      }
      await this.flush();
      this.customRequest = customPayload.request;
      this.customAutoStream = customPayload.autoStream;
      if (!customPayload.autoStream && !customPayload.request.stream)
      {
        clearAutoStream(this.options.session);
      }
      await this.flush();
    } else if (type === 'text')
    {
      this.content += this.useMarkdown ? escapeMarkdown(attrs.content) : attrs.content;
    } else if (type === 'at')
    {
      if (!this.useMarkdown)
        if (this.bot.config.useMarkdownIfAt)
          this.useMarkdown = true;
        else return;
      switch (attrs.type)
      {
        case 'all':
          this.content += `@everyone`;
          break;
        default:
          this.content += `<@${attrs.id}>`;
      }
    } else if (type === 'quote')
    {
      // 先记录引用目标，真正发送时再统一转换成平台接受的引用 ID。
      this.reference = attrs.id;
      await this.flush();
    } else if (type === 'passive')
    {
      if (attrs.messageId) this.passiveId = attrs.messageId;
      if (attrs.seq) this.passiveSeq = Number(attrs.seq);
      if (attrs.eventId) this.passiveEventId = attrs.eventId;
    } else if ((type === 'img' || type === 'image' || type === 'file') && (attrs.src || attrs.url))
    {
      this.plainTextOnly = false;
      await this.flush();
      const data = await this.sendFile(type, attrs);
      if (data) this.attachedFile = data;
    } else if (type === 'video' && (attrs.src || attrs.url))
    {
      this.plainTextOnly = false;
      await this.flush();
      const data = await this.sendFile(type, attrs);
      if (data) this.attachedFile = data;
      await this.flush(); // text can't send with video
    } else if (type === 'audio' && (attrs.src || attrs.url))
    {
      this.plainTextOnly = false;
      await this.flush();
      const { data } = await this.bot.ctx.http.file(attrs.src || attrs.url, attrs);
      if (new TextDecoder().decode(data.slice(0, 7)).includes('#!SILK'))
      {
        const onlineFile = await this.sendFile(type, {
          src: `data:audio/amr;base64,` + Buffer.from(data).toString('base64'),
        });
        this.attachedFile = onlineFile;
      } else
      {
        const ntsilk = this.bot.ctx.get('ntsilk');
        if (ntsilk)
        {
          const result = await ntsilk.encode(data);
          const onlineFile = await this.sendFile(type, {
            src: `data:audio/amr;base64,` + result.output.toString('base64'),
          });
          if (onlineFile) this.attachedFile = onlineFile;
        } else
        {
          const silk = this.bot.ctx.get('silk');
          if (!silk) return this.bot.logger.warn('missing ntsilk/silk service, cannot send non-silk audio');
          const allowSampleRate = [8000, 12000, 16000, 24000, 32000, 44100, 48000];
          if (silk.isWav(data) && allowSampleRate.includes(silk.getWavFileInfo(data).fmt.sampleRate))
          {
            const result = await silk.encode(data, 0);
            const onlineFile = await this.sendFile(type, {
              src: `data:audio/amr;base64,` + Buffer.from(result.data).toString('base64'),
            });
            if (onlineFile) this.attachedFile = onlineFile;
          } else
          {
            if (!this.bot.ctx.get('ffmpeg')) return this.bot.logger.warn('missing ffmpeg service, cannot send non-silk audio except some wav');
            const pcmBuf = await this.bot.ctx.get('ffmpeg')
              .builder()
              .input(Buffer.from(data))
              .outputOption('-ar', '24000', '-ac', '1', '-f', 's16le')
              .run('buffer');
            const result = await silk.encode(pcmBuf, 24000);
            const onlineFile = await this.sendFile(type, {
              src: `data:audio/amr;base64,` + Buffer.from(result.data).toString('base64'),
            });
            if (onlineFile) this.attachedFile = onlineFile;
          }
        }
      }
      await this.flush();
    } else if (type === 'br')
    {
      this.content += '\n';
    } else if (type === 'p')
    {
      if (!this.content.endsWith('\n')) this.content += '\n';
      await this.render(children);
      if (!this.content.endsWith('\n')) this.content += '\n';
    } else if (type === 'button-group')
    {
      this.plainTextOnly = false;
      if (!this.useMarkdown)
      {
        this.content = escapeMarkdown(this.content);
        this.useMarkdown = true;
      }
      this.rows.push([]);
      await this.render(children);
    } else if (type === 'a')
    {
      this.content += attrs.href || extractMarkdownText(children);
    } else if (type === 'i' || type === 'em' || type === 'b' || type === 'strong')
    {
      await this.render(children);
    } else if (type === 'message')
    {
      await this.flush();
      await this.render(children);
      await this.flush();
    } else
    {
      this.plainTextOnly = false;
      await this.render(children);
    }
  }
}
