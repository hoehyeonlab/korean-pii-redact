import { describe, expect, it } from "vitest";
import {
  EN_LABELS,
  findLeaks,
  findPii,
  hasPii,
  redactChatPayload,
  redactPii,
} from "../src/index.js";

describe("redactPii — 직접 식별자 마스킹", () => {
  it("주민등록번호를 지운다", () => {
    expect(redactPii("대표자 900101-1234567 확인")).toBe("대표자 [주민등록번호 비식별] 확인");
    expect(redactPii("9001011234567")).toBe("[주민등록번호 비식별]");
  });

  it("사업자등록번호를 지운다", () => {
    expect(redactPii("사업자 123-45-67890")).toBe("사업자 [사업자등록번호 비식별]");
  });

  it("법인등록번호를 주민등록번호와 구분한다", () => {
    expect(redactPii("110111-1234567")).toBe("[주민등록번호 비식별]");
    expect(redactPii("110111-9234567")).toBe("[법인등록번호 비식별]");
  });

  it("휴대폰·대표번호·유선번호를 지운다", () => {
    for (const raw of ["010-1234-5678", "01012345678", "070-1234-5678", "02-123-4567", "031-123-4567"]) {
      expect(redactPii(raw)).toBe("[연락처 비식별]");
    }
  });

  it("이메일과 카드번호를 지운다", () => {
    expect(redactPii("ceo@example.co.kr")).toBe("[이메일 비식별]");
    expect(redactPii("4111-1111-1111-1111")).toBe("[카드번호 비식별]");
  });

  it("한 문장에 여러 식별자가 섞여도 모두 지운다", () => {
    const out = redactPii("대표 홍길동 010-1234-5678 / hong@corp.kr / 사업자 123-45-67890");
    expect(out).not.toContain("010-1234-5678");
    expect(out).not.toContain("hong@corp.kr");
    expect(out).not.toContain("123-45-67890");
    // 이름은 규칙으로 잡히지 않는다 — findLeaks로 다뤄야 한다는 사실을 고정한다.
    expect(out).toContain("홍길동");
  });

  it("날짜·금액·매출은 그대로 둔다", () => {
    for (const keep of [
      "2026-09-07",
      "창업일 2019-03-01",
      "매출 50000만원",
      "직원 12명",
      "한도 100,000,000원",
      "2024년 대비 +12%",
      "KCB 812점",
      "매출 1234567원",
      "2026 09 09 상담",
    ]) {
      expect(redactPii(keep)).toBe(keep);
    }
  });

  it("점·공백 구분자 표기도 가린다", () => {
    for (const raw of ["900101.1234567", "900101 1234567", "900101 - 1234567"]) {
      expect(redactPii(raw)).toContain("[주민등록번호 비식별]");
    }
    for (const raw of ["123.45.67890", "123 45 67890"]) {
      expect(redactPii(raw)).toContain("[사업자등록번호 비식별]");
    }
  });

  it("라벨을 바꾸고 일부 종류를 건너뛸 수 있다", () => {
    expect(redactPii("a@b.kr 010-1234-5678", { labels: EN_LABELS })).toBe(
      "[REDACTED_EMAIL] [REDACTED_PHONE]",
    );
    expect(redactPii("a@b.kr 010-1234-5678", { skip: ["email"] })).toBe("a@b.kr [연락처 비식별]");
  });
});

describe("findPii / hasPii", () => {
  it("종류와 위치를 돌려준다", () => {
    expect(findPii("연락 010-1234-5678, a@b.kr")).toEqual([
      { kind: "phone", value: "010-1234-5678", index: 3 },
      { kind: "email", value: "a@b.kr", index: 18 },
    ]);
  });

  it("앞 규칙이 잡은 구간을 뒤 규칙이 중복으로 잡지 않는다", () => {
    expect(findPii("900101-1234567").map((m) => m.kind)).toEqual(["residentNumber"]);
  });

  it("hasPii는 마스킹 대상 유무를 알려준다", () => {
    expect(hasPii("연락처 010-1234-5678")).toBe(true);
    expect(hasPii("매출 50000만원")).toBe(false);
  });
});

describe("redactChatPayload", () => {
  it("system과 모든 message를 훑는다", () => {
    const out = redactChatPayload({
      system: "담당자 연락처 010-1111-2222",
      messages: [
        { role: "user", content: "사업자 123-45-67890 진단해줘" },
        { role: "assistant", content: "회신은 a@b.kr 로 드립니다" },
      ],
    });
    expect(out.system).toBe("담당자 연락처 [연락처 비식별]");
    expect(out.messages[0].content).toBe("사업자 [사업자등록번호 비식별] 진단해줘");
    expect(out.messages[1].content).toBe("회신은 [이메일 비식별] 로 드립니다");
  });

  it("system이 없으면 키를 만들지 않는다", () => {
    expect(redactChatPayload({ messages: [] })).not.toHaveProperty("system");
  });

  it("원본 페이로드를 바꾸지 않는다", () => {
    const messages = [{ role: "user", content: "010-1234-5678" }];
    redactChatPayload({ messages });
    expect(messages[0].content).toBe("010-1234-5678");
  });
});

describe("findLeaks — 구조적 제외 검사", () => {
  const record = {
    name: "홍길동",
    creditScore: 812,
    loans: [{ institution: "기업은행", amount: "5000" }],
    taxArrears: "있음",
    productDesc: "수제 가구 제작",
  };
  const excluded = ["name", "creditScore", "loans", "taxArrears"];

  it("제외 키의 값이 텍스트에 있으면 잡아낸다", () => {
    expect(findLeaks("대표 홍길동님", record, excluded)).toEqual(["name"]);
    expect(findLeaks("신용점수 812점", record, excluded)).toEqual(["creditScore"]);
    expect(findLeaks("기업은행 대출 있음", record, excluded)).toEqual(["loans"]);
  });

  it("제외 키가 없는 텍스트는 통과한다", () => {
    expect(findLeaks("수제 가구 제작", record, excluded)).toEqual([]);
  });

  it("2자 이하 값은 우연 일치를 피해 검사에서 뺀다", () => {
    expect(findLeaks("있음", record, excluded)).toEqual([]);
  });
});
