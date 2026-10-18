import { describe, it, expect } from "vite-plus/test";
import { hasHtmlTags, stripHtml, normalizeStem } from "./stem";

describe("hasHtmlTags", () => {
  it("detects basic HTML tags", () => {
    expect(hasHtmlTags("<p>题干内容</p>")).toBe(true);
    expect(hasHtmlTags("选项A<br/>")).toBe(true);
    expect(hasHtmlTags("<span style='color:red;'>高亮</span>")).toBe(true);
    expect(hasHtmlTags("<div>块级元素</div>")).toBe(true);
    expect(hasHtmlTags("<strong>加粗</strong>")).toBe(true);
  });

  it("detects comments and doctypes", () => {
    expect(hasHtmlTags("<!-- 注释 -->题干")).toBe(true);
  });

  it("returns false for clean plain text", () => {
    expect(hasHtmlTags("纯文本题干内容")).toBe(false);
    expect(hasHtmlTags("A. 选项A内容")).toBe(false);
    expect(hasHtmlTags("【单选题】以下关于微积分基本定理说法正确的是？")).toBe(false);
  });

  it("does not false-positive on math expressions with spaces", () => {
    expect(hasHtmlTags("若 x < y 且 z > 0，则下列结论正确的是？")).toBe(false);
  });
});

describe("stripHtml & normalizeStem", () => {
  it("strips HTML tags and entities correctly", () => {
    expect(stripHtml("<p>测试&nbsp;内容</p>")).toBe("测试 内容");
    expect(normalizeStem("<p>HELLO   WORLD</p>")).toBe("hello world");
  });
});
