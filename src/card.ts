import { h } from 'koishi';
import * as QQ from './types';

export type QQCardRequest = Omit<QQ.Message.Request, 'msg_id' | 'msg_seq' | 'event_id'>;

export interface QQCardPayload
{
  request: QQCardRequest;
}

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord
{
  return typeof value === 'object' && value !== null;
}

function parseCardContent(value: unknown): QQ.Message.MessageCardContent | undefined
{
  if (!isRecord(value)) {
    return;
  }
  const { title, description, url, pic_url } = value;
  if (
    typeof title !== 'string'
    || typeof description !== 'string'
    || typeof url !== 'string'
    || typeof pic_url !== 'string'
  ) {
    return;
  }
  return {
    title,
    description,
    url,
    pic_url,
  };
}

function parseCard(value: unknown): QQ.Message.MessageCard | undefined
{
  if (!isRecord(value) || value.type !== 'tuwen') {
    return;
  }
  const content = parseCardContent(value.content);
  if (!content) {
    return;
  }
  return {
    type: 'tuwen',
    content,
  };
}

function createPayload(card: QQ.Message.MessageCard): QQCardPayload
{
  return {
    request: {
      msg_type: QQ.Message.Type.CARD,
      card,
    },
  };
}

export function parseQQCardElement(element: h)
{
  const { type, attrs } = element;
  if (type !== 'qq:card') {
    return;
  }
  const source = isRecord(attrs.card)
    ? attrs.card
    : attrs.type === 'tuwen'
      ? attrs
      : undefined;
  const card = parseCard(source);
  if (!card) {
    return;
  }
  return createPayload(card);
}