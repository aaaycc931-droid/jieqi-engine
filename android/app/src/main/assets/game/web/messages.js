

export function trapTriggerAnnouncement(owner      , isTrapAmbush         )         {
  if (!isTrapAmbush) return "猎物已踏入陷阱！该棋子已被击杀。";
  return `猎物已踏入陷阱！伏击触发，${owner === "red" ? "红方" : "蓝方"}获得胜利。`;
}
