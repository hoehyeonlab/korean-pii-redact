# korean-pii-redact

[![CI](https://github.com/hoehyeonlab/korean-pii-redact/actions/workflows/ci.yml/badge.svg)](https://github.com/hoehyeonlab/korean-pii-redact/actions/workflows/ci.yml)

한국 개인정보(주민등록번호·사업자등록번호·법인등록번호·전화번호·카드번호·이메일)를
**외부 AI(LLM)·로그·서드파티로 보내기 전에** 비식별화하는 의존성 없는 TypeScript 라이브러리입니다.

Zero-dependency TypeScript library that redacts Korean PII (resident registration numbers,
business/corporate registration numbers, phone numbers, card numbers, emails) before text
leaves your system — e.g. right before an LLM API call.

## 설치

```bash
npm install korean-pii-redact
```

## 사용법

```ts
import { redactPii, redactChatPayload, findLeaks, EN_LABELS } from "korean-pii-redact";

redactPii("대표 홍길동 010-1234-5678, 사업자 123-45-67890");
// → "대표 홍길동 [연락처 비식별], 사업자 [사업자등록번호 비식별]"

redactPii("a@b.kr 900101-1234567", { labels: EN_LABELS });
// → "[REDACTED_EMAIL] [REDACTED_RRN]"

// LLM 요청 직전에 한 번 — system과 모든 message를 훑는다
const safe = redactChatPayload({
  system: "담당자 연락처 010-1111-2222",
  messages: [{ role: "user", content: "사업자 123-45-67890 진단해줘" }],
});

// 정규식으로 잡을 수 없는 값(이름 등)은 "내보내면 안 되는 필드"로 검사
findLeaks(promptText, customer, ["name", "creditScore", "loans"]);
// → 새어 나간 키 목록 (빈 배열이면 통과)
```

## API

| 함수 | 설명 |
| --- | --- |
| `redactPii(text, { labels?, skip? })` | 직접 식별자를 라벨로 바꾼 새 문자열 |
| `findPii(text, { skip? })` | `{ kind, value, index }[]` — 위치 확인용 |
| `hasPii(text)` | 마스킹 대상이 있는지 |
| `redactChatPayload(payload, options?)` | `{ system?, messages[] }` 전체 비식별화 (원본 불변) |
| `findLeaks(text, record, excludedKeys)` | 제외 필드의 값이 텍스트에 포함됐는지 |
| `KO_LABELS`, `EN_LABELS`, `PII_RULES` | 기본 라벨과 규칙 |

## 탐지 범위

| 종류 | 예시 | 비고 |
| --- | --- | --- |
| 이메일 | `ceo@example.co.kr` | 가장 먼저 적용 |
| 주민등록번호 | `900101-1234567`, `900101.1234567`, `9001011234567` | 성별코드 1–8 |
| 법인등록번호 | `110111-9234567` | 구분자 필수 |
| 사업자등록번호 | `123-45-67890`, `123 45 67890` | 구분자 필수 |
| 카드번호 | `4111-1111-1111-1111` | 구분자 필수 |
| 전화번호 | `010-1234-5678`, `01012345678`, `02-123-4567` | 유선은 구분자 필수 |

## 설계 원칙 — 무엇을 일부러 잡지 않는가

- **날짜·금액·연도는 지우지 않습니다.** `2026-09-07`, `매출 1234567원`, `한도 100,000,000원`은 그대로 둡니다.
  과하게 지우면 모델이 자료를 오해합니다.
- **구분자 없는 10자리(사업자등록번호 후보)와 계좌번호는 규칙에서 뺐습니다.** 금액·일련번호와 구분되지 않기 때문입니다.
- **이름은 정규식으로 잡지 않습니다.** `findLeaks`로 "내보내면 안 되는 필드"를 검사하세요.
- 라벨을 남기는 이유: 값을 통째로 지우면 모델이 "정보가 없다"고 읽지만, 라벨이 있으면 "있으나 전달하지 않았다"로 읽어 지어내지 않습니다.

이 라이브러리는 **보조 수단**입니다. 법적 비식별 조치(개인정보 보호법 가명처리 등)를 단독으로 충족한다고 보장하지 않습니다.

## 보안

취약점(마스킹 우회 등)은 공개 이슈 대신 [SECURITY.md](./SECURITY.md)의 절차로 알려 주세요.

## License

MIT
