import { RuleError } from "./errors.js";

/** Wire format shared by the Android RFCOMM layer and the WebView game host. */
export const BLUETOOTH_PROTOCOL_VERSION = 1;
export const BLUETOOTH_MAX_MESSAGE_BYTES = 48 * 1024;

                                                                                               

                                                 
                                       
                             
                                                                                 
              
              
 

const MESSAGE_TYPES = new Set                      (["hello", "action", "snapshot", "error", "ping", "pong"]);

function byteLength(value        )         {
  return new TextEncoder().encode(value).byteLength;
}

function requireObject(value         )                          {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new RuleError("INVALID_BLUETOOTH_MESSAGE", "蓝牙消息必须是对象");
  }
  return value                           ;
}

/**
 * Verifies the small protocol boundary before a message reaches game rules.
 * It deliberately has no game-secret knowledge; the host rule engine still
 * validates player side, revision and every move command afterwards.
 */
export function parseBluetoothEnvelope(raw        )                    {
  if (byteLength(raw) > BLUETOOTH_MAX_MESSAGE_BYTES) {
    throw new RuleError("BLUETOOTH_MESSAGE_TOO_LARGE", "蓝牙消息超过大小上限");
  }
  let value         ;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new RuleError("INVALID_BLUETOOTH_MESSAGE", "蓝牙消息不是有效 JSON");
  }
  const message = requireObject(value);
  if (message.v !== BLUETOOTH_PROTOCOL_VERSION) {
    throw new RuleError("BLUETOOTH_PROTOCOL_MISMATCH", "蓝牙协议版本不匹配");
  }
  if (typeof message.type !== "string" || !MESSAGE_TYPES.has(message.type                        )) {
    throw new RuleError("INVALID_BLUETOOTH_MESSAGE", "未知蓝牙消息类型");
  }
  if (message.id !== undefined && (typeof message.id !== "string" || !message.id.trim())) {
    throw new RuleError("INVALID_BLUETOOTH_MESSAGE", "消息 id 必须是非空文本");
  }
  return message                     ;
}

export function encodeBluetoothEnvelope   (message                      )         {
  // Round-trip through the parser so outbound and inbound constraints never drift.
  const raw = JSON.stringify(message);
  parseBluetoothEnvelope(raw);
  return raw;
}

/** Host-only snapshot wrapper: callers must pass an already-sanitized public view. */
export function createBluetoothSnapshot   (id        , publicView   )                       {
  if (!id.trim()) throw new RuleError("INVALID_BLUETOOTH_MESSAGE", "快照 id 不能为空");
  return { v: BLUETOOTH_PROTOCOL_VERSION, type: "snapshot", id, payload: publicView };
}
