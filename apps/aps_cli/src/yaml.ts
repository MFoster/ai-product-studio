import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

export function parse(text: string): unknown {
  return parseYaml(text, {
    version: "1.1",
    uniqueKeys: false,
    customTags: (tags) =>
      tags.map((tag) => {
        if (
          typeof tag === "string" ||
          tag.tag !== "tag:yaml.org,2002:bool" ||
          !("test" in tag) ||
          !tag.test
        )
          return tag;
        if (tag.test.test("y"))
          return { ...tag, test: /^(?:[Yy]es|YES|[Tt]rue|TRUE|[Oo]n|ON)$/ };
        if (tag.test.test("n"))
          return { ...tag, test: /^(?:[Nn]o|NO|[Ff]alse|FALSE|[Oo]ff|OFF)$/ };
        return tag;
      }),
  });
}

export function stringify(value: unknown): string {
  return stringifyYaml(value, { version: "1.1" });
}
