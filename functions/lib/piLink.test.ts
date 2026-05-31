import { describe, expect, it } from "vitest";
import { buildLinkedZhItems } from "./piLink";

function fakeDb() {
  return {
    prepare(sql: string) {
      return {
        bind(...binds: unknown[]) {
          return {
            async all() {
              const productId = binds[0];
              if (sql.includes("language='ZH'")) {
                return {
                  results: productId === "prod-1"
                    ? [
                        {
                          label: "Color",
                          fieldType: "DROPDOWN",
                          options: JSON.stringify(["Red-ZH", "Blue-ZH"]),
                          defaultValue: "",
                          sortOrder: 1,
                          mapKey: "field-color-en"
                        }
                      ]
                    : []
                };
              }
              if (sql.includes("language='EN'")) {
                return {
                  results: productId === "prod-1"
                    ? [{ id: "field-color-en", label: "Color" }]
                    : []
                };
              }
              return { results: [] };
            },
            async first() {
              const optionKey = binds[0];
              if (optionKey === "productModelRule:prod-1:ZH") {
                return {
                  value: JSON.stringify({
                    enabled: true,
                    prefixOptions: [{ code: "ABC", description: "Alpha" }],
                    separator: "-",
                    segments: [
                      {
                        id: "size",
                        label: "Size",
                        options: [{ code: "S", description: "Small" }]
                      }
                    ]
                  })
                };
              }
              return null;
            }
          };
        }
      };
    }
  } as unknown as D1Database;
}

describe("buildLinkedZhItems", () => {
  it("seeds ZH model-rule fields while mapping EN product fields", async () => {
    const items = await buildLinkedZhItems(fakeDb(), [
      {
        productId: "prod-1",
        quantity: 2,
        unitPrice: 10,
        discountPct: 5,
        fieldValues: [
          {
            label: "Color",
            value: "Blue",
            fieldType: "DROPDOWN",
            options: ["Red", "Blue"],
            sortOrder: 1
          }
        ]
      }
    ]);

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      productId: "prod-1",
      quantity: 2,
      unitPrice: 10,
      discountPct: 5
    });
    expect(field(items[0].fieldValues, "__modelRule")).toContain("\"enabled\":true");
    expect(field(items[0].fieldValues, "__modelPrefix")).toBe("ABC");
    expect(field(items[0].fieldValues, "__modelSegment:size")).toBe("");
    expect(field(items[0].fieldValues, "\u578b\u53f7")).toBe("ABC");
    expect(field(items[0].fieldValues, "Color")).toBe("Blue-ZH");
  });
});

function field(fields: Array<{ label: string; value: string }>, label: string) {
  return fields.find((item) => item.label === label)?.value;
}
