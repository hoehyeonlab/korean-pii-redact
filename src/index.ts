// 한국 개인정보 비식별화 — 외부 AI·로그·서드파티로 나가는 텍스트에서 직접 식별자를 지운다.
//
// 두 겹으로 막는다.
//  1) 문자열 마스킹 — 자유 입력(메모·채팅·OCR)에 섞여 들어온 직접 식별자를 지운다(`redactPii`).
//  2) 구조적 제외 검사 — 애초에 내보내면 안 되는 필드 값이 텍스트에 새어 들어갔는지 확인한다
//     (`findLeaks`). 이름·계좌번호처럼 정규식으로 안전하게 잡을 수 없는 값은 이쪽으로 다룬다.
//
// 오탐 원칙: 날짜·금액·연도를 지우면 상담 자료가 망가진다. 그래서 구분자 없는 10자리
// (사업자등록번호 후보)와 계좌번호는 규칙에서 뺐다. 놓치는 쪽은 구조적 제외로 보완한다.

export type PiiKind =
  | "email"
  | "residentNumber"
  | "corporateNumber"
  | "businessNumber"
  | "cardNumber"
  | "phone";

export type PiiLabels = Record<PiiKind, string>;

/**
 * 기본 자리표시자(한국어). 값을 통째로 지우면 모델이 "정보가 없다"고 읽지만,
 * 라벨이 남으면 "있으나 전달하지 않았다"로 읽어 지어내지 않는다.
 */
export const KO_LABELS: PiiLabels = {
  email: "[이메일 비식별]",
  residentNumber: "[주민등록번호 비식별]",
  corporateNumber: "[법인등록번호 비식별]",
  businessNumber: "[사업자등록번호 비식별]",
  cardNumber: "[카드번호 비식별]",
  phone: "[연락처 비식별]",
};

export const EN_LABELS: PiiLabels = {
  email: "[REDACTED_EMAIL]",
  residentNumber: "[REDACTED_RRN]",
  corporateNumber: "[REDACTED_CRN]",
  businessNumber: "[REDACTED_BRN]",
  cardNumber: "[REDACTED_CARD]",
  phone: "[REDACTED_PHONE]",
};

export type PiiRule = { kind: PiiKind; pattern: RegExp };

/** 적용 순서가 의미를 가진다 — 앞 규칙이 뒤 규칙의 오탐을 먼저 막는다. */
export const PII_RULES: readonly PiiRule[] = [
  // 이메일 먼저 — 뒤 규칙이 로컬파트의 숫자를 먼저 물어뜯지 않게.
  { kind: "email", pattern: /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g },
  // 주민등록번호: 6자리 + 성별코드(1~4, 외국인 5~8) + 6자리. 법인등록번호보다 먼저.
  // "900101.1234567"·"900101 1234567"처럼 점·공백으로 쓴 표기가 붙여넣은 서류와 OCR에 흔하다.
  { kind: "residentNumber", pattern: /\b\d{6}\s?[-.\s]?\s?[1-8]\d{6}\b/g },
  // 법인등록번호 6-7 (구분자 필수)
  { kind: "corporateNumber", pattern: /\b\d{6}\s?[-.\s]\s?\d{7}\b/g },
  // 사업자등록번호 3-2-5 (구분자 없는 10자리는 금액과 구분되지 않아 제외)
  { kind: "businessNumber", pattern: /\b\d{3}\s?[-.\s]\s?\d{2}\s?[-.\s]\s?\d{5}\b/g },
  // 카드번호 4-4-4-4 (구분자 필수)
  { kind: "cardNumber", pattern: /\b\d{4}[-\s]\d{4}[-\s]\d{4}[-\s]\d{4}\b/g },
  // 휴대폰·인터넷전화·수신자부담
  { kind: "phone", pattern: /\b(?:01[016789]|070|080)[-.\s]?\d{3,4}[-.\s]?\d{4}\b/g },
  // 유선전화 — 구분자가 있을 때만. 없으면 금액·일련번호와 구분되지 않는다.
  {
    kind: "phone",
    pattern: /\b0(?:2|3[1-3]|4[1-4]|5[1-5]|6[1-4])[-.\s]\d{3,4}[-.\s]\d{4}\b/g,
  },
];

