import { describe, it, expect } from "vitest";
import type {
  LarkCard,
  LarkCardAction,
  LarkCardButton,
  LarkCardColumnSet,
  LarkCardDiv,
  LarkCardHeader,
  LarkCardHr,
  LarkCardImage,
  LarkCardNote,
} from "./types.js";

describe("LarkCard types", () => {
  it("allows creating a simple card with header and text", () => {
    const card: LarkCard = {
      header: {
        title: {
          tag: "plain_text",
          content: "Test Card",
        },
        template: "blue",
      },
      elements: [
        {
          tag: "div",
          text: {
            tag: "lark_md",
            content: "Hello **world**!",
          },
        },
      ],
    };

    expect(card.header?.title.content).toBe("Test Card");
    expect(card.header?.template).toBe("blue");
    expect(card.elements).toHaveLength(1);
  });

  it("allows creating a card with buttons", () => {
    const button: LarkCardButton = {
      tag: "button",
      text: {
        tag: "plain_text",
        content: "Click me",
      },
      type: "primary",
      value: { action: "test" },
    };

    const action: LarkCardAction = {
      tag: "action",
      actions: [button],
      layout: "bisected",
    };

    const card: LarkCard = {
      elements: [action],
    };

    expect(card.elements).toHaveLength(1);
    const actionEl = card.elements[0] as LarkCardAction;
    expect(actionEl.tag).toBe("action");
    expect(actionEl.actions).toHaveLength(1);
    expect(actionEl.actions[0].type).toBe("primary");
  });

  it("allows creating a card with multiple element types", () => {
    const div: LarkCardDiv = {
      tag: "div",
      text: {
        tag: "plain_text",
        content: "Text content",
      },
    };

    const hr: LarkCardHr = {
      tag: "hr",
    };

    const note: LarkCardNote = {
      tag: "note",
      elements: [
        {
          tag: "plain_text",
          content: "Note text",
        },
      ],
    };

    const card: LarkCard = {
      elements: [div, hr, note],
    };

    expect(card.elements).toHaveLength(3);
    expect(card.elements[0].tag).toBe("div");
    expect(card.elements[1].tag).toBe("hr");
    expect(card.elements[2].tag).toBe("note");
  });

  it("allows creating a card with image", () => {
    const image: LarkCardImage = {
      tag: "img",
      img_key: "img_v2_xxx",
      alt: {
        tag: "plain_text",
        content: "Alt text",
      },
      title: {
        tag: "plain_text",
        content: "Image title",
      },
      mode: "crop_center",
      preview: true,
    };

    const card: LarkCard = {
      elements: [image],
    };

    expect(card.elements).toHaveLength(1);
    const imgEl = card.elements[0] as LarkCardImage;
    expect(imgEl.img_key).toBe("img_v2_xxx");
    expect(imgEl.mode).toBe("crop_center");
  });

  it("allows creating a card with column set", () => {
    const columnSet: LarkCardColumnSet = {
      tag: "column_set",
      flex_mode: "bisect",
      background_style: "grey",
      columns: [
        {
          tag: "column",
          width: "weighted",
          weight: 1,
          elements: [
            {
              tag: "div",
              text: {
                tag: "plain_text",
                content: "Column 1",
              },
            },
          ],
        },
        {
          tag: "column",
          width: "weighted",
          weight: 1,
          elements: [
            {
              tag: "div",
              text: {
                tag: "plain_text",
                content: "Column 2",
              },
            },
          ],
        },
      ],
    };

    const card: LarkCard = {
      elements: [columnSet],
    };

    expect(card.elements).toHaveLength(1);
    const colSet = card.elements[0] as LarkCardColumnSet;
    expect(colSet.columns).toHaveLength(2);
    expect(colSet.flex_mode).toBe("bisect");
  });

  it("allows all header template colors", () => {
    const colors = [
      "blue",
      "wathet",
      "turquoise",
      "green",
      "yellow",
      "orange",
      "red",
      "carmine",
      "violet",
      "purple",
      "indigo",
      "grey",
    ] as const;

    for (const color of colors) {
      const header: LarkCardHeader = {
        title: {
          tag: "plain_text",
          content: "Test",
        },
        template: color,
      };
      expect(header.template).toBe(color);
    }
  });

  it("allows button with confirm dialog", () => {
    const button: LarkCardButton = {
      tag: "button",
      text: {
        tag: "plain_text",
        content: "Delete",
      },
      type: "danger",
      confirm: {
        title: {
          tag: "plain_text",
          content: "Confirm Delete",
        },
        text: {
          tag: "plain_text",
          content: "Are you sure you want to delete?",
        },
      },
    };

    expect(button.confirm?.title.content).toBe("Confirm Delete");
    expect(button.type).toBe("danger");
  });

  it("allows button with multi_url", () => {
    const button: LarkCardButton = {
      tag: "button",
      text: {
        tag: "plain_text",
        content: "Open",
      },
      multi_url: {
        url: "https://example.com",
        pc_url: "https://example.com/pc",
        ios_url: "https://example.com/ios",
        android_url: "https://example.com/android",
      },
    };

    expect(button.multi_url?.url).toBe("https://example.com");
    expect(button.multi_url?.pc_url).toBe("https://example.com/pc");
  });

  it("allows card config options", () => {
    const card: LarkCard = {
      config: {
        wide_screen_mode: true,
        enable_forward: false,
        update_multi: true,
      },
      elements: [],
    };

    expect(card.config?.wide_screen_mode).toBe(true);
    expect(card.config?.enable_forward).toBe(false);
  });

  it("allows div with fields", () => {
    const div: LarkCardDiv = {
      tag: "div",
      fields: [
        {
          is_short: true,
          text: {
            tag: "lark_md",
            content: "**Field 1**\nValue 1",
          },
        },
        {
          is_short: true,
          text: {
            tag: "lark_md",
            content: "**Field 2**\nValue 2",
          },
        },
      ],
    };

    expect(div.fields).toHaveLength(2);
    expect(div.fields?.[0].is_short).toBe(true);
  });
});