export type RedactOptions = {
  /** 자리표시자. 일부만 넘기면 나머지는 한국어 기본값을 쓴다. */
  labels?: Partial<PiiLabels>;
  /** 지우지 않고 남길 종류. */
  skip?: readonly PiiKind[];
};

/** 자유 텍스트에서 직접 식별자를 마스킹한다. 원문은 바꾸지 않고 새 문자열을 만든다. */
export function redactPii(text: string, options: RedactOptions = {}): string {
  const labels = { ...KO_LABELS, ...options.labels };
  const skip = new Set(options.skip ?? []);
  let out = text;
  for (const rule of PII_RULES) {
    if (skip.has(rule.kind)) continue;
    out = out.replace(rule.pattern, labels[rule.kind]);
  }
  return out;
}

export type PiiMatch = { kind: PiiKind; value: string; index: number };

/** 마스킹 대상 위치를 돌려준다 — 감사 로그·UI 하이라이트용. 값 자체를 로그에 남기지 않도록 주의. */
export function findPii(text: string, options: Pick<RedactOptions, "skip"> = {}): PiiMatch[] {
  const skip = new Set(options.skip ?? []);
  const matches: PiiMatch[] = [];
  // redactPii와 같은 결과가 나오도록 앞 규칙이 잡은 구간은 뒤 규칙에서 제외한다.
  const taken: [number, number][] = [];
  for (const rule of PII_RULES) {
    if (skip.has(rule.kind)) continue;
    for (const m of text.matchAll(rule.pattern)) {
      const start = m.index ?? 0;
      const end = start + m[0].length;
      if (taken.some(([s, e]) => start < e && end > s)) continue;
      taken.push([start, end]);
      matches.push({ kind: rule.kind, value: m[0], index: start });
    }
  }
  return matches.sort((a, b) => a.index - b.index);
}

/** 마스킹 대상이 남아 있는지 검사한다. */
export function hasPii(text: string, options: Pick<RedactOptions, "skip"> = {}): boolean {
  return findPii(text, options).length > 0;
}

export type ChatPayload = {
  system?: string;
  messages: { role: string; content: string }[];
};

/**
 * LLM 요청 직전 일괄 비식별화 — system·messages 전부를 훑는다.
 * 개별 프롬프트 빌더가 아니라 송신 지점 한 곳에 두면, 새 호출 경로가 생겨도 자동으로 적용된다.
 */
export function redactChatPayload<T extends ChatPayload>(payload: T, options: RedactOptions = {}): T {
  return {
    ...payload,
    ...(payload.system === undefined ? {} : { system: redactPii(payload.system, options) }),
    messages: payload.messages.map((message) => ({
      ...message,
      content: redactPii(message.content, options),
    })),
  };
}

/** 값 안에 든 문자열을 전부 모은다 — 중첩 배열·객체까지 훑는다. */
function collectStrings(value: unknown, out: string[]): void {
  if (typeof value === "string") {
    out.push(value);
    return;
  }
  if (typeof value === "number") {
    out.push(String(value));
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, out);
    return;
  }
  if (value && typeof value === "object") {
    for (const item of Object.values(value)) collectStrings(item, out);
  }
}

/**
 * 내보내면 안 되는 필드(`excludedKeys`)의 값이 텍스트에 새어 들어갔는지 검사한다.
 * 새어 나간 키 목록을 돌려주며, 비어 있으면 통과다.
 * 2자 이하 값은 우연 일치가 많아 검사에서 뺀다.
 */
export function findLeaks(
  text: string,
  record: Record<string, unknown>,
  excludedKeys: readonly string[],
): string[] {
  const leaked: string[] = [];
  for (const key of excludedKeys) {
    if (!(key in record)) continue;
    const values: string[] = [];
    collectStrings(record[key], values);
    if (values.some((value) => value.trim().length > 2 && text.includes(value.trim()))) {
      leaked.push(key);
    }
  }
  return leaked;
}
